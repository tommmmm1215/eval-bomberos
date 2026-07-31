-- =====================================================================
-- 03_functions.sql — RPC de carga rápida y ciclo de vida del período
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers de identidad (usados también por las políticas RLS)
-- ---------------------------------------------------------------------

create or replace function app_bombero_id()
returns uuid language sql stable security definer set search_path = public as $$
  select b.id from bombero b where b.user_id = (select auth.uid()) limit 1;
$$;

create or replace function app_es_jefe(p_cuartel uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bombero b
    where b.user_id = (select auth.uid())
      and b.cuartel_id = p_cuartel
      and b.rango in ('jefe','subjefe','oficial')
      and b.activo
  );
$$;

create or replace function app_cuartel_de_periodo(p_periodo uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select cuartel_id from periodo where id = p_periodo;
$$;

-- Toda consulta a `bombero` desde una política RLS tiene que pasar por una
-- función security definer. Si se escribe el subquery directo en la política
-- —`(select cuartel_id from bombero where ...)`— esa lectura vuelve a
-- disparar la política de `bombero` y Postgres aborta con
-- «infinite recursion detected in policy for relation "bombero"».
create or replace function app_cuartel_actual()
returns uuid language sql stable security definer set search_path = public as $$
  select b.cuartel_id from bombero b where b.user_id = (select auth.uid()) limit 1;
$$;

create or replace function app_cuartel_de_bombero(p_bombero uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select cuartel_id from bombero where id = p_bombero;
$$;

-- ---------------------------------------------------------------------
-- Ciclo de vida del período
-- ---------------------------------------------------------------------

-- Abre el período tomando la config vigente a esa fecha.
create or replace function abrir_periodo(p_cuartel uuid, p_anio int, p_mes int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_config uuid; v_periodo uuid;
begin
  if not app_es_jefe(p_cuartel) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select id into v_config
  from config_evaluacion
  where cuartel_id = p_cuartel
    and vigente_desde <= make_date(p_anio, p_mes, 1)
  order by vigente_desde desc
  limit 1;

  if v_config is null then
    raise exception 'No hay configuración vigente para % / %', p_mes, p_anio;
  end if;

  insert into periodo (cuartel_id, anio, mes, config_id)
  values (p_cuartel, p_anio, p_mes, v_config)
  on conflict (cuartel_id, anio, mes) do nothing
  returning id into v_periodo;

  if v_periodo is null then
    select id into v_periodo from periodo
    where cuartel_id = p_cuartel and anio = p_anio and mes = p_mes;
  end if;

  perform inicializar_evaluaciones(v_periodo);
  return v_periodo;
end $$;

-- Precarga las notas manuales en el valor por defecto (7 = cumple estándar).
-- El jefe solo edita los desvíos: es el ahorro de tiempo principal.
create or replace function inicializar_evaluaciones(p_periodo uuid)
returns int language plpgsql security definer set search_path = public as $$
declare filas int;
begin
  insert into evaluacion_mensual (periodo_id, bombero_id)
  select p.id, b.id
  from periodo p
  join bombero b on b.cuartel_id = p.cuartel_id and b.activo and b.evaluable
  where p.id = p_periodo
  on conflict (periodo_id, bombero_id) do nothing;
  get diagnostics filas = row_count;
  return filas;
end $$;

create or replace function cerrar_periodo(p_periodo uuid)
returns int language plpgsql security definer set search_path = public as $$
declare filas int;
begin
  if not app_es_jefe(app_cuartel_de_periodo(p_periodo)) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if (select estado from periodo where id = p_periodo) = 'cerrado' then
    raise exception 'El período ya está cerrado' using errcode = '55006';
  end if;

  insert into resultado_mensual (
    periodo_id, bombero_id, pct_guardia, pct_salidas,
    puntaje_bruto, penalizaciones, puntaje_final, banda, desglose)
  select periodo_id, bombero_id, pct_guardia, pct_salidas,
         puntaje_bruto, penalizaciones, puntaje_final, banda, desglose
  from v_puntaje_mensual
  where periodo_id = p_periodo;

  get diagnostics filas = row_count;
  update periodo set estado = 'cerrado', cerrado_en = now() where id = p_periodo;
  return filas;
end $$;

-- Reapertura auditable: borra la foto y vuelve a habilitar la carga.
create or replace function reabrir_periodo(p_periodo uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_es_jefe(app_cuartel_de_periodo(p_periodo)) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Debe indicar un motivo de reapertura';
  end if;
  delete from resultado_mensual where periodo_id = p_periodo;
  update periodo set estado = 'abierto', cerrado_en = null where id = p_periodo;
end $$;

-- ---------------------------------------------------------------------
-- Carga rápida
-- ---------------------------------------------------------------------

-- Carga semanal de horas. Idempotente: reenviar la misma semana corrige.
-- p_registros: [{"bombero_id":"...","horas":12}, ...]
create or replace function upsert_guardias_semana(
  p_periodo uuid, p_semana int, p_registros jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare filas int;
begin
  if not app_es_jefe(app_cuartel_de_periodo(p_periodo)) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  insert into registro_guardia (periodo_id, bombero_id, semana, horas, cargado_por)
  select p_periodo,
         (r ->> 'bombero_id')::uuid,
         p_semana,
         (r ->> 'horas')::numeric,
         (select auth.uid())
  from jsonb_array_elements(p_registros) as r
  on conflict (periodo_id, bombero_id, semana)
  do update set horas = excluded.horas,
                cargado_por = excluded.cargado_por,
                updated_at = now();

  get diagnostics filas = row_count;
  return filas;
end $$;

-- Registra la emergencia y toda la asistencia en una sola llamada.
-- Solo se envían los presentes: el resto queda 'ausente', salvo quienes
-- tengan una novedad vigente ese día, que pasan a 'no_convocable'.
create or replace function registrar_emergencia(
  p_periodo       uuid,
  p_ocurrida_en   timestamptz,
  p_tipo          text,
  p_presentes     uuid[],
  p_peso          numeric default 1.0,
  p_codigo        text default null,
  p_no_convocables uuid[] default '{}'
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_emergencia bigint; v_cuartel uuid; v_fecha date;
begin
  v_cuartel := app_cuartel_de_periodo(p_periodo);
  if not app_es_jefe(v_cuartel) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  v_fecha := (p_ocurrida_en at time zone 'America/Argentina/Buenos_Aires')::date;

  insert into emergencia (periodo_id, ocurrida_en, tipo, codigo, peso, cargado_por)
  values (p_periodo, p_ocurrida_en, p_tipo, p_codigo, p_peso, (select auth.uid()))
  returning id into v_emergencia;

  insert into emergencia_asistencia (emergencia_id, bombero_id, estado)
  select
    v_emergencia,
    b.id,
    case
      when b.id = any (p_presentes) then 'presente'
      when b.id = any (p_no_convocables) then 'no_convocable'
      when exists (
        select 1 from novedad_personal n
        where n.bombero_id = b.id
          and v_fecha between n.desde and n.hasta
      ) then 'no_convocable'
      else 'ausente'
    end
  from bombero b
  where b.cuartel_id = v_cuartel and b.activo and b.evaluable;

  return v_emergencia;
end $$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------

-- Se revoca a todo el mundo y se vuelve a otorgar solo lo que el front usa.
-- Sin el grant explícito la API queda inaccesible: revocar de public no deja
-- a 'authenticated' con permiso residual.
revoke execute on function
  abrir_periodo(uuid,int,int),
  cerrar_periodo(uuid),
  reabrir_periodo(uuid,text),
  inicializar_evaluaciones(uuid),
  upsert_guardias_semana(uuid,int,jsonb),
  registrar_emergencia(uuid,timestamptz,text,uuid[],numeric,text,uuid[])
from public;

grant execute on function
  abrir_periodo(uuid,int,int),
  cerrar_periodo(uuid),
  reabrir_periodo(uuid,text),
  upsert_guardias_semana(uuid,int,jsonb),
  registrar_emergencia(uuid,timestamptz,text,uuid[],numeric,text,uuid[])
to authenticated;

-- inicializar_evaluaciones queda deliberadamente fuera del grant: es interna.
-- abrir_periodo la invoca y, por ser security definer, corre como owner.
-- La autorización real no la da el grant sino el app_es_jefe() de cada RPC:
-- cualquier authenticated puede invocarlas, solo el mando pasa el control.
