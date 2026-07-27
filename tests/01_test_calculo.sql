\set ON_ERROR_STOP on
begin;

-- ── Seed ─────────────────────────────────────────────────────────────
insert into cuartel (id, nombre) values
  ('11111111-1111-1111-1111-111111111111', 'Cuartel Central');

insert into auth.users (id) values
  ('99999999-9999-9999-9999-999999999999');

insert into config_evaluacion (id, cuartel_id, vigente_desde, meta_horas_mes, pesos)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', '2026-01-01', 24,
        '{"guardia":25,"salidas":25,"orden_interno":10,"capacitacion":10,
          "protocolar":5,"cursos":8,"cambio_guardia":7,"conducta":10}'::jsonb);

insert into bombero (id, cuartel_id, user_id, legajo, nombre, rango, evaluable) values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   '99999999-9999-9999-9999-999999999999','0001','Jefe Ruiz','jefe', false),
  ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
   null,'0002','A. Pérez','bombero', true),
  ('aaaaaaaa-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
   null,'0003','B. Gómez','bombero', true),
  ('aaaaaaaa-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111',
   null,'0004','C. Díaz','cabo', true),
  ('aaaaaaaa-0000-0000-0000-000000000005','11111111-1111-1111-1111-111111111111',
   null,'0005','D. Sosa','bombero', true);

set local "request.jwt.claim.sub" = '99999999-9999-9999-9999-999999999999';

select abrir_periodo('11111111-1111-1111-1111-111111111111', 2026, 7) as periodo \gset

-- ── Carga mensual de guardias ────────────────────────────────────────
-- Los totales son los mismos que cuando esto se cargaba semana por semana
-- (24, 19, 5 y 24), así que las aserciones de puntaje de más abajo siguen
-- valiendo. Lo que cambió es la forma de cargarlos, no el resultado.
select upsert_guardias_mes(:'periodo', '[
  {"bombero_id":"aaaaaaaa-0000-0000-0000-000000000002","horas":24},
  {"bombero_id":"aaaaaaaa-0000-0000-0000-000000000003","horas":99},
  {"bombero_id":"aaaaaaaa-0000-0000-0000-000000000004","horas":5},
  {"bombero_id":"aaaaaaaa-0000-0000-0000-000000000005","horas":24}]'::jsonb);

-- Reenvío correctivo: el 99 fue un dedazo. Tiene que pisarlo y quedar en 19,
-- no sumarse y dar 118. Es el caso real de la fila que se vuelve a cargar.
select upsert_guardias_mes(:'periodo', '[
  {"bombero_id":"aaaaaaaa-0000-0000-0000-000000000003","horas":19}]'::jsonb);

do $$
begin
  assert (select horas from registro_guardia
          where bombero_id = 'aaaaaaaa-0000-0000-0000-000000000003') = 19,
         'El reenvío tiene que pisar el valor, no acumularlo';
  assert (select count(*) from registro_guardia
          where bombero_id = 'aaaaaaaa-0000-0000-0000-000000000003') = 1,
         'Una sola fila por bombero y mes';
  raise notice 'OK — la carga mensual es idempotente';
end $$;

-- Sosa: licencia médica de 15 días (1 al 15 de julio)
insert into novedad_personal (bombero_id, desde, hasta, tipo) values
  ('aaaaaaaa-0000-0000-0000-000000000005','2026-07-01','2026-07-15','licencia_medica'),
  -- novedad solapada: no debe contarse dos veces
  ('aaaaaaaa-0000-0000-0000-000000000005','2026-07-10','2026-07-14','comision');

-- ── Cuatro emergencias ───────────────────────────────────────────────
select registrar_emergencia(:'periodo', '2026-07-03 04:00-03', 'incendio',
  array['aaaaaaaa-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000003',
        'aaaaaaaa-0000-0000-0000-000000000004']::uuid[]);
select registrar_emergencia(:'periodo', '2026-07-09 15:00-03', 'rescate',
  array['aaaaaaaa-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000004']::uuid[]);
select registrar_emergencia(:'periodo', '2026-07-18 22:00-03', 'incendio',
  array['aaaaaaaa-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000004']::uuid[]);
select registrar_emergencia(:'periodo', '2026-07-25 11:00-03', 'accidente',
  array['aaaaaaaa-0000-0000-0000-000000000004']::uuid[]);

-- ── Notas manuales ───────────────────────────────────────────────────
-- Pérez y Gómez quedan en el default 7 en todo.
-- Díaz: todo 10 pero casi sin horas de guardia → debe activar el tope.
update evaluacion_mensual set
  orden_interno=10, capacitacion=10, protocolar=10,
  cursos=10, cambio_guardia=10, conducta=10,
  comentario_jefe='Desempeño técnico sobresaliente en todos los ejercicios.'
where periodo_id = :'periodo'
  and bombero_id = 'aaaaaaaa-0000-0000-0000-000000000004';
-- Gómez: no hubo cursos asignados → categoría fuera del divisor
update evaluacion_mensual set no_aplica = array['cursos']
where periodo_id = :'periodo'
  and bombero_id = 'aaaaaaaa-0000-0000-0000-000000000003';

insert into penalizacion (periodo_id, bombero_id, tipo, puntos, motivo)
values (:'periodo','aaaaaaaa-0000-0000-0000-000000000002',
        'apercibimiento', 5, 'Llegada tarde reiterada al relevo');

-- ── Aserciones ───────────────────────────────────────────────────────
\echo '--- Resultados ---'
select b.nombre, v.horas, v.meta_ajustada, v.pct_guardia,
       v.salidas_presente || '/' || v.salidas_convocable as salidas,
       v.pct_salidas, v.puntaje_bruto, v.penalizaciones,
       v.puntaje_final, v.tope_aplicado, v.banda
from v_puntaje_mensual v
join bombero b on b.id = v.bombero_id
where v.periodo_id = :'periodo'
order by b.legajo;

do $$
declare r record; p uuid;
begin
  select id into p from periodo where anio = 2026 and mes = 7;

  -- Pérez: 24h/24 = 100%; 3 de 4 salidas = 75%; notas 7
  -- 25*1.0 + 25*0.75 + 50*0.7 = 78.75 ; menos 5 de penalización = 73.75
  select * into r from v_puntaje_mensual
   where periodo_id = p and bombero_id = 'aaaaaaaa-0000-0000-0000-000000000002';
  assert r.pct_guardia = 100.00,   'Pérez pct_guardia: ' || r.pct_guardia;
  assert r.pct_salidas = 75.00,    'Pérez pct_salidas: ' || r.pct_salidas;
  assert r.puntaje_bruto = 78.75,  'Pérez bruto: '       || r.puntaje_bruto;
  assert r.puntaje_final = 73.75,  'Pérez final: '       || r.puntaje_final;

  -- Gómez: el upsert correctivo dejó 19h (6+7+6), no 25
  -- cursos N/A → divisor 92 ; 25*(19/24) + 25*0.25 + 42*0.7 = 19.79+6.25+29.4
  select * into r from v_puntaje_mensual
   where periodo_id = p and bombero_id = 'aaaaaaaa-0000-0000-0000-000000000003';
  assert r.horas = 19.00,          'Gómez horas (upsert): ' || r.horas;
  assert r.peso_aplicado = 92,     'Gómez divisor: '        || r.peso_aplicado;
  assert r.puntaje_bruto = round(100*(25*(19/24.0) + 25*0.25 + 42*0.7)/92, 2),
         'Gómez bruto: ' || r.puntaje_bruto;

  -- Díaz: 5h de 24 = 20.8% → por debajo del piso de 50% ⇒ tope 60
  select * into r from v_puntaje_mensual
   where periodo_id = p and bombero_id = 'aaaaaaaa-0000-0000-0000-000000000004';
  assert r.tope_aplicado,          'Díaz debía activar el tope';
  assert r.puntaje_bruto > 60,     'Díaz bruto: ' || r.puntaje_bruto;
  assert r.puntaje_final = 60.00,  'Díaz final: ' || r.puntaje_final;

  -- Sosa: 15 días de licencia (las dos novedades se solapan: 15 días, no 20)
  -- meta = 24 * 16/31 = 12.39 ; 24h cargadas ⇒ tope 100%
  -- las 2 emergencias durante la licencia se marcaron no_convocable solas;
  -- las 2 posteriores al alta sí computan y no asistió ⇒ 0/2
  select * into r from v_puntaje_mensual
   where periodo_id = p and bombero_id = 'aaaaaaaa-0000-0000-0000-000000000005';
  assert r.meta_ajustada = 12.39,     'Sosa meta ajustada: '  || r.meta_ajustada;
  assert r.pct_guardia = 100.00,      'Sosa pct_guardia: '    || r.pct_guardia;
  assert r.salidas_convocable = 2,    'Sosa convocables: '    || r.salidas_convocable;
  assert r.pct_salidas = 0.00,        'Sosa pct_salidas: '    || r.pct_salidas;
  assert r.tope_aplicado,             'Sosa debía topearse por presentismo';

  -- El jefe integra la dotación pero no es evaluable: no debe figurar
  assert not exists (select 1 from v_puntaje_mensual
                     where periodo_id = p
                       and bombero_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
         'El personal no evaluable no debe aparecer en el ranking';

  -- El desglose tiene que reconstruir el puntaje: es lo que se le muestra
  -- al bombero ante un reclamo. Si no suma, el número no es defendible.
  assert not exists (
    select 1
    from v_puntaje_mensual v
    cross join lateral (
      select round(sum((e.value->>'aporte')::numeric), 2) as s
      from jsonb_each(v.desglose->'categorias') e
    ) d
    where v.periodo_id = p and abs(d.s - v.puntaje_bruto) > 0.05
  ), 'Los aportes del desglose no reconstruyen el puntaje_bruto';

  -- Quien activa el tope no puede leerse como aceptable, aunque el tope
  -- coincida con el piso de la banda 'satisfactorio'.
  assert (select banda from v_puntaje_mensual
          where periodo_id = p
            and bombero_id = 'aaaaaaaa-0000-0000-0000-000000000004')
         = 'requiere_mejora',
         'Díaz activó el tope: no puede quedar en banda satisfactorio';

  raise notice 'OK — cálculo validado';
end $$;

-- ── Cierre y bloqueo ─────────────────────────────────────────────────
do $$
declare p uuid; n int;
begin
  select id into p from periodo where anio = 2026 and mes = 7;
  select cerrar_periodo(p) into n;
  assert n = 4, 'Debía congelar 4 filas, congeló ' || n;

  -- Un UPDATE y no un INSERT: con una fila por bombero y mes, insertar
  -- chocaría contra el unique y el test pasaría por el motivo equivocado.
  -- El trigger t_guard_registro_guardia cubre insert, update y delete.
  begin
    update registro_guardia set horas = 3
    where periodo_id = p and bombero_id = 'aaaaaaaa-0000-0000-0000-000000000002';
    raise exception 'FALLO: aceptó carga en período cerrado';
  exception when sqlstate '55006' then
    raise notice 'OK — período cerrado rechaza escrituras';
  end;

  assert (select count(*) from v_puntaje_consolidado where periodo_id = p) = 4,
         'El consolidado debe leer la foto, no la vista en vivo';
  assert (select origen from v_puntaje_consolidado
          where periodo_id = p limit 1) = 'cerrado',
         'El origen debía ser cerrado';
  raise notice 'OK — cierre y consolidado';
end $$;

rollback;
