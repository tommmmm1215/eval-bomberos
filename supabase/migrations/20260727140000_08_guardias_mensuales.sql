-- =====================================================================
--  Las horas de guardia se cargan por mes, no por semana.
--
--  La semana nunca afectó el cálculo: v_guardia_periodo hace
--  `sum(rg.horas)` sobre todo el período sin filtrar, y la meta se ajusta
--  por días disponibles (v_disponibilidad), no por semanas. Era una
--  subdivisión de la carga, no del modelo.
--
--  Y como subdivisión de carga costaba: obligaba a elegir una semana antes
--  de tipear nada, y a repetir la operación cinco veces por mes para algo
--  que el jefe tiene anotado como un total.
-- =====================================================================

-- ---------------------------------------------------------------------
--  1. Consolidar lo que ya está cargado
-- ---------------------------------------------------------------------
-- Primero se junta, después se toca la estructura. Al revés, las filas de
-- un mismo bombero quedarían duplicadas y el unique nuevo fallaría a mitad
-- de la migración.
--
-- No se usa una tabla temporal a propósito: `on commit drop` depende de
-- cómo envuelva la transacción quien corra esto, y si el envoltorio no es
-- el esperado la tabla desaparece antes del insert final. Trabajar sobre
-- la tabla real no depende de nada de eso.

-- La fila más vieja de cada bombero se queda con el total del mes.
update registro_guardia rg
set horas = t.total
from (
  select periodo_id, bombero_id, sum(horas) as total, min(id) as id_base
  from registro_guardia
  group by periodo_id, bombero_id
) t
where rg.id = t.id_base;

-- Y las demás se van.
delete from registro_guardia rg
where rg.id not in (
  select min(id) from registro_guardia group by periodo_id, bombero_id
);

-- ---------------------------------------------------------------------
--  2. Sacar la semana
-- ---------------------------------------------------------------------
-- Al dropear la columna, Postgres se lleva puestos el unique
-- (periodo_id, bombero_id, semana) y el check de 1..6 que dependían de
-- ella. No hay que dropearlos a mano.

alter table registro_guardia drop column semana;

alter table registro_guardia
  add constraint registro_guardia_periodo_bombero_key
  unique (periodo_id, bombero_id);

-- El tope de 168 era el de una semana: 7 × 24. Con carga mensual el mismo
-- número rechazaría una carga legítima de alguien que hace muchas guardias.
-- 744 es el mes más largo, 31 × 24: sigue atajando el dedazo —un 2400 por
-- tipear de más— sin negarse a un valor real.
alter table registro_guardia drop constraint registro_guardia_horas_check;
alter table registro_guardia
  add constraint registro_guardia_horas_check
  check (horas >= 0 and horas <= 744);

-- ---------------------------------------------------------------------
--  3. La RPC
-- ---------------------------------------------------------------------

drop function if exists upsert_guardias_semana(uuid, int, jsonb);

-- Carga mensual de horas. Idempotente: reenviar el mes corrige el valor, no
-- lo acumula. Es lo que permite volver sobre una fila mal tipeada sin tener
-- que borrar nada primero.
--
-- p_registros: [{"bombero_id":"...","horas":26.5}, ...]
create or replace function upsert_guardias_mes(
  p_periodo uuid, p_registros jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare filas int;
begin
  if not app_es_jefe(app_cuartel_de_periodo(p_periodo)) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  insert into registro_guardia (periodo_id, bombero_id, horas, cargado_por)
  select p_periodo,
         (r ->> 'bombero_id')::uuid,
         (r ->> 'horas')::numeric,
         (select auth.uid())
  from jsonb_array_elements(p_registros) as r
  on conflict (periodo_id, bombero_id)
  do update set horas       = excluded.horas,
                cargado_por = excluded.cargado_por,
                updated_at  = now();

  get diagnostics filas = row_count;
  return filas;
end $$;

-- Mismo criterio que el resto de las RPC: se revoca a todos y se otorga
-- sólo a authenticated. La autorización real no la da el grant sino el
-- app_es_jefe() de arriba.
revoke execute on function upsert_guardias_mes(uuid, jsonb) from public, anon;
grant  execute on function upsert_guardias_mes(uuid, jsonb) to authenticated;
