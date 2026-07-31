-- =====================================================================
--  El escalafón real del cuerpo.
--
--  Los rangos que estaban eran un supuesto de arranque tomado de la
--  estructura militar genérica ('cabo', 'sargento', 'subjefe'). El cuartel
--  usa otra: suboficial subalterno, suboficial superior y segundo jefe.
--
--  No hay nada que remapear: los 18 registros cargados son 17 'bombero' y
--  1 'jefe', que sobreviven al cambio sin tocarse. Si el día de mañana
--  hubiera datos con los rangos viejos, esta migración fallaría al aplicar
--  el check nuevo —y eso es lo correcto: fallar antes que inventar una
--  equivalencia que nadie decidió.
-- =====================================================================

alter table bombero drop constraint bombero_rango_check;

alter table bombero
  add constraint bombero_rango_check
  check (rango in (
    'aspirante',
    'bombero',
    'suboficial_subalterno',
    'suboficial_superior',
    'oficial',
    'segundo_jefe',
    'jefe'
  ));

-- El default sigue siendo 'bombero': es el caso abrumadoramente mayoritario
-- y el que conviene que salga solo al dar de alta a alguien.
