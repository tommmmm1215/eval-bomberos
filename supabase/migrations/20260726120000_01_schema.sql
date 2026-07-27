-- =====================================================================
-- 01_schema.sql — Sistema de evaluación de rendimiento de bomberos
-- Tablas, constraints, índices y triggers de integridad.
-- =====================================================================

-- gen_random_uuid() es parte del core desde PG13; pgcrypto ya no hace falta.

-- ---------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------

create table cuartel (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  localidad  text,
  created_at timestamptz not null default now()
);

create table bombero (
  id         uuid primary key default gen_random_uuid(),
  cuartel_id uuid not null references cuartel(id) on delete restrict,
  user_id    uuid unique references auth.users(id) on delete set null,
  legajo     text not null,
  nombre     text not null,
  rango      text not null default 'bombero'
             check (rango in ('aspirante','bombero','cabo','sargento',
                              'oficial','subjefe','jefe')),
  fecha_alta date not null default current_date,
  activo     boolean not null default true,
  -- Jefatura, administrativos y honorarios integran la dotación pero
  -- no entran en el ranking de rendimiento.
  evaluable  boolean not null default true,
  unique (cuartel_id, legajo)
);

create index bombero_cuartel_activo_idx on bombero (cuartel_id) where activo and evaluable;
create index bombero_user_idx on bombero (user_id);

-- Configuración versionada. No se edita: se inserta una versión nueva.
create table config_evaluacion (
  id             uuid primary key default gen_random_uuid(),
  cuartel_id     uuid not null references cuartel(id) on delete cascade,
  vigente_desde  date not null,
  meta_horas_mes numeric(5,1) not null default 24 check (meta_horas_mes > 0),
  pesos          jsonb not null,
  tope_por_piso  numeric(5,2) not null default 60,
  piso_guardia   numeric(4,3) not null default 0.50,
  piso_salidas   numeric(4,3) not null default 0.40,
  unique (cuartel_id, vigente_desde),
  -- las ocho categorías deben estar presentes y sumar 100
  constraint pesos_completos check (
    pesos ?& array['guardia','salidas','orden_interno','capacitacion',
                   'protocolar','cursos','cambio_guardia','conducta']
  )
);

-- Postgres no admite subqueries en CHECK: la suma de pesos se valida por trigger.
create or replace function valida_pesos()
returns trigger language plpgsql as $$
declare total numeric;
begin
  select sum(value::numeric) into total from jsonb_each_text(new.pesos);
  if total is distinct from 100 then
    raise exception 'Los pesos deben sumar 100, suman %', total
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger t_valida_pesos before insert or update on config_evaluacion
  for each row execute function valida_pesos();

create table periodo (
  id         uuid primary key default gen_random_uuid(),
  cuartel_id uuid not null references cuartel(id) on delete cascade,
  anio       smallint not null check (anio between 2000 and 2100),
  mes        smallint not null check (mes between 1 and 12),
  config_id  uuid not null references config_evaluacion(id) on delete restrict,
  estado     text not null default 'abierto' check (estado in ('abierto','cerrado')),
  cerrado_en timestamptz,
  unique (cuartel_id, anio, mes)
);

create index periodo_abierto_idx on periodo (cuartel_id) where estado = 'abierto';
create index periodo_config_idx on periodo (config_id);

-- ---------------------------------------------------------------------
-- Datos crudos
-- ---------------------------------------------------------------------

create table registro_guardia (
  id          bigint generated always as identity primary key,
  periodo_id  uuid not null references periodo(id) on delete cascade,
  bombero_id  uuid not null references bombero(id) on delete cascade,
  semana      smallint not null check (semana between 1 and 6),
  horas       numeric(5,2) not null default 0 check (horas >= 0 and horas <= 168),
  cargado_por uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (periodo_id, bombero_id, semana)
);

create index registro_guardia_bombero_idx on registro_guardia (bombero_id, periodo_id);

create table emergencia (
  id          bigint generated always as identity primary key,
  periodo_id  uuid not null references periodo(id) on delete cascade,
  ocurrida_en timestamptz not null,
  tipo        text not null,
  codigo      text,
  peso        numeric(3,2) not null default 1.0 check (peso > 0 and peso <= 5),
  computable  boolean not null default true,
  cargado_por uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index emergencia_periodo_idx on emergencia (periodo_id) where computable;

create table emergencia_asistencia (
  emergencia_id bigint not null references emergencia(id) on delete cascade,
  bombero_id    uuid   not null references bombero(id) on delete cascade,
  estado        text   not null
                check (estado in ('presente','ausente','no_convocable')),
  primary key (emergencia_id, bombero_id)
);

create index emergencia_asistencia_bombero_idx
  on emergencia_asistencia (bombero_id) where estado <> 'no_convocable';

create table novedad_personal (
  id          bigint generated always as identity primary key,
  bombero_id  uuid not null references bombero(id) on delete cascade,
  desde       date not null,
  hasta       date not null,
  tipo        text not null
              check (tipo in ('licencia_medica','licencia_ordinaria','comision',
                              'franco_especial','suspension','otro')),
  afecta_meta boolean not null default true,
  detalle     text,
  check (hasta >= desde)
);

create index novedad_personal_rango_idx on novedad_personal (bombero_id, desde, hasta);

-- ---------------------------------------------------------------------
-- Evaluación manual
-- ---------------------------------------------------------------------

create table evaluacion_mensual (
  periodo_id      uuid not null references periodo(id) on delete cascade,
  bombero_id      uuid not null references bombero(id) on delete cascade,
  orden_interno   smallint not null default 7 check (orden_interno  between 1 and 10),
  capacitacion    smallint not null default 7 check (capacitacion   between 1 and 10),
  protocolar      smallint not null default 7 check (protocolar     between 1 and 10),
  cursos          smallint not null default 7 check (cursos         between 1 and 10),
  cambio_guardia  smallint not null default 7 check (cambio_guardia between 1 and 10),
  conducta        smallint not null default 7 check (conducta       between 1 and 10),
  comentario_jefe text,
  no_aplica       text[] not null default '{}',
  evaluador_id    uuid references auth.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  primary key (periodo_id, bombero_id),
  constraint no_aplica_valido check (
    no_aplica <@ array['orden_interno','capacitacion','protocolar',
                       'cursos','cambio_guardia','conducta']
  ),
  -- obliga a justificar los extremos, que es donde se juegan los reclamos
  constraint extremos_justificados check (
    (conducta between 5 and 8)
    or (comentario_jefe is not null and length(btrim(comentario_jefe)) >= 15)
  )
);

create table penalizacion (
  id         bigint generated always as identity primary key,
  periodo_id uuid not null references periodo(id) on delete cascade,
  bombero_id uuid not null references bombero(id) on delete cascade,
  tipo       text not null
             check (tipo in ('apercibimiento','suspension','otro')),
  puntos     numeric(4,1) not null check (puntos > 0 and puntos <= 100),
  motivo     text not null,
  aplicada_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index penalizacion_periodo_idx on penalizacion (periodo_id, bombero_id);

-- ---------------------------------------------------------------------
-- Resultado congelado al cierre
-- ---------------------------------------------------------------------

create table resultado_mensual (
  periodo_id     uuid not null references periodo(id) on delete cascade,
  bombero_id     uuid not null references bombero(id) on delete cascade,
  pct_guardia    numeric(5,2),
  pct_salidas    numeric(5,2),
  puntaje_bruto  numeric(5,2) not null,
  penalizaciones numeric(5,1) not null default 0,
  puntaje_final  numeric(5,2) not null,
  banda          text not null,
  desglose       jsonb not null,
  cerrado_en     timestamptz not null default now(),
  primary key (periodo_id, bombero_id)
);

create index resultado_bombero_idx on resultado_mensual (bombero_id);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger t_touch_registro_guardia before update on registro_guardia
  for each row execute function touch_updated_at();
create trigger t_touch_evaluacion before update on evaluacion_mensual
  for each row execute function touch_updated_at();

-- Bloquea cualquier escritura sobre un período ya cerrado.
create or replace function guard_periodo_abierto()
returns trigger language plpgsql as $$
declare v_periodo uuid; v_estado text;
begin
  v_periodo := coalesce(
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end ->> 'periodo_id')::uuid
  );
  select estado into v_estado from periodo where id = v_periodo;
  if v_estado = 'cerrado' then
    raise exception 'El período % está cerrado: no admite modificaciones', v_periodo
      using errcode = '55006';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger t_guard_registro_guardia
  before insert or update or delete on registro_guardia
  for each row execute function guard_periodo_abierto();
create trigger t_guard_emergencia
  before insert or update or delete on emergencia
  for each row execute function guard_periodo_abierto();
create trigger t_guard_evaluacion
  before insert or update or delete on evaluacion_mensual
  for each row execute function guard_periodo_abierto();
create trigger t_guard_penalizacion
  before insert or update or delete on penalizacion
  for each row execute function guard_periodo_abierto();

-- La asistencia hereda el período de la emergencia.
create or replace function guard_asistencia_periodo_abierto()
returns trigger language plpgsql as $$
declare v_estado text;
begin
  select p.estado into v_estado
  from emergencia e join periodo p on p.id = e.periodo_id
  where e.id = coalesce(new.emergencia_id, old.emergencia_id);
  if v_estado = 'cerrado' then
    raise exception 'El período de esa emergencia está cerrado'
      using errcode = '55006';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger t_guard_asistencia
  before insert or update or delete on emergencia_asistencia
  for each row execute function guard_asistencia_periodo_abierto();

-- El bombero de la asistencia debe pertenecer al mismo cuartel del período.
create or replace function guard_asistencia_cuartel()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1
    from emergencia e
    join periodo p on p.id = e.periodo_id
    join bombero b on b.id = new.bombero_id
    where e.id = new.emergencia_id and b.cuartel_id = p.cuartel_id
  ) then
    raise exception 'El bombero no pertenece al cuartel de esa emergencia'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger t_guard_asistencia_cuartel
  before insert or update on emergencia_asistencia
  for each row execute function guard_asistencia_cuartel();
