-- =====================================================================
--  Editar una salida ya registrada.
--
--  Hasta ahora la única corrección posible era borrar y volver a cargar,
--  lo que obliga a re-tildar a los diecisiete presentes para arreglar una
--  fecha. En la práctica eso significa que nadie corrige nada.
--
--  La asistencia se reemplaza entera en lugar de aplicarle un diff: es la
--  misma lógica que registrar_emergencia —presentes, no convocables por
--  novedad, no evaluables— y tenerla escrita dos veces es garantía de que
--  un día diverjan. Que se borre y se rehaga es más barato que mantener
--  dos verdades.
-- =====================================================================

create or replace function actualizar_emergencia(
  p_emergencia    bigint,
  p_ocurrida_en   timestamptz,
  p_tipo          text,
  p_presentes     uuid[],
  p_peso          numeric default 1.0,
  p_codigo        text default null,
  p_no_convocables uuid[] default '{}'
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_periodo uuid; v_cuartel uuid; v_fecha date;
begin
  select periodo_id into v_periodo from emergencia where id = p_emergencia;
  if v_periodo is null then
    raise exception 'La salida no existe' using errcode = 'P0002';
  end if;

  v_cuartel := app_cuartel_de_periodo(v_periodo);
  if not app_es_jefe(v_cuartel) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  -- El período cerrado lo frena el trigger t_guard_emergencia, que corre
  -- sobre el update de abajo. No hace falta chequearlo acá: un solo lugar
  -- que decida qué es un mes cerrado.

  v_fecha := (p_ocurrida_en at time zone 'America/Argentina/Buenos_Aires')::date;

  update emergencia
     set ocurrida_en = p_ocurrida_en,
         tipo        = p_tipo,
         codigo      = p_codigo,
         peso        = p_peso
   where id = p_emergencia;

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
end $$;

revoke execute on function
  actualizar_emergencia(bigint,timestamptz,text,uuid[],numeric,text,uuid[])
from public, anon;
grant execute on function
  actualizar_emergencia(bigint,timestamptz,text,uuid[],numeric,text,uuid[])
to authenticated;
