-- =====================================================================
--  PEGAR ESTO EN EL SQL EDITOR DE SUPABASE
--
--  Proyecto:  bomberos-espartillar-staging
--  https://supabase.com/dashboard/project/azyinwfguzohifjfiazw/sql/new
--
--  Verificá arriba a la izquierda que diga "bomberos-espartillar-staging".
--  Si dice "Cooperativa Agricola", es el proyecto de AgTech: no es acá.
--
--  Cómo copiarlo: abrí este archivo, Ctrl+A, Ctrl+C. NO lo copies del
--  chat: los bloques largos se cortan al pegar y el $$ queda sin cerrar,
--  que es lo que pasó las dos veces anteriores.
--
--  Al terminar tiene que decir "Success. No rows returned".
--
--  ---------------------------------------------------------------------
--  Qué hace: crea actualizar_emergencia, que es lo que usa el botón
--  Editar de la pantalla Salidas.
--
--  No lleva el `insert` en schema_migrations al final, a propósito: la
--  versión 20260728150000 YA figura anotada de un intento anterior en el
--  que se registró la migración sin que la función llegara a crearse.
--  Volver a insertarla daría "duplicate key". El registro queda correcto
--  en cuanto esto corra.
-- =====================================================================

create or replace function actualizar_emergencia(
  p_emergencia    bigint,
  p_ocurrida_en   timestamptz,
  p_tipo          text,
  p_presentes     uuid[],
  p_peso          numeric default 1.0,
  p_codigo        text default null,
  p_no_convocables uuid[] default '{}'
) returns bigint language plpgsql security definer set search_path = public as $func$
declare
  v_periodo_actual uuid;
  v_estado_actual  text;
  v_periodo_nuevo  uuid;
  v_estado_nuevo   text;
  v_cuartel        uuid;
  v_fecha          date;
  v_anio           int;
  v_mes            int;
begin
  select e.periodo_id, p.estado, p.cuartel_id
    into v_periodo_actual, v_estado_actual, v_cuartel
  from emergencia e
  join periodo p on p.id = e.periodo_id
  where e.id = p_emergencia;

  if v_periodo_actual is null then
    raise exception 'La salida no existe' using errcode = 'P0002';
  end if;

  if not app_es_jefe(v_cuartel) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  -- El mes de origen. El trigger no lo mira en un update, así que sin este
  -- control se podrían vaciar meses ya cerrados sacándoles salidas.
  if v_estado_actual = 'cerrado' then
    raise exception 'La salida está en un mes cerrado: reabrilo para modificarla'
      using errcode = '55006';
  end if;

  v_fecha := (p_ocurrida_en at time zone 'America/Argentina/Buenos_Aires')::date;
  v_anio  := extract(year  from v_fecha)::int;
  v_mes   := extract(month from v_fecha)::int;

  select id, estado into v_periodo_nuevo, v_estado_nuevo
  from periodo
  where cuartel_id = v_cuartel and anio = v_anio and mes = v_mes;

  -- El mes destino tiene que existir. No se crea al vuelo: abrir un período
  -- precarga las evaluaciones de toda la dotación, y ese no es un efecto que
  -- deba dispararse de costado al corregir una fecha.
  if v_periodo_nuevo is null then
    raise exception 'No hay ningún mes abierto para %/%. Abrilo primero desde la barra superior.',
      lpad(v_mes::text, 2, '0'), v_anio
      using errcode = 'P0002';
  end if;

  if v_estado_nuevo = 'cerrado' then
    raise exception 'El mes %/% está cerrado: no se le pueden agregar salidas',
      lpad(v_mes::text, 2, '0'), v_anio
      using errcode = '55006';
  end if;

  update emergencia
     set periodo_id  = v_periodo_nuevo,
         ocurrida_en = p_ocurrida_en,
         tipo        = p_tipo,
         codigo      = p_codigo,
         peso        = p_peso
   where id = p_emergencia;

  -- La asistencia se rehace entera: quién queda 'no_convocable' por una
  -- novedad depende del día, así que al cambiar la fecha hay que recalcularla
  -- o quedaría contando ausencias de gente que estaba de licencia.
  delete from emergencia_asistencia where emergencia_id = p_emergencia;

  insert into emergencia_asistencia (emergencia_id, bombero_id, estado)
  select
    p_emergencia,
    b.id,
    case
      when b.id = any (p_presentes) then 'presente'
      when not b.evaluable then 'no_convocable'
      when b.id = any (p_no_convocables) then 'no_convocable'
      when exists (
        select 1 from novedad_personal n
        where n.bombero_id = b.id
          and v_fecha between n.desde and n.hasta
      ) then 'no_convocable'
      else 'ausente'
    end
  from bombero b
  where b.cuartel_id = v_cuartel and b.activo;

  return p_emergencia;
end
$func$;

revoke execute on function
  actualizar_emergencia(bigint,timestamptz,text,uuid[],numeric,text,uuid[])
from public, anon;

grant execute on function
  actualizar_emergencia(bigint,timestamptz,text,uuid[],numeric,text,uuid[])
to authenticated;
