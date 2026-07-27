-- =====================================================================
-- 02_views.sql — Capa de cálculo (todo derivado, nada almacenado)
-- =====================================================================

-- Rango de fechas y días del período.
create or replace view v_base_periodo as
select
  p.id as periodo_id,
  p.cuartel_id,
  p.config_id,
  p.estado,
  daterange(
    make_date(p.anio, p.mes, 1),
    (make_date(p.anio, p.mes, 1) + interval '1 month')::date,
    '[)'
  ) as rango_fechas,
  extract(day from (make_date(p.anio, p.mes, 1)
                    + interval '1 month - 1 day'))::int as dias_mes
from periodo p;

-- Días efectivamente disponibles por bombero (descuenta novedades).
-- Cuenta días distintos: novedades solapadas no se suman dos veces.
create or replace view v_disponibilidad as
select
  bp.periodo_id,
  b.id as bombero_id,
  bp.dias_mes,
  greatest(bp.dias_mes - coalesce(d.dias_baja, 0), 1) as dias_disponibles
from v_base_periodo bp
join bombero b
  on b.cuartel_id = bp.cuartel_id
 and b.activo
 and b.evaluable
left join lateral (
  select count(distinct g.dia)::int as dias_baja
  from novedad_personal n
  cross join lateral generate_series(
    greatest(n.desde, lower(bp.rango_fechas)),
    least(n.hasta, (upper(bp.rango_fechas) - 1)),
    interval '1 day'
  ) as g(dia)
  where n.bombero_id = b.id
    and n.afecta_meta
    and daterange(n.desde, n.hasta, '[]') && bp.rango_fechas
) d on true;

-- Horas de guardia normalizadas contra la meta ajustada.
create or replace view v_guardia_periodo as
select
  d.periodo_id,
  d.bombero_id,
  coalesce(g.horas, 0) as horas,
  round(c.meta_horas_mes * d.dias_disponibles / d.dias_mes, 2) as meta_ajustada,
  least(
    coalesce(g.horas, 0)
      / nullif(c.meta_horas_mes * d.dias_disponibles / d.dias_mes, 0),
    1.0
  ) as n_guardia,
  greatest(
    coalesce(g.horas, 0) - c.meta_horas_mes * d.dias_disponibles / d.dias_mes,
    0
  ) as excedente
from v_disponibilidad d
join v_base_periodo bp    on bp.periodo_id = d.periodo_id
join config_evaluacion c  on c.id = bp.config_id
left join lateral (
  select sum(rg.horas) as horas
  from registro_guardia rg
  where rg.periodo_id = d.periodo_id
    and rg.bombero_id = d.bombero_id
) g on true;

-- Presentismo en salidas, ponderado por peso del evento.
-- El denominador excluye los eventos en los que el bombero no era convocable.
create or replace view v_salidas_periodo as
select
  e.periodo_id,
  ea.bombero_id,
  count(*) filter (where ea.estado = 'presente') as salidas_presente,
  count(*) filter (where ea.estado in ('presente','ausente')) as salidas_convocable,
  coalesce(sum(e.peso) filter (where ea.estado = 'presente'), 0) as pond_presente,
  coalesce(sum(e.peso) filter (where ea.estado in ('presente','ausente')), 0) as pond_convocable
from emergencia e
join emergencia_asistencia ea on ea.emergencia_id = e.id
where e.computable
group by e.periodo_id, ea.bombero_id;

-- Puntaje en vivo mientras el período está abierto.
create or replace view v_puntaje_mensual as
with base as (
  select
    g.periodo_id,
    g.bombero_id,
    g.horas,
    g.meta_ajustada,
    g.excedente,
    g.n_guardia,
    coalesce(s.salidas_presente, 0)   as salidas_presente,
    coalesce(s.salidas_convocable, 0) as salidas_convocable,
    case when coalesce(s.pond_convocable, 0) = 0 then null
         else s.pond_presente / s.pond_convocable end as n_salidas,
    em.orden_interno, em.capacitacion, em.protocolar,
    em.cursos, em.cambio_guardia, em.conducta,
    coalesce(em.no_aplica, '{}'::text[]) as no_aplica,
    c.pesos, c.tope_por_piso, c.piso_guardia, c.piso_salidas
  from v_guardia_periodo g
  left join v_salidas_periodo s
         on s.periodo_id = g.periodo_id and s.bombero_id = g.bombero_id
  left join evaluacion_mensual em
         on em.periodo_id = g.periodo_id and em.bombero_id = g.bombero_id
  join v_base_periodo bp   on bp.periodo_id = g.periodo_id
  join config_evaluacion c on c.id = bp.config_id
),
largo as (
  select
    b.periodo_id, b.bombero_id, x.cat, x.valor,
    (b.pesos ->> x.cat)::numeric as peso
  from base b
  cross join lateral (values
    ('guardia',        b.n_guardia),
    ('salidas',        b.n_salidas),
    ('orden_interno',  b.orden_interno  / 10.0),
    ('capacitacion',   b.capacitacion   / 10.0),
    ('protocolar',     b.protocolar     / 10.0),
    ('cursos',         b.cursos         / 10.0),
    ('cambio_guardia', b.cambio_guardia / 10.0),
    ('conducta',       b.conducta       / 10.0)
  ) as x(cat, valor)
  where x.valor is not null
    and not (x.cat = any (b.no_aplica))
),
-- El total de pesos se calcula aparte: hace falta dentro del jsonb del
-- desglose, y un agregado no puede contener otro agregado ni una ventana.
pesos_totales as (
  select periodo_id, bombero_id, sum(peso) as peso_aplicado
  from largo
  group by periodo_id, bombero_id
),
agregado as (
  select
    l.periodo_id, l.bombero_id,
    t.peso_aplicado,
    round(100 * sum(l.valor * l.peso) / nullif(t.peso_aplicado, 0), 2) as puntaje_bruto,
    -- 'aporte' es la contribución renormalizada: los aportes suman puntaje_bruto.
    jsonb_object_agg(l.cat, jsonb_build_object(
      'n',      round(l.valor, 4),
      'peso',   l.peso,
      'aporte', round(100 * l.valor * l.peso / nullif(t.peso_aplicado, 0), 2)
    )) as detalle
  from largo l
  join pesos_totales t
    on t.periodo_id = l.periodo_id and t.bombero_id = l.bombero_id
  group by l.periodo_id, l.bombero_id, t.peso_aplicado
),
final as (
  select
    b.periodo_id,
    b.bombero_id,
    b.horas,
    b.meta_ajustada,
    b.excedente,
    b.salidas_presente,
    b.salidas_convocable,
    round(b.n_guardia * 100, 2) as pct_guardia,
    round(b.n_salidas * 100, 2) as pct_salidas,
    a.puntaje_bruto,
    coalesce(pen.puntos, 0) as penalizaciones,
    least(
      greatest(a.puntaje_bruto - coalesce(pen.puntos, 0), 0),
      case when b.n_guardia < b.piso_guardia
             or coalesce(b.n_salidas, 1) < b.piso_salidas
           then b.tope_por_piso else 100 end
    ) as puntaje_final,
    (b.n_guardia < b.piso_guardia
     or coalesce(b.n_salidas, 1) < b.piso_salidas) as tope_aplicado,
    b.no_aplica,
    a.peso_aplicado,
    a.detalle
  from base b
  join agregado a on a.periodo_id = b.periodo_id and a.bombero_id = b.bombero_id
  left join lateral (
    select sum(p.puntos) as puntos
    from penalizacion p
    where p.periodo_id = b.periodo_id and p.bombero_id = b.bombero_id
  ) pen on true
)
select
  f.*,
  -- Quien no alcanzó el piso operativo no puede quedar en una banda que se
  -- lea como aceptable, sin importar dónde el cuartel fije tope_por_piso.
  case
    when f.tope_aplicado and f.puntaje_final >= 45 then 'requiere_mejora'
    when f.puntaje_final >= 90 then 'destacado'
    when f.puntaje_final >= 75 then 'muy_bueno'
    when f.puntaje_final >= 60 then 'satisfactorio'
    when f.puntaje_final >= 45 then 'requiere_mejora'
    else 'critico'
  end as banda,
  jsonb_build_object(
    'categorias',     f.detalle,
    'peso_aplicado',  f.peso_aplicado,
    'no_aplica',      to_jsonb(f.no_aplica),
    'tope_aplicado',  f.tope_aplicado,
    'penalizaciones', f.penalizaciones
  ) as desglose
from final f;

-- Vista unificada para reportes: período abierto lee la vista,
-- período cerrado lee la foto congelada.
create or replace view v_puntaje_consolidado as
select r.periodo_id, r.bombero_id, r.pct_guardia, r.pct_salidas,
       r.puntaje_bruto, r.penalizaciones, r.puntaje_final, r.banda,
       r.desglose, 'cerrado'::text as origen
from resultado_mensual r
union all
select v.periodo_id, v.bombero_id, v.pct_guardia, v.pct_salidas,
       v.puntaje_bruto, v.penalizaciones, v.puntaje_final, v.banda,
       v.desglose, 'en_vivo'::text
from v_puntaje_mensual v
join periodo p on p.id = v.periodo_id
where p.estado = 'abierto';
