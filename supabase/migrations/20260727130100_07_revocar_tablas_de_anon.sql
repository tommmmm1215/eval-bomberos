-- =====================================================================
-- 07_revocar_tablas_de_anon.sql — Defensa en profundidad
--
-- Hoy el RLS ya bloquea a `anon`: no hay ninguna política escrita para ese
-- rol, y con RLS activo eso significa cero filas. Verificado con
-- `set local role anon; select count(*) from bombero;` → 0.
--
-- Pero el grant de tabla sigue ahí, otorgado por los default privileges de
-- Supabase. El día que alguien agregue una política `to public` sin
-- pensarlo, ese grant es lo único que decide si se filtran DNI y legajos.
-- La app entera corre como `authenticated`; anon no necesita nada.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise notice 'Sin rol anon (Postgres local): nada que revocar';
    return;
  end if;

  execute $r$
    revoke all on table
      cuartel, bombero, config_evaluacion, periodo,
      registro_guardia, emergencia, emergencia_asistencia,
      novedad_personal, evaluacion_mensual, penalizacion, resultado_mensual
    from anon
  $r$;

  execute $r$
    revoke all on table
      v_base_periodo, v_disponibilidad, v_guardia_periodo, v_salidas_periodo,
      v_puntaje_mensual, v_puntaje_consolidado
    from anon
  $r$;
end $$;
