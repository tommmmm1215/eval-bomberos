-- =====================================================================
-- 05_permisos.sql — Endurecimiento de permisos de ejecución
--
-- Salió de los advisors de Supabase sobre el proyecto ya desplegado.
-- Dos cosas que no se ven corriendo Postgres a secas:
--
-- 1. Supabase aplica `alter default privileges ... grant execute on
--    functions to anon, authenticated, service_role`. Toda función creada
--    en `public` nace invocable desde `/rest/v1/rpc/...` por cualquiera
--    que tenga la anon key, sin iniciar sesión.
-- 2. `revoke ... from public` no borra los grants otorgados a roles
--    concretos, y `revoke ... from anon` no sirve mientras PUBLIC
--    conserve el permiso, porque todo rol hereda de PUBLIC.
--
-- Hay que revocar de PUBLIC *y* de anon, y reotorgar a authenticated.
-- =====================================================================

-- --- search_path fijo en las funciones de trigger --------------------
-- No son security definer, pero un search_path mutable permite que el rol
-- que dispara el trigger resuelva los nombres contra otro esquema.

alter function valida_pesos()                     set search_path = public;
alter function touch_updated_at()                 set search_path = public;
alter function guard_periodo_abierto()            set search_path = public;
alter function guard_asistencia_periodo_abierto() set search_path = public;
alter function guard_asistencia_cuartel()         set search_path = public;

-- --- RPC: fuera del alcance de anon ----------------------------------

revoke execute on function
  abrir_periodo(uuid,int,int),
  cerrar_periodo(uuid),
  reabrir_periodo(uuid,text),
  inicializar_evaluaciones(uuid),
  upsert_guardias_semana(uuid,int,jsonb),
  registrar_emergencia(uuid,timestamptz,text,uuid[],numeric,text,uuid[])
from public, anon;

grant execute on function
  abrir_periodo(uuid,int,int),
  cerrar_periodo(uuid),
  reabrir_periodo(uuid,text),
  upsert_guardias_semana(uuid,int,jsonb),
  registrar_emergencia(uuid,timestamptz,text,uuid[],numeric,text,uuid[])
to authenticated;

-- inicializar_evaluaciones queda sin grant para nadie: es interna.
-- abrir_periodo la invoca y, por ser security definer, corre como owner.

-- --- Helpers de identidad --------------------------------------------
-- authenticated los necesita porque las políticas RLS se evalúan con los
-- privilegios de quien consulta. anon no: sin ellos no puede enumerar a
-- qué cuartel pertenece un legajo pasando UUIDs a /rest/v1/rpc.

revoke execute on function
  app_bombero_id(),
  app_es_jefe(uuid),
  app_cuartel_actual(),
  app_cuartel_de_bombero(uuid),
  app_cuartel_de_periodo(uuid)
from public, anon;

grant execute on function
  app_bombero_id(),
  app_es_jefe(uuid),
  app_cuartel_actual(),
  app_cuartel_de_bombero(uuid),
  app_cuartel_de_periodo(uuid)
to authenticated;
