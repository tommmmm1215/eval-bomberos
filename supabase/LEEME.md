# Migraciones

Las migraciones de esta carpeta **ya están todas aplicadas** en el proyecto
`bomberos-espartillar-staging` (`azyinwfguzohifjfiazw`).

## Cómo se aplican

Por el **SQL Editor** del panel de Supabase, no por CLI. Se pega el contenido
del archivo, se ejecuta, y se anota la migración a mano:

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20260727150000', '09_salidas_incluyen_no_evaluables');
```

Ese `insert` no es opcional. Es lo que evita que un `supabase db push` futuro
intente aplicar de nuevo algo que ya está, que en el mejor caso falla con un
error confuso y en el peor borra datos: la 08, sin ir más lejos, arranca
consolidando filas y borrando las sobrantes.

**El `version` tiene que ser exactamente el prefijo del nombre del archivo.**
Es la única cosa que mantiene sincronizadas la carpeta y la base.

## Por qué a mano y no con el CLI

Las primeras migraciones se aplicaron partidas en pedazos más chicos y con
otros nombres (`02a_views_base`, `02b_views_puntaje`, `06_revocar_helpers_de_public`),
así que durante un tiempo la carpeta y la base contaron historias distintas:
9 archivos acá contra 16 filas allá. Un `supabase db push` en ese estado
habría intentado reaplicar todo desde el principio.

Eso ya se corrigió: el historial de la base se reescribió para que liste
exactamente estos 9 archivos. El esquema no se tocó —`schema_migrations` es
sólo el cuaderno de anotaciones—, pero desde ahora las dos versiones coinciden.

Si algún día instalás el CLI, `supabase db push` va a ver que está todo
aplicado y no va a hacer nada. Que es lo correcto.

## Orden

| Archivo | Contenido |
|---|---|
| `01_schema` | Tablas, constraints, triggers de integridad y de bloqueo por cierre |
| `02_views` | Normalización, ponderación y puntaje en vivo |
| `03_functions` | RPC de carga rápida y ciclo de vida del período |
| `04_rls` | Políticas RLS |
| `05_permisos` | `search_path` fijo y revocación de `EXECUTE` a `anon` |
| `06_dni_y_fotos` | DNI, bucket privado de retratos y sus políticas |
| `07_revocar_tablas_de_anon` | Cierre del acceso directo a tablas |
| `08_guardias_mensuales` | Las horas se cargan por mes: se va la columna `semana` |
| `09_salidas_incluyen_no_evaluables` | El jefe y los administrativos figuran en las salidas |

## Los seeds

`seed_ejemplo.sql` tiene datos ficticios y está versionado.
`seed_espartillar.sql` tiene el padrón real con DNI y **está excluido por
`.gitignore`**: no entra al repositorio, que es público.
