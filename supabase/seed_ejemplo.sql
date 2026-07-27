-- =====================================================================
-- seed_ejemplo.sql — Alta inicial de un cuartel, con datos ficticios
--
-- Esta es la versión versionada en el repositorio. El padrón real vive
-- en `seed_espartillar.sql`, que está en .gitignore: son nombres y DNI
-- de personas reales y no corresponde que estén en un repo público.
--
-- Se corre UNA sola vez, desde el SQL Editor de Supabase o con la
-- service_role key. No se puede hacer desde la app, y es a propósito:
--
--   · `cuartel` no tiene política de INSERT. Nadie crea cuarteles por API.
--   · `bombero_escritura` exige `app_es_jefe(cuartel_id)`, que consulta si
--     existe una fila de bombero con rango de mando para el usuario. El
--     primer jefe no puede darse de alta a sí mismo: no es jefe todavía.
--
-- Ese huevo-y-gallina es la garantía de que nadie se autoproclame jefe
-- registrándose en la app. El precio es este script manual.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PASO 1 — El cuartel
-- ---------------------------------------------------------------------

insert into cuartel (id, nombre, localidad)
values ('00000000-0000-0000-0000-0000000000e1',
        'Bomberos Voluntarios de la Localidad', 'Localidad')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- PASO 2 — Configuración de evaluación
--
-- VALORES PROVISORIOS. Calibrar con el jefe antes de que el puntaje
-- tenga consecuencias. Para cambiarlos no se edita esta fila: se inserta
-- una nueva con otro `vigente_desde`, y los meses ya cerrados conservan
-- la suya. Ver §5 de LOGICA_SISTEMA.md.
-- ---------------------------------------------------------------------

insert into config_evaluacion
  (cuartel_id, vigente_desde, meta_horas_mes, pesos, tope_por_piso,
   piso_guardia, piso_salidas)
values
  ('00000000-0000-0000-0000-0000000000e1', '2026-01-01', 24,
   '{"guardia":25,"salidas":25,"orden_interno":10,"capacitacion":10,
     "protocolar":5,"cursos":8,"cambio_guardia":7,"conducta":10}'::jsonb,
   60, 0.50, 0.40)
on conflict (cuartel_id, vigente_desde) do nothing;

-- ---------------------------------------------------------------------
-- PASO 3 — El jefe
--
-- Antes de correr esto, crear su usuario en Supabase Auth
-- (Authentication → Users → Invite, con su email real). Recién entonces
-- existe el uuid que va acá.
--
-- `evaluable = false`: integra la dotación pero no se evalúa a sí mismo,
-- así que no aparece en el ranking.
-- ---------------------------------------------------------------------

insert into bombero (cuartel_id, legajo, nombre, dni, rango, evaluable)
values ('00000000-0000-0000-0000-0000000000e1',
        '001', 'APELLIDO, Nombre del jefe', '30000001', 'jefe', false)
on conflict (cuartel_id, legajo) do nothing;

-- Una vez creado el usuario en Supabase Auth, se vincula por email
-- para no tener que copiar el uuid a mano:
--
-- update bombero
-- set user_id = (select id from auth.users where email = 'jefe@ejemplo.com')
-- where legajo = '001';

-- ---------------------------------------------------------------------
-- PASO 4 — La dotación
--
-- Los bomberos NO llevan `user_id`: no tienen cuenta, no entran al
-- sistema. La columna queda null y el RLS de autoconsulta simplemente
-- no tiene a quién aplicarse.
--
-- De acá en adelante el jefe ya puede cargar bomberos desde la app.
-- Este bloque es sólo por si conviene migrar el padrón de una vez.
-- ---------------------------------------------------------------------

insert into bombero (cuartel_id, legajo, nombre, dni, rango, evaluable) values
  ('00000000-0000-0000-0000-0000000000e1','002','PEREZ, Ana Maria','30000002','bombero',true),
  ('00000000-0000-0000-0000-0000000000e1','003','GOMEZ, Carlos Alberto','30000003','bombero',true),
  ('00000000-0000-0000-0000-0000000000e1','004','DIAZ, Lucia Beatriz','30000004','cabo',true),
  ('00000000-0000-0000-0000-0000000000e1','005','SOSA, Martin Ezequiel','30000005','bombero',true)
on conflict (cuartel_id, legajo) do nothing;

-- ---------------------------------------------------------------------
-- PASO 5 — Verificación
--
-- `app_es_jefe()` se apoya en `auth.uid()`, que en el SQL Editor es null:
-- si se la llama a secas devuelve false aunque esté todo bien. Hay que
-- simular el token.
-- ---------------------------------------------------------------------

-- begin;
-- select set_config('request.jwt.claim.sub',
--                   (select user_id::text from bombero where legajo = '001'), true);
-- select set_config('request.jwt.claims',
--                   json_build_object('sub', (select user_id from bombero where legajo = '001'))::text, true);
-- select app_es_jefe('00000000-0000-0000-0000-0000000000e1');  -- debe dar true
-- rollback;

-- ---------------------------------------------------------------------
-- PASO 6 — Abrir el primer período
-- ---------------------------------------------------------------------

-- select abrir_periodo('00000000-0000-0000-0000-0000000000e1', 2026, 8);
