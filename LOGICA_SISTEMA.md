# Lógica del sistema de evaluación de rendimiento — Cuerpo de Bomberos

Documento de diseño funcional. Describe qué se carga, qué se calcula y cómo se
llega al puntaje mensual. Corresponde a la implementación en
`supabase/migrations/`.

---

## 0. Principio rector

**El usuario nunca carga un porcentaje. Carga un hecho.**

La planilla original mezclaba dos cosas distintas en las mismas columnas: hechos
observables (horas, presencias) y juicios del superior (conducta, orden). El
sistema las separa:

| Naturaleza | Qué se carga | Frecuencia | Quién |
|---|---|---|---|
| **Hecho medible** | Horas de guardia, presentes en cada salida | Mensual / al ocurrir | Guardia entrante, oficial de turno |
| **Juicio evaluativo** | Nota 1–10 por categoría | Mensual, al cierre | Jefe / segundo jefe |
| **Derivado** | Todos los porcentajes y el puntaje final | Automático, en vivo | Nadie |

Consecuencia de diseño: **ningún porcentaje se almacena mientras el período está
abierto**. Se calculan en vistas SQL sobre el dato crudo. Si se corrige una hora
mal cargada, el puntaje del mes se actualiza solo. No hay
recálculos manuales, no hay dos números en desacuerdo.

**Ciclo de vida del mes**

```
abrir_periodo()  →  carga de horas del mes  →  notas del jefe  →  cerrar_periodo()
   config              horas + salidas         solo desvíos       congela foto
   congelada           en vivo                                    bloquea escritura
```

---

## 1. Módulo de carga rápida y porcentajes automáticos

### 1.1 Horas de guardia

**Carga.** Una sola pantalla por mes: lista de bomberos activos, un campo
numérico por fila, un botón. La operación es **idempotente**: reenviar el mes
corrige el valor, no lo acumula. Esto importa porque el error real de
operación no es cargar mal, es cargar dos veces.

**Cálculo.**

```
meta_ajustada  = meta_horas_mes × (días_disponibles / días_del_mes)
horas_mes      = horas cargadas para el bombero en el período
% guardia      = MIN(horas_mes / meta_ajustada , 1) × 100
excedente      = MAX(horas_mes − meta_ajustada , 0)
```

**Por qué la meta se prorratea.** Un bombero con 10 días de licencia médica no
puede cumplir la misma meta que uno disponible todo el mes; medirlo contra el
total lo condena a un porcentaje bajo por un motivo que no es de rendimiento.
Los días se descuentan desde `novedad_personal` (licencia, comisión, franco
especial), y solo si la novedad tiene `afecta_meta = true` — una suspensión
disciplinaria, por ejemplo, no debería aliviar la meta.

**Por qué el tope en 100%.** Sin `MIN(...,1)`, quien hace el doble de guardias
compensa aritméticamente un mes de conducta pésima. El excedente se guarda
aparte (`excedente`) y se muestra como mérito visible en el legajo, pero no
infla el puntaje. Reconocer sin distorsionar.

> Días solapados se cuentan una sola vez (`count(distinct)`): dos novedades
> que se pisan no descuentan el mismo día dos veces.

### 1.2 Salidas / emergencias

**Carga.** Un evento por salida. El operador tipea el tipo de emergencia y
**tilda solo a los presentes**. Todo el resto de la dotación activa queda
`ausente` automáticamente, salvo quien tenga una novedad vigente ese día, que
pasa a `no_convocable`. En un cuartel de 30 bomberos con 6 presentes, eso son
6 clics en lugar de 30.

**Cálculo.**

```
% salidas = ( Σ peso de salidas donde estado = 'presente'
              ────────────────────────────────────────────── ) × 100
            ( Σ peso de salidas donde estado ∈ {presente, ausente} )
```

Dos decisiones que definen la justicia del indicador:

**a) Denominador de convocabilidad.** El presentismo se mide sobre las salidas a
las que el bombero **podía** asistir, no sobre el total del cuartel. Quien estuvo
de licencia dos semanas no arrastra las 14 salidas de ese lapso como ausencias.
Sin esto, el indicador castiga la licencia médica, y el sistema pasa a
desincentivar que la gente se reporte enferma.

**b) Peso por tipo de evento.** Cada emergencia tiene `peso` (0 < p ≤ 5, default
1.0). Un incendio estructural nocturno no vale lo mismo que un rescate de gato.
Permite que el cuartel exprese su criterio operativo sin tocar código.

**c) Escape hatch.** `computable = false` saca una salida del cálculo sin
borrarla (falsa alarma, evento mal cargado). Nunca se destruye historia.

**Caso borde:** si un bombero no fue convocable a **ninguna** salida del mes, el
porcentaje es `NULL`, no `0`. La categoría sale del cálculo y su peso se
redistribuye (§3.2). Un cuartel sin salidas ese mes no hunde a nadie.

---

## 2. Categorías de evaluación mensual (escala 1–10)

Seis categorías cargadas por el jefe. **Todas nacen precargadas en 7** al abrir
el período (`inicializar_evaluaciones`). El jefe no evalúa a 30 personas en 6
dimensiones: **edita únicamente los desvíos**. Gestión por excepción — es el
segundo gran ahorro de tiempo después de la carga mensual.

### Ancla de la escala

Que la escala sea 1–10 no significa nada hasta que se define qué es un 7. Sin
esto cada oficial califica con su propio criterio y el ranking deja de ser
comparable entre turnos.

| Nota | Significado | Uso esperado |
|---|---|---|
| 9–10 | Excede el estándar de forma visible y sostenida | Excepcional |
| 8 | Por encima de lo esperado | Frecuente |
| **7** | **Cumple el estándar. Sin observaciones.** | **Valor por defecto** |
| 5–6 | Cumple con observaciones puntuales | Frecuente |
| 3–4 | Incumplimiento reiterado | Requiere registro escrito |
| 1–2 | Falta grave / negativa a cumplir | Deriva a sumario |

### Rúbricas por categoría

| Categoría | Qué observa | Un 5 se ve así | Un 9 se ve así |
|---|---|---|---|
| **Orden interno** | Mantenimiento de instalaciones, equipos y móviles; estado del material a su cargo | Deja el material sin reponer después de una salida | Detecta y reporta fallas antes de que afecten una intervención |
| **Capacitación** | Rendimiento y actitud en simulacros y ejercicios | Participa sin involucrarse; errores repetidos de procedimiento | Ejecuta con precisión y corrige a los aspirantes |
| **Protocolar** | Uniforme, presentación, actos y formaciones | Uniforme incompleto o llega tarde a actos | Presentación impecable, sostiene el estándar del cuerpo |
| **Cursos** | Aprobación de formación externa en el período | Cursó sin aprobar | Aprobó con distinción o cursó por iniciativa propia |
| **Cambio de guardia** | Puntualidad en el relevo y calidad del traspaso | Llega tarde; traspasa novedades incompletas | Siempre anticipado, parte de novedades completo |
| **Conducta / Jefe** | Disciplina, trato, trabajo en equipo, criterio general | Roces con pares; requiere supervisión | Referente de conducta para el resto |

### Reglas de carga

1. **`no_aplica[]`** — categoría no evaluable este mes (no hubo simulacros, no
   hubo oferta de cursos). Sale del divisor; **no computa cero**. Ver §3.2.
2. **Extremos justificados** — una nota de conducta fuera del rango 5–8 exige un
   `comentario_jefe` de al menos 15 caracteres. Restricción de base de datos, no
   de front: es donde se juegan los reclamos, y un puntaje bajo sin fundamento
   escrito es indefendible.
3. **Trazabilidad** — se guarda `evaluador_id` y `updated_at`. Quién puso qué y
   cuándo.
4. **`cursos`** es la única categoría con un default discutible: si el cuartel no
   ofreció formación, corresponde `no_aplica`, no un 7 regalado.

---

## 3. Cálculo del puntaje final (columna "Suma")

### 3.1 Normalización a escala común

Todo se lleva a `[0,1]` antes de ponderar:

| Origen | Normalización |
|---|---|
| Guardia | `MIN(horas / meta_ajustada, 1)` |
| Salidas | `pond_presente / pond_convocable` |
| Las 6 categorías manuales | `nota / 10` |

### 3.2 Ponderación con renormalización

```
                    Σ ( nᵢ × pesoᵢ )
puntaje_bruto = 100 × ───────────────────      para i ∈ categorías aplicables
                        Σ pesoᵢ
```

El divisor **no es 100 fijo**: es la suma de los pesos efectivamente aplicados.
Si `cursos` (peso 8) queda en `no_aplica`, el divisor pasa a 92 y ese 8% se
redistribuye proporcionalmente entre el resto. La alternativa — computar cero —
haría que no tener cursos disponibles baje el puntaje de todos por igual, que es
precisamente el error que hay que evitar.

**Pesos propuestos** (versión base — *a calibrar con el jefe de cuartel antes de
producción*):

| Categoría | Peso | Origen |
|---|---|---|
| Guardia | 25 | Automático |
| Salidas | 25 | Automático |
| Orden interno | 10 | Manual 1–10 |
| Capacitación | 10 | Manual 1–10 |
| Conducta / Jefe | 10 | Manual 1–10 |
| Cursos | 8 | Manual 1–10 |
| Cambio de guardia | 7 | Manual 1–10 |
| Protocolar | 5 | Manual 1–10 |
| **Total** | **100** | |

Criterio detrás del reparto: **50% presencia operativa verificable** (lo que el
sistema mide solo, sin sesgo), **50% criterio de mando** distribuido en seis
dimensiones para que ninguna decisión individual del jefe domine el resultado. La
suma se valida por trigger: una configuración que no da 100 no entra a la base.

### 3.3 Penalizaciones y piso operativo

```
puntaje_final = MIN(
                  MAX( puntaje_bruto − penalizaciones , 0 ),
                  tope_si_no_alcanza_piso
                )
```

**Penalizaciones.** Puntos planos restados por hecho disciplinario formal
(apercibimiento, suspensión), con motivo obligatorio. Van fuera de la
ponderación a propósito: son eventos, no dimensiones de desempeño.

**Piso operativo.** Si `% guardia < 50%` **o** `% salidas < 40%`, el puntaje
final se topea en **60** por más que las notas manuales sean excelentes. Impide
el resultado políticamente insostenible de un bombero con calificación
"destacado" que casi no fue al cuartel. Los tres valores (50/40/60) son
configurables.

### 3.4 Bandas de resultado

| Puntaje | Banda | Lectura de gestión |
|---|---|---|
| 90–100 | Destacado | Reconocimiento formal |
| 75–89 | Muy bueno | Sin acciones |
| 60–74 | Satisfactorio | Sin acciones |
| 45–59 | Requiere mejora | Entrevista con el jefe |
| 0–44 | Crítico | Plan de acción con seguimiento |

**Regla que prevalece sobre la tabla:** si se activó el piso operativo
(`tope_aplicado`), la banda **nunca** puede ser mejor que *requiere mejora*.

Sin esta regla el sistema se contradice: con `tope_por_piso = 60` y el piso de
*satisfactorio* también en 60, alguien que casi no fue al cuartel termina
etiquetado como "satisfactorio" — la sanción se lee como aprobación. La regla se
expresa sobre `tope_aplicado`, no sobre el número, para que siga valiendo
cualquiera sea el tope que el cuartel elija.

### 3.5 Ejemplo verificado

Julio (31 días), bombero con 5 días de licencia médica, sin oferta de cursos,
un apercibimiento (3 puntos):

```
meta_ajustada = 24 × 26/31                       = 20,13 h
% guardia     = MIN(18 / 20,13 ; 1) × 100        = 89,42 %
% salidas     = 8,5 / 12,0 × 100                 = 70,83 %
notas         = orden 8 · capac. 7 · protoc. 6 · cambio 7 · conducta 8
                cursos → no_aplica  ⇒ peso aplicado = 92
```

| Categoría | n | Peso | Aporte al puntaje |
|---|---|---|---|
| Guardia | 0,8942 | 25 | 24,30 |
| Salidas | 0,7083 | 25 | 19,25 |
| Orden interno | 0,8000 | 10 | 8,70 |
| Capacitación | 0,7000 | 10 | 7,61 |
| Protocolar | 0,6000 | 5 | 3,26 |
| Cambio de guardia | 0,7000 | 7 | 5,33 |
| Conducta | 0,8000 | 10 | 8,70 |
| | | **92** | **77,13** |

> Los aportes se muestran redondeados a dos decimales y suman 77,15; el
> `puntaje_bruto` se calcula sobre los valores sin redondear y da 77,13. El
> redondeo se aplica **una sola vez, al final** — nunca sobre los parciales.

```
puntaje_bruto  = 77,13
penalizaciones = −3,00
piso           = no aplica (89,42 % ≥ 50 % · 70,83 % ≥ 40 %)
PUNTAJE FINAL  = 74,13   →   banda "satisfactorio"
```

### 3.6 Cierre inmutable

`cerrar_periodo()` congela el resultado en `resultado_mensual` junto al
`desglose` JSON con los pesos que se aplicaron, y los triggers bloquean toda
escritura retroactiva sobre ese mes. Cambiar los pesos en enero **no** altera lo
que se le comunicó al personal en diciembre. La reapertura existe pero exige
motivo escrito y queda auditada.

---

## 4. Estructura de datos

### 4.1 Modelo relacional

```
cuartel
  └── bombero (legajo, rango, activo, evaluable)
  └── config_evaluacion  ← versionada por vigente_desde. Nunca se edita:
                            se inserta una versión nueva. Los períodos
                            anteriores conservan la suya.
  └── periodo (año, mes, config_id, estado)
        ├── registro_guardia        (bombero, horas)              ← CARGA MENSUAL
        ├── emergencia              (tipo, peso, computable)      ← CARGA POR EVENTO
        │     └── emergencia_asistencia (bombero, estado)
        ├── evaluacion_mensual      (6 notas 1–10, no_aplica[])   ← CARGA MENSUAL
        ├── penalizacion            (tipo, puntos, motivo)        ← EXCEPCIONAL
        └── resultado_mensual       (foto congelada al cierre)    ← ESCRITO POR EL SISTEMA

bombero
  └── novedad_personal (desde, hasta, tipo, afecta_meta)  ← transversal a períodos
```

**Claves de unicidad que sostienen la operación**

| Tabla | Clave | Efecto |
|---|---|---|
| `registro_guardia` | `(periodo, bombero)` | Carga mensual idempotente |
| `evaluacion_mensual` | `(periodo, bombero)` | Una evaluación por mes |
| `emergencia_asistencia` | `(emergencia, bombero)` | Sin doble presencia |
| `periodo` | `(cuartel, año, mes)` | Sin meses duplicados |

### 4.2 Contratos JSON del front

**Carga mensual de guardias** — `upsert_guardias_mes`

```json
{
  "p_periodo": "9f1c…",
  "p_registros": [
    { "bombero_id": "a1…", "horas": 12 },
    { "bombero_id": "b2…", "horas": 24 },
    { "bombero_id": "c3…", "horas": 0 }
  ]
}
```
Una sola llamada para todo el cuartel. Reenviable sin efectos secundarios.

**Registro de una salida** — `registrar_emergencia`

```json
{
  "p_periodo": "9f1c…",
  "p_ocurrida_en": "2026-07-14T03:20:00-03:00",
  "p_tipo": "incendio_estructural",
  "p_peso": 2.5,
  "p_codigo": "INC-0714",
  "p_presentes": ["a1…", "b2…", "d4…"],
  "p_no_convocables": []
}
```
Solo los presentes. El backend completa `ausente` / `no_convocable` para el
resto de la dotación.

**Configuración del cuartel** — `config_evaluacion.pesos`

```json
{
  "guardia": 25, "salidas": 25,
  "orden_interno": 10, "capacitacion": 10, "conducta": 10,
  "cursos": 8, "cambio_guardia": 7, "protocolar": 5
}
```

**Lectura** — `v_puntaje_consolidado` (una fila por bombero/período)

```json
{
  "bombero_id": "a1…",
  "pct_guardia": 89.42,
  "pct_salidas": 70.83,
  "puntaje_bruto": 77.13,
  "penalizaciones": 3.0,
  "puntaje_final": 74.13,
  "banda": "satisfactorio",
  "origen": "en_vivo",
  "desglose": {
    "categorias": {
      "guardia":       { "n": 0.8942, "peso": 25, "aporte": 24.30 },
      "salidas":       { "n": 0.7083, "peso": 25, "aporte": 19.25 },
      "orden_interno": { "n": 0.8000, "peso": 10, "aporte": 8.70 }
    },
    "peso_aplicado": 92,
    "no_aplica": ["cursos"],
    "tope_aplicado": false,
    "penalizaciones": 3.0
  }
}
```

`origen` le dice al front si está viendo un cálculo en vivo (mes abierto) o la
foto congelada (mes cerrado). **El front siempre consulta esta misma vista** y no
necesita saber en qué estado está el período.

El `desglose` es lo que convierte una discusión en una conversación: ante un
reclamo, se abre y se ve exactamente qué categoría restó y cuánto.

### 4.3 Notas de implementación para el front

- **Pantalla mensual**: tabla editable, guardado por lote, un solo POST. Sin
  guardado por fila.
- **Pantalla de salida**: buscador de bombero + chips de presentes. Optimizada
  para cargarse desde el celular a las 3 AM.
- **Pantalla mensual del jefe**: las 30 filas ya vienen en 7; se destacan
  visualmente las que el jefe tocó.
- **Preview en vivo**: `v_puntaje_consolidado` se puede consultar en cualquier
  momento del mes. El jefe ve el ranking actualizado antes de cerrar, sin
  sorpresas al final.

---

## 5. Parámetros a calibrar con el cliente

Todos viven en `config_evaluacion` y ninguno está en código.

| Parámetro | Valor propuesto | Pregunta a hacerle al jefe de cuartel |
|---|---|---|
| `meta_horas_mes` | 12 | Definido con el jefe de cuartel: 12 h por mes. Queda pendiente si varía por rango. |
| `pesos` | Ver §3.2 | ¿Qué pesa más: estar presente o cómo se comporta cuando está? |
| `piso_guardia` | 50 % | ¿Debajo de qué cumplimiento el mes ya no es aceptable? |
| `piso_salidas` | 40 % | Ídem para salidas |
| `tope_por_piso` | 60 | ¿A cuánto se topea a quien no llega al piso? |
| `peso` por tipo de emergencia | 1.0 | ¿Qué salidas pesan más que otras? |
| Escala de `penalizacion` | — | ¿Cuántos puntos vale un apercibimiento? |

**Recomendación de puesta en marcha:** correr el sistema en paralelo con la
planilla actual durante dos meses antes de que el puntaje tenga consecuencias.
Es la única forma de descubrir si los pesos producen el ranking que el jefe
considera correcto — y si no lo produce, el que hay que ajustar es el peso, no
el resultado.

---

## Anexo — Correcciones aplicadas tras la primera ejecución

El SQL se ejecutó por primera vez contra PostgreSQL 16.2. Las cuatro migraciones
y la suite de tests pasan. Tres correcciones salieron de esa corrida:

**1. `create extension pgcrypto` — eliminado.** `gen_random_uuid()` es parte del
core desde PG13. La línea no aportaba nada y rompía cualquier despliegue en un
Postgres sin `contrib` instalado.

**2. `aporte` del desglose, escala ×100 — corregido.** Se calculaba como
`100 × valor × peso`, devolviendo 2500 donde correspondía 25. El `puntaje_bruto`
siempre estuvo bien (divide por `Σ pesos`), pero el desglose que se le muestra al
bombero no reconstruía su propio puntaje. Se resolvió calculando `peso_aplicado`
en un CTE previo — un agregado no puede contener otro agregado ni una función de
ventana. Hay un assert que verifica que los aportes sumen `puntaje_bruto`.

**3. Colisión entre el tope y las bandas — corregido.** Con `tope_por_piso = 60`
y el piso de *satisfactorio* también en 60, los tres bomberos del test que
activaron el piso operativo quedaron etiquetados como "satisfactorio": la sanción
se leía como aprobación. Ahora `tope_aplicado` fuerza la banda a *requiere
mejora*. Se detectó únicamente al ver la tabla de resultados reales — ningún
assert lo cubría, porque el error no estaba en la aritmética sino en lo que la
aritmética significaba.

**Verificación cruzada.** Los cuatro puntajes se recalcularon en una
implementación independiente en Python, escrita desde este documento y no desde
el SQL. Coinciden en los ocho campos evaluados. Que dos implementaciones
derivadas de fuentes distintas den lo mismo es una señal razonable de que la
especificación y el código dicen lo mismo.

| Legajo | Horas | Meta aj. | % Guardia | % Salidas | Bruto | Final | Banda |
|---|---|---|---|---|---|---|---|
| 0002 Pérez | 24,00 | 24,00 | 100,00 | 75,00 | 78,75 | 73,75 | satisfactorio |
| 0003 Gómez | 19,00 | 24,00 | 79,17 | 25,00 | 60,26 | 60,00 | requiere_mejora |
| 0004 Díaz | 5,00 | 24,00 | 20,83 | 100,00 | 80,21 | 60,00 | requiere_mejora |
| 0005 Sosa | 24,00 | 12,39 | 100,00 | 0,00 | 60,00 | 60,00 | requiere_mejora |

Casos que el test cubre y quedaron validados: upsert correctivo de la carga
(Gómez carga 19 h, no 25), novedades solapadas que no se descuentan dos veces
(Sosa, 15 días y no 20), meta prorrateada, `no_aplica` que renormaliza el divisor
a 92, personal no evaluable fuera del ranking, tope por piso operativo en sus dos
variantes (guardia y salidas), cierre inmutable y rechazo de escrituras
retroactivas.

### Correcciones de la segunda corrida (seguridad)

El RLS se había aplicado pero nunca ejecutado con un usuario real. Al escribir
`tests/02_test_rls.sql` aparecieron dos bugs que hubieran bloqueado el sistema el
primer día:

**4. Las RPC eran inaccesibles para el front.** `03_functions.sql` revocaba
`execute` de `public` sin otorgárselo después a `authenticated`. Revocar de
`public` no deja permiso residual: el jefe recibía *permission denied for
function abrir_periodo*. Ninguna de las cinco RPC se podía invocar desde el
cliente. Se agregó el `grant` explícito. `inicializar_evaluaciones` queda fuera a
propósito: es interna y `abrir_periodo`, al ser *security definer*, la ejecuta
como owner.

**5. Recursión infinita en la política de `bombero`.** Las políticas resolvían el
cuartel del usuario con un subquery directo — `(select cuartel_id from bombero
where …)` — dentro de una política sobre la propia tabla `bombero`. Esa lectura
vuelve a disparar la política y Postgres aborta con *infinite recursion detected
in policy for relation "bombero"*. Cualquier consulta al padrón de personal
fallaba. Se resolvió moviendo esas lecturas a dos funciones *security definer*
(`app_cuartel_actual()` y `app_cuartel_de_bombero()`), que es la forma correcta
de romper el ciclo: la función no evalúa RLS.

Lo que ahora está verificado del lado de seguridad: aislamiento total entre
cuarteles (incluidas las vistas, vía `security_invoker`), el bombero ve sus horas
y sus novedades pero no las ajenas, la evaluación del jefe permanece oculta hasta
el cierre del período, y un bombero raso no puede cargar horas ni cerrar el mes
aunque invoque la RPC directamente.

### Correcciones de la tercera corrida (despliegue en Supabase)

Los *advisors* de Supabase sobre el proyecto ya desplegado detectaron un agujero
que un Postgres pelado no puede mostrar:

**6. Las RPC eran invocables sin iniciar sesión.** Supabase aplica `alter default
privileges … grant execute on functions to anon, authenticated, service_role`.
Toda función creada en `public` nace expuesta en `/rest/v1/rpc/…` para cualquiera
que tenga la *anon key* —que es pública por definición, va en el bundle del
front—. El `revoke … from public` de `03_functions.sql` no la cubría: revocar de
PUBLIC no borra los grants otorgados a roles concretos.

El impacto real estaba acotado, porque las cinco RPC principales validan
`app_es_jefe()` y para un anónimo `auth.uid()` es `null`. Pero quedaban dos
puertas abiertas: `inicializar_evaluaciones` no tenía control de autorización
ninguno, y los helpers `app_cuartel_de_bombero()` / `app_cuartel_de_periodo()`
permitían mapear UUIDs a cuarteles sin credenciales.

Corregido en `05_permisos.sql`, con un detalle que costó dos intentos: revocar de
`anon` no alcanza mientras PUBLIC conserve el permiso, porque **todo rol hereda
de PUBLIC**. Hay que revocar de ambos y reotorgar a `authenticated`. Verificado
con `has_function_privilege`: `anon = false` en las once funciones,
`inicializar_evaluaciones` sin grant para nadie.

**7. `search_path` mutable** en las cinco funciones de trigger. No son *security
definer*, pero fijarlo es gratis y elimina la clase de ataque.

**Pendiente de observar en producción:** en el test, tres de cuatro bomberos
quedan clavados en exactamente 60 por el tope. Los datos son deliberadamente
adversos, pero conviene mirar si con datos reales el tope se activa tan seguido
como para aplanar el ranking. Si pasa, el problema no es el tope sino que los
pisos están altos para la realidad operativa del cuartel.
