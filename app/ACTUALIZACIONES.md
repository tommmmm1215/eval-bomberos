# Distribución y actualización automática

Le mandás el instalador al cuartel **una sola vez**. De ahí en adelante
publicás las versiones nuevas desde tu casa y llegan solas.

---

## Configuración inicial (una sola vez)

### 1. Crear el repositorio en GitHub

En **github.com/new**:

| Campo | Qué poner |
|---|---|
| **Repository name** | `eval-bomberos` |
| **Visibilidad** | **Public** |
| Add a README | **NO** tildar |

Tiene que ser público: `electron-updater` lee las releases sin autenticarse.
Con un repositorio privado habría que embeber un token dentro del `.exe`, y un
token dentro de un ejecutable que se distribuye no es un secreto.

> El repositorio recién creado, si lo hacés sin README, no tiene ningún commit
> —y sin commit no hay rama, y sin rama GitHub no puede anclar la etiqueta del
> release—. Como acá el primer `git push` sube el código de una, no es
> problema. Sólo aparece si creás el repo vacío y publicás antes de empujar.

### 2. Subir el código

Ejecutá `SUBIR-A-GITHUB.bat` (está en la raíz del proyecto) y después:

```powershell
git remote add origin https://github.com/tommmmm1215/eval-bomberos.git
git push -u origin main
```

El usuario `tommmmm1215` ya coincide con lo que espera el bloque `publish` de
`app/package.json`, así que no hay nada que ajustar.

### 3. Crear el token para publicar

En **github.com/settings/tokens** → **Generate new token (classic)**:

- **Note**: `bomberos-publicar`
- **Expiration**: `No expiration`
- **Scopes**: tildá solamente **`repo`**

El token se muestra **una sola vez**. Copialo.

### 4. Guardarlo en tu computadora

En PowerShell, una sola vez:

```powershell
[Environment]::SetEnvironmentVariable('GH_TOKEN', 'pega_aca_tu_token', 'User')
```

Cerrá y volvé a abrir PowerShell para que tome la variable.

Este token queda sólo en **tu** máquina: es el permiso para publicar. La PC del
cuartel no lo necesita, únicamente descarga.

---

## Publicar una versión nueva

Cada vez que quieras que un cambio llegue al cuartel:

**1.** Subí el número de versión en `app/package.json`:

```json
"version": "1.0.4"
```

Tiene que ser **mayor** que la anterior. Si no la subís, la PC del cuartel no
detecta que hay algo nuevo. Es el único número que hay que tocar: lo que se
muestra en la barra de arriba y en Configuración sale de acá.

**2.** Publicá:

```powershell
cd C:\eval-bomberos\app
npm run publicar
```

Compila, arma el instalador y lo sube a GitHub Releases junto con el
`latest.yml`, que es el archivo que la app instalada consulta al arrancar.

**3.** Listo. No hay paso 3. La PC del cuartel lo detecta al abrir la app.

---

## Cómo lo ve el jefe

**La primera vez** le mandás `EvaluacionBomberos-Setup-1.0.3.exe` —unos 90 MB,
por Drive o pendrive— y lo instala. Es la única vez que toca un instalador.

**Después de eso**, cada vez que abre la app: a los 4 segundos —para no
competir con la carga inicial por el ancho de banda— consulta si hay algo
nuevo. Si lo hay, lo descarga en segundo plano mientras sigue trabajando.

Al terminar la descarga:

- **Si no tiene nada sin guardar**, avisa y se reinicia solo a los 2,5
  segundos.
- **Si tiene cambios sin guardar**, no se reinicia. Muestra una barra abajo con
  "Reiniciar ahora" y "Más tarde", y espera.

La razón de esa distinción: reiniciar en medio de la carga semanal le haría
perder las 17 filas que venía tipeando. Un reinicio transparente sólo es
transparente si no destruye trabajo.

Si nunca reinicia, `autoInstallOnAppQuit` aplica la actualización la próxima
vez que cierre la app.

**También puede forzarlo** desde **Configuración → Buscar actualización**. Ese
botón sirve sobre todo para diagnosticar: muestra el error exacto. El chequeo
automático falla en silencio a propósito —un problema de red no debería
interrumpir a nadie—, pero ese silencio es lo que deja sin pistas cuando algo
no anda.

---

## Lo que hay que saber antes de confiar en esto

**La app no está firmada.** Dos consecuencias concretas:

1. Windows muestra *"Windows protegió su PC"* en la instalación y en cada
   actualización. Se resuelve con *Más información → Ejecutar de todas
   formas*, pero es fricción real y repetida.
2. `electron-updater` no puede verificar que el paquete descargado venga
   realmente de ustedes. La descarga va por HTTPS desde GitHub, así que un
   atacante necesitaría comprometer la cuenta de GitHub —no alcanza con
   interceptar la red—. Es un riesgo acotado, pero es un riesgo.

Un certificado de firma de código cuesta entre 200 y 400 dólares al año y
elimina las dos cosas. Para un cuerpo de voluntarios puede no justificarse; la
decisión es de ustedes, pero conviene tomarla sabiendo qué se compra.

**Esto actualiza el código, no el esquema de la base.** Si una versión nueva
necesita una columna o tabla que no existe en Supabase, la secuencia segura es:
primero aplicar el cambio de esquema de forma compatible hacia atrás —agregar
columnas con valor por defecto, nunca renombrar ni borrar—, después publicar la
app. Al revés, la versión vieja empieza a fallar antes de que nadie actualice.

**La versión portable no se auto-actualiza.** Es a propósito: un ejecutable que
corre desde un pendrive no tiene dónde instalarse. Sirve para probar o para una
PC donde no se puede instalar nada.

---

## Las trampas que ya pisamos

**La configuración de publicación se graba dentro del ejecutable.**
electron-builder escribe un `app-update.yml` con el usuario y el repositorio en
el momento de compilar. Si compilás con esos datos mal, esa versión queda ciega
para siempre: no hay forma de arreglarla remotamente, hay que reinstalar a
mano. Ya está correcto en `package.json`, pero no lo toques sin pensarlo.

**Los releases salen como borrador por defecto**, y un borrador no es visible
públicamente: el actualizador recibe un 404. Está resuelto con
`"releaseType": "release"`. Pero esa opción sólo aplica al **crear** el
release: si ya existe un borrador para esa versión, lo reutiliza tal cual. Hay
que borrarlo antes de republicar.

**Los arreglos del actualizador llegan una versión tarde.** El código que
decide *cómo* instalar es el de la versión que ya está corriendo, no el de la
nueva. Si corregís algo del actualizador en la 1.0.4, ese cambio recién manda
cuando la 1.0.4 sea la instalada y aparezca la 1.0.5. Es el precio de que la
app se actualice a sí misma.

**`createDesktopShortcut` en `"always"`, no en `true`.** Con `true`,
electron-builder no recrea el acceso directo al actualizar —asume que si no
está es porque el usuario lo borró—, pero como la actualización desinstala
primero, se lo lleva puesto y nunca lo repone.

---

## Si algo no anda

Primero: **Configuración → Buscar actualización**. Ese botón muestra el error
exacto.

| Síntoma | Causa habitual |
|---|---|
| `npm run publicar` da error 401 | Falta `GH_TOKEN` o venció. Repetí los pasos 3 y 4. |
| "Cannot find latest.yml" / 404 | Todavía no hay ninguna release publicada, o quedó en borrador. |
| Nunca detecta actualizaciones | El actualizador sólo corre empaquetado (`app.isPackaged`). Con `npm start` está desactivado a propósito. |
| Descarga y vuelve a descargar | La versión publicada es menor o igual a la instalada. |

Para compilar en local sin publicar nada:

```powershell
npm run build:win     # usa --publish never
```
