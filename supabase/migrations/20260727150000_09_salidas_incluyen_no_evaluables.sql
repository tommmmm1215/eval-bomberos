-- =====================================================================
--  Las salidas registran a toda la dotación activa, no sólo a los
--  evaluables.
--
--  El jefe, los administrativos y los honorarios tienen evaluable = false
--  porque no se les pone nota. Pero salen. Y la planilla de una salida
--  responde una pregunta operativa —quién fue— que es anterior e
--  independiente de la evaluación: si al mes siguiente hay que saber
--  quiénes estuvieron en el incendio del 12, la respuesta no puede
--  depender de a quién se le pone nota.
--
--  Antes esto era imposible aunque la interfaz los mostrara: el insert
--  filtraba `and b.evaluable`, así que la fila no se creaba nunca.
-- =====================================================================

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
      -- 'presente' va primero y sin mirar evaluable: si salió, salió, y eso
      -- se registra para todos por igual. Es el dato que se venía perdiendo.
      when b.id = any (p_presentes) then 'presente'

      -- A quien no se evalúa no se le cuenta una ausencia por no ir: no
      -- tiene meta que incumplir. Va antes que la novedad porque su
      -- condición no depende del día.
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

  return v_emergencia;
end $$;

-- Los puntajes no se tocan, y no es por suerte: v_puntaje_mensual arranca
-- `from v_guardia_periodo`, que a su vez sale de v_disponibilidad, que
-- filtra `and b.evaluable`. v_salidas_periodo entra por LEFT JOIN, así que
-- un no evaluable puede tener filas de asistencia sin aparecer jamás en el
-- puntaje. No hay denominador que se infle.

revoke execute on function
  registrar_emergencia(uuid,timestamptz,text,uuid[],numeric,text,uuid[])
from public, anon;
grant execute on function
  registrar_emergencia(uuid,timestamptz,text,uuid[],numeric,text,uuid[])
to authenticated;
