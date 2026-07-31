-- =====================================================================
-- 04_rls.sql — Row Level Security
-- Regla general: el bombero lee lo propio; el mando escribe su cuartel.
-- auth.uid() siempre envuelto en subquery: se evalúa una vez por consulta,
-- no una vez por fila (initPlan en lugar de filtro por tupla).
-- =====================================================================

alter table cuartel               enable row level security;
alter table bombero               enable row level security;
alter table config_evaluacion     enable row level security;
alter table periodo               enable row level security;
alter table registro_guardia      enable row level security;
alter table emergencia            enable row level security;
alter table emergencia_asistencia enable row level security;
alter table novedad_personal      enable row level security;
alter table evaluacion_mensual    enable row level security;
alter table penalizacion          enable row level security;
alter table resultado_mensual     enable row level security;

-- --- Catálogo -------------------------------------------------------

create policy cuartel_lectura on cuartel for select to authenticated
using (id = app_cuartel_actual());

create policy bombero_lectura on bombero for select to authenticated
using (cuartel_id = app_cuartel_actual());

create policy bombero_escritura on bombero for all to authenticated
using (app_es_jefe(cuartel_id)) with check (app_es_jefe(cuartel_id));

create policy config_lectura on config_evaluacion for select to authenticated
using (cuartel_id = app_cuartel_actual());

create policy config_escritura on config_evaluacion for insert to authenticated
with check (app_es_jefe(cuartel_id));

create policy periodo_lectura on periodo for select to authenticated
using (cuartel_id = app_cuartel_actual());

create policy periodo_escritura on periodo for all to authenticated
using (app_es_jefe(cuartel_id)) with check (app_es_jefe(cuartel_id));

-- --- Datos crudos ---------------------------------------------------

create policy guardia_lectura on registro_guardia for select to authenticated
using (
  bombero_id = app_bombero_id()
  or app_es_jefe(app_cuartel_de_periodo(periodo_id))
);

create policy guardia_escritura on registro_guardia for all to authenticated
using (app_es_jefe(app_cuartel_de_periodo(periodo_id)))
with check (app_es_jefe(app_cuartel_de_periodo(periodo_id)));

create policy emergencia_lectura on emergencia for select to authenticated
using (app_cuartel_de_periodo(periodo_id) = app_cuartel_actual());

create policy emergencia_escritura on emergencia for all to authenticated
using (app_es_jefe(app_cuartel_de_periodo(periodo_id)))
with check (app_es_jefe(app_cuartel_de_periodo(periodo_id)));

create policy asistencia_lectura on emergencia_asistencia for select to authenticated
using (
  bombero_id = app_bombero_id()
  or app_es_jefe((select app_cuartel_de_periodo(e.periodo_id)
                  from emergencia e where e.id = emergencia_id))
);

create policy asistencia_escritura on emergencia_asistencia for all to authenticated
using (app_es_jefe((select app_cuartel_de_periodo(e.periodo_id)
                    from emergencia e where e.id = emergencia_id)))
with check (app_es_jefe((select app_cuartel_de_periodo(e.periodo_id)
                         from emergencia e where e.id = emergencia_id)));

-- Las novedades son dato sensible: solo el titular y el mando.
create policy novedad_lectura on novedad_personal for select to authenticated
using (
  bombero_id = app_bombero_id()
  or app_es_jefe(app_cuartel_de_bombero(bombero_id))
);

create policy novedad_escritura on novedad_personal for all to authenticated
using (app_es_jefe(app_cuartel_de_bombero(bombero_id)))
with check (app_es_jefe(app_cuartel_de_bombero(bombero_id)));

-- --- Evaluación -----------------------------------------------------

-- El bombero ve su propia evaluación recién cuando el período cerró.
create policy evaluacion_lectura on evaluacion_mensual for select to authenticated
using (
  app_es_jefe(app_cuartel_de_periodo(periodo_id))
  or (bombero_id = app_bombero_id()
      and (select estado from periodo where id = periodo_id) = 'cerrado')
);

create policy evaluacion_escritura on evaluacion_mensual for all to authenticated
using (app_es_jefe(app_cuartel_de_periodo(periodo_id)))
with check (app_es_jefe(app_cuartel_de_periodo(periodo_id)));

create policy penalizacion_lectura on penalizacion for select to authenticated
using (
  bombero_id = app_bombero_id()
  or app_es_jefe(app_cuartel_de_periodo(periodo_id))
);

create policy penalizacion_escritura on penalizacion for all to authenticated
using (app_es_jefe(app_cuartel_de_periodo(periodo_id)))
with check (app_es_jefe(app_cuartel_de_periodo(periodo_id)));

create policy resultado_lectura on resultado_mensual for select to authenticated
using (
  bombero_id = app_bombero_id()
  or app_es_jefe(app_cuartel_de_periodo(periodo_id))
);

-- Las vistas heredan el RLS de las tablas base (security_invoker).
alter view v_base_periodo        set (security_invoker = on);
alter view v_disponibilidad      set (security_invoker = on);
alter view v_guardia_periodo     set (security_invoker = on);
alter view v_salidas_periodo     set (security_invoker = on);
alter view v_puntaje_mensual     set (security_invoker = on);
alter view v_puntaje_consolidado set (security_invoker = on);
