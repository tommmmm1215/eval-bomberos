# Sistema de evaluación de rendimiento — Bomberos

Backend Postgres/Supabase. Todo porcentaje es derivado: se cargan horas,
presencias y notas; los indicadores se calculan en vistas.

La lógica funcional completa —fórmulas, rúbricas 1–10, ponderación y contratos
JSON— está en [`LOGICA_SISTEMA.md`](LOGICA_SISTEMA.md).

La aplicación de escritorio está en [`app/`](app/LEEME.md): Electron, seis
pantallas, un solo usuario. Se compila a `.exe` desde Windows con
`npm install && npm run build:win`.

La distribución y el auto-update están en
[`app/ACTUALIZACIONES.md`](app/ACTUALIZACIONES.md): instalador NSIS completo
que se manda una sola vez, y de ahí en adelante actualización automática
desde GitHub Releases publicando con `npm run publicar`.

> **Este repositorio no contiene datos personales.** El padrón real
> —nombres, DNI y retratos de la dotación— está excluido por `.gitignore` y
> vive en Supabase y en la máquina del jefe de cuartel. La versión versionada
> del alta inicial es `supabase/seed_ejemplo.sql`, con datos ficticios.
>
> La clave de Supabase que aparece en `app/renderer/js/config.js` es la
> *publicable*: es pública por diseño y no da acceso a nada por sí sola. Todo
> lo que se puede leer o escribir lo decide el RLS según quién inició sesión.

**Estado:** migraciones y ambas suites de test ejecutadas y verdes sobre
PostgreSQL 16.2 (cálculo y RLS). Desplegado en Supabase, entorno de staging:
proyecto `bomberos-espartillar-staging` (`azyinwfguzohifjfiazw`, región
sa-east-1, PG17). **Sin datos reales de personal todavía** — falta calibrar
`pesos` y `meta_horas_mes` con el jefe de cuartel.

## Aplicar

```bash
supabase db push          # aplica las migraciones en orden
psql "$DB_URL" -f supabase/seed_espartillar.sql
```

El alta inicial (cuartel, configuración y la fila del jefe) **no se puede
hacer desde la app**: `cuartel` no tiene política de INSERT y
`bombero_escritura` exige ser jefe, cosa que nadie es hasta tener su fila.
Es deliberado — impide que alguien se autoproclame jefe registrándose — y
está documentado paso a paso en `seed_espartillar.sql`.

Local sin Supabase (para tests):

```bash
psql -d bomberos -f tests/00_auth_stub.sql   # stub de auth.uid()
for f in supabase/migrations/*.sql; do psql -d bomberos -v ON_ERROR_STOP=1 -f "$f"; done
psql -d bomberos -f tests/01_test_calculo.sql   # cálculo y cierre
psql -d bomberos -f tests/02_test_rls.sql       # aislamiento y permisos
```

> `psql -f supabase/migrations/*.sql` no funciona: `-f` toma un solo archivo y el
> glob expande a cuatro. Hay que iterarlos, y en ese orden.

Sin Postgres instalado y sin root, `pip install pgserver` trae los binarios de
PG16 y `pgserver.get_server('/tmp/pgdata')` levanta una instancia local.

## Migraciones

| Archivo | Contenido |
|---|---|
| `..._01_schema.sql` | Tablas, constraints, triggers de integridad y de bloqueo por cierre |
| `..._02_views.sql` | Normalización, ponderación y puntaje en vivo |
| `..._03_functions.sql` | RPC de carga rápida y ciclo de vida del período |
| `..._04_rls.sql` | Políticas RLS |
| `..._05_permisos.sql` | `search_path` fijo y revocación de `EXECUTE` a `anon` |

## Tests

| Archivo | Cubre |
|---|---|
| `tests/01_test_calculo.sql` | Prorrateo, idempotencia del upsert, convocabilidad, renormalización, tope por piso, cierre inmutable |
| `tests/02_test_rls.sql` | Aislamiento entre cuarteles, acceso del bombero a lo propio, evaluación oculta con período abierto, autorización de las RPC |

## API que consume el front

| RPC | Uso |
|---|---|
| `abrir_periodo(cuartel, anio, mes)` | Crea el mes y precarga las notas en 7 |
| `upsert_guardias_semana(periodo, semana, registros)` | Carga semanal, idempotente |
| `registrar_emergencia(periodo, ocurrida_en, tipo, presentes[], ...)` | Evento + asistencia completa |
| `cerrar_periodo(periodo)` | Congela resultados y bloquea escrituras |
| `reabrir_periodo(periodo, motivo)` | Reapertura auditable |

Lectura: `v_puntaje_mensual` (período abierto) o `v_puntaje_consolidado`
(unifica en vivo y cerrado; el front siempre puede usar esta).

## Parámetros a calibrar con datos reales

Están en `config_evaluacion`, versionados por fecha. Nunca se editan:
se inserta una fila nueva con `vigente_desde` y los períodos anteriores
conservan su configuración.

- `meta_horas_mes` — meta base, se prorratea por días disponibles
- `pesos` — deben sumar 100 (validado por trigger)
- `piso_guardia` / `piso_salidas` / `tope_por_piso` — regla de piso operativo

## Modelo de uso

**Un solo usuario: el jefe del cuartel.** Carga las horas, registra las
salidas y evalúa. Los bomberos no tienen cuenta — `bombero.user_id` queda
en null para todos menos él.

Consecuencias:

- El RLS de autoconsulta (el bombero ve lo propio, la evaluación se libera
  al cierre) queda sin consumidor. Se mantiene igual: está escrito, probado
  y no cuesta nada; el día que se abran cuentas ya funciona.
- El aislamiento entre cuarteles también se conserva aunque hoy haya uno
  solo. Borrarlo sería trabajo y riesgo a cambio de nada.
- **Lo que sí cambia es la prioridad de diseño del front**: todo el ahorro
  de tiempo es el tiempo de una persona. La pantalla semanal tiene que
  poder completarse con teclado, sin mouse, y la carga de una salida tiene
  que servir a las 3 AM desde el celular.

> Advertencia para la conversación con el cuartel: si el jefe carga las
> horas, registra quién salió **y** pone las notas, el 50 % que el
> documento llama "presencia operativa verificable" tampoco es
> independiente de su criterio. El sistema estructura y deja rastro del
> juicio del jefe; no lo reemplaza por una medición imparcial. Conviene no
> presentarlo como "objetivo".

## Decisiones de diseño

1. **Meta prorrateada.** Quien tuvo licencia no arrastra una meta que no
   pudo cumplir: `meta × (días_disponibles / días_del_mes)`.
2. **Denominador de convocabilidad.** El presentismo se mide sobre las
   salidas a las que el bombero podía asistir, no sobre el total del cuartel.
   `registrar_emergencia` marca `no_convocable` solo con las novedades vigentes.
3. **Renormalización.** Una categoría en `no_aplica` sale del divisor; su
   peso se redistribuye en lugar de computar cero.
4. **Gestión por excepción.** Las notas nacen en 7. El jefe edita desvíos.
5. **Configuración versionada.** Cambiar los pesos no altera meses cerrados.
6. **Cierre inmutable.** `resultado_mensual` guarda el desglose con los
   pesos aplicados; los triggers bloquean escrituras retroactivas.
7. **El tope manda sobre la banda.** Si se activó el piso operativo, la banda
   no puede ser mejor que `requiere_mejora`, cualquiera sea el valor de
   `tope_por_piso`. Con el default de 60 coincidía con el piso de
   `satisfactorio` y la sanción se leía como aprobación.
