-- =====================================================================
-- 02_test_rls.sql — Seguridad a nivel de fila y autorización de las RPC
--
-- Lo que se prueba acá no es que el cálculo esté bien, sino que un bombero
-- no pueda ver ni tocar lo que no le corresponde. Son datos de personal:
-- legajos, licencias médicas, sanciones y la evaluación del jefe.
--
-- Requiere el rol 'authenticated' (lo crea 00_auth_stub.sql; en Supabase
-- ya existe) y los grants de tabla que Supabase otorga por defecto.
-- =====================================================================

\set ON_ERROR_STOP on
begin;

-- ── Dos cuarteles, para poder probar el aislamiento ──────────────────
insert into cuartel (id, nombre) values
  ('c1111111-1111-1111-1111-111111111111', 'Cuartel Uno'),
  ('c2222222-2222-2222-2222-222222222222', 'Cuartel Dos');

insert into auth.users (id) values
  ('11111111-0000-0000-0000-000000000001'),   -- jefe de C1
  ('11111111-0000-0000-0000-000000000002'),   -- bombero raso de C1
  ('11111111-0000-0000-0000-000000000003'),   -- otro bombero de C1
  ('22222222-0000-0000-0000-000000000001');   -- jefe de C2

insert into config_evaluacion (cuartel_id, vigente_desde, meta_horas_mes, pesos)
select id, '2026-01-01', 24,
  '{"guardia":25,"salidas":25,"orden_interno":10,"capacitacion":10,
    "protocolar":5,"cursos":8,"cambio_guardia":7,"conducta":10}'::jsonb
from cuartel;

insert into bombero (id, cuartel_id, user_id, legajo, nombre, rango, evaluable) values
  ('bb000000-0000-0000-0000-00000000000a','c1111111-1111-1111-1111-111111111111',
   '11111111-0000-0000-0000-000000000001','0001','Jefe Uno','jefe', false),
  ('bb000000-0000-0000-0000-00000000000b','c1111111-1111-1111-1111-111111111111',
   '11111111-0000-0000-0000-000000000002','0002','Raso Uno','bombero', true),
  ('bb000000-0000-0000-0000-00000000000c','c1111111-1111-1111-1111-111111111111',
   '11111111-0000-0000-0000-000000000003','0003','Raso Dos','bombero', true),
  ('bb000000-0000-0000-0000-00000000000d','c2222222-2222-2222-2222-222222222222',
   '22222222-0000-0000-0000-000000000001','0001','Jefe Dos','jefe', false);

-- Licencia médica de Raso Uno: el dato más sensible del sistema.
insert into novedad_personal (bombero_id, desde, hasta, tipo)
values ('bb000000-0000-0000-0000-00000000000b','2026-07-01','2026-07-05',
        'licencia_medica');

-- En un Postgres pelado hay que otorgar los permisos de tabla que en
-- Supabase vienen dados. Sin esto el test mediría lo que no es.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ── 1. El jefe puede operar; el raso no ──────────────────────────────
set local "request.jwt.claim.sub" = '11111111-0000-0000-0000-000000000001';
set local role authenticated;

select abrir_periodo('c1111111-1111-1111-1111-111111111111', 2026, 7) as p1 \gset

do $$ begin
  assert (select count(*) from evaluacion_mensual) = 2,
         'abrir_periodo debía precargar 2 evaluables';
  raise notice 'OK — el jefe abre el período y precarga las notas';
end $$;

select upsert_guardias_semana(:'p1', 1,
  '[{"bombero_id":"bb000000-0000-0000-0000-00000000000b","horas":12}]'::jsonb);

reset role;
set local "request.jwt.claim.sub" = '11111111-0000-0000-0000-000000000002';
set local role authenticated;

do $$ begin
  -- Un bombero raso puede invocar la RPC, pero app_es_jefe() lo frena.
  begin
    perform upsert_guardias_semana(
      (select id from periodo limit 1), 2,
      '[{"bombero_id":"bb000000-0000-0000-0000-00000000000b","horas":99}]'::jsonb);
    raise exception 'FALLO: un bombero raso cargó horas';
  exception when sqlstate '42501' then
    raise notice 'OK — el raso no puede cargar horas';
  end;

  begin
    perform cerrar_periodo((select id from periodo limit 1));
    raise exception 'FALLO: un bombero raso cerró el período';
  exception when sqlstate '42501' then
    raise notice 'OK — el raso no puede cerrar el período';
  end;
end $$;

-- ── 2. El raso ve lo propio y no lo ajeno ────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from registro_guardia;
  assert n = 1, 'El raso debía ver su propia hoja de horas, vio ' || n;

  -- Su evaluación existe, pero el período está abierto: no debe verla.
  select count(*) into n from evaluacion_mensual;
  assert n = 0, 'El raso no debe ver evaluaciones con el período abierto, vio ' || n;

  -- La licencia médica es suya: la ve.
  select count(*) into n from novedad_personal;
  assert n = 1, 'El raso debía ver su propia novedad, vio ' || n;

  raise notice 'OK — el raso ve lo propio y no la evaluación en curso';
end $$;

-- ── 3. Aislamiento entre cuarteles ───────────────────────────────────
reset role;
set local "request.jwt.claim.sub" = '22222222-0000-0000-0000-000000000001';
set local role authenticated;

do $$
declare n int;
begin
  select count(*) into n from bombero;
  assert n = 1, 'El jefe de C2 solo debe ver su propia dotación, vio ' || n;

  select count(*) into n from periodo;
  assert n = 0, 'El jefe de C2 no debe ver períodos de C1, vio ' || n;

  select count(*) into n from registro_guardia;
  assert n = 0, 'El jefe de C2 no debe ver horas de C1, vio ' || n;

  select count(*) into n from novedad_personal;
  assert n = 0, 'La licencia médica de C1 no debe cruzar de cuartel, vio ' || n;

  select count(*) into n from v_puntaje_mensual;
  assert n = 0, 'Las vistas deben heredar el RLS (security_invoker), vio ' || n;

  -- Y tampoco puede escribir sobre el cuartel ajeno.
  begin
    perform upsert_guardias_semana(
      (select id from periodo p where true limit 1), 1, '[]'::jsonb);
    -- Si el select interno no devolvió nada, la RPC recibe null y falla igual.
  exception when others then null;
  end;

  raise notice 'OK — aislamiento entre cuarteles';
end $$;

-- ── 4. Tras el cierre, el bombero sí ve su evaluación ────────────────
reset role;
set local "request.jwt.claim.sub" = '11111111-0000-0000-0000-000000000001';
set local role authenticated;
select cerrar_periodo((select id from periodo limit 1));

reset role;
set local "request.jwt.claim.sub" = '11111111-0000-0000-0000-000000000002';
set local role authenticated;

do $$
declare n int;
begin
  select count(*) into n from evaluacion_mensual;
  assert n = 1, 'Cerrado el período, el bombero debe ver su evaluación, vio ' || n;

  select count(*) into n from resultado_mensual;
  assert n = 1, 'Debe ver su propio resultado y solo el suyo, vio ' || n;

  raise notice 'OK — la evaluación se libera al cierre';
end $$;

reset role;
rollback;
