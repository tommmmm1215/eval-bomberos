# Evaluación de Personal — Bomberos de Espartillar

Aplicación de escritorio para Windows. Un solo usuario: el jefe del cuartel.

El cálculo no vive acá: vive en la base de datos. Esta app carga datos crudos
—horas, presencias y notas— y muestra lo que Postgres calcula. Si mañana hay
que cambiar una fórmula, se cambia en una migración y esta app no se toca.

---

## Cómo generar el `.exe`

Hay que hacerlo **en una máquina con Windows**. El instalador se arma con
herramientas nativas de Windows, así que no se puede compilar desde Linux.

Requisito previo: [Node.js 20 o superior](https://nodejs.org) instalado.

**La forma fácil:** doble clic en `COMPILAR-EXE.bat`, en la carpeta de arriba.
Verifica que Node esté instalado, descarga lo que falte, compila y abre la
carpeta con el resultado.

**A mano**, desde PowerShell — ojo con el `cd`, el `package.json` está en
`app`, no en la raíz:

```powershell
cd C:\eval-bomberos\app
npm install
npm run build:win
```

En `dist/` quedan dos archivos:

| Archivo | Qué es |
|---|---|
| `EvaluacionBomberos-Instalador-1.0.0.exe` | Instalador. Crea acceso directo en el escritorio y en el menú Inicio. |
| `EvaluacionBomberos-Portable-1.0.0.exe` | Versión portable: se ejecuta sin instalar, sirve desde un pendrive. |

Para probar la app sin generar el ejecutable:

```powershell
npm start
```

### Sobre el aviso de Windows

Al abrir el `.exe` por primera vez, Windows va a mostrar **"Windows protegió
su PC"**. No es que el programa tenga algo malo: pasa con todo ejecutable que
no está firmado con un certificado de editor, que cuesta entre 200 y 400
dólares por año.

Para abrirlo igual: *Más información* → *Ejecutar de todas formas*. Se hace
una sola vez por versión.

Vale saberlo por si el ejecutable se comparte con alguien más: va a ver ese
cartel y puede desconfiar. Si en algún momento eso importa, la salida es
comprar el certificado de firma.

---

## Las cinco pantallas

**Guardias** — La que más se usa. Una fila por bombero, un número por mes.
Enter baja a la siguiente fila, así se completa sin tocar el mouse. *Copiar
semana anterior* trae los valores de la semana previa, que es lo habitual.
Recargar la misma semana corrige el dato, no lo duplica.

**Salidas** — Se tilda sólo a los presentes. El resto queda ausente
automáticamente, salvo quien tenga una novedad cargada ese día. La fecha es
editable: lo normal es registrar la salida después, no en el momento.
*Anular* saca una salida del cálculo sin borrarla, para falsas alarmas o
cargas equivocadas.

**Evaluación** — Las seis notas arrancan en 7, que significa "cumple el
estándar". Sólo hay que tocar los desvíos. Las notas que se movieron del 7
quedan resaltadas. El tilde *n/a* saca una categoría del cálculo cuando no
corresponde evaluarla ese mes —por ejemplo, si no hubo simulacros— y su peso
se reparte entre las demás en lugar de contar como cero.

**Resultados** — Ranking del mes con el puntaje y la banda. El botón
*Desglose* abre categoría por categoría cuánto aportó cada una: es lo que
convierte un reclamo en una conversación. *Cerrar mes* congela los resultados
y bloquea toda modificación; se puede reabrir, pero queda asentado el motivo.

**Dotación** — Alta y baja de personal, retratos y novedades. Las novedades
(licencias, comisiones) no son un trámite: descuentan días de la meta de horas
y sacan al bombero del denominador de las salidas de esos días. Es lo que
evita que una licencia médica se lea como bajo rendimiento.

---

## Estructura

```
app/
  main.js                    proceso principal de Electron
  renderer/
    index.html
    app.css
    vendor/supabase.js       cliente de Supabase, incluido (sin CDN)
    js/
      config.js              parámetros: URL, categorías, tipos de salida
      api.js                 TODO lo que habla con la base
      ui.js                  helpers de interfaz
      main.js                login y ruteo
      pantallas/             una por pantalla
  test/smoke.mjs             prueba de humo de las cinco pantallas
```

Las pantallas nunca arman consultas: todo pasa por `api.js`. Si cambia una
RPC, se toca un solo archivo.

No hay framework ni paso de compilación para el front. Son cinco pantallas y
un solo usuario; quien lo mantenga después no tiene por qué saber React.

---

## Probar los cambios

```bash
node test/smoke.mjs
```

Monta las cinco pantallas en un DOM simulado contra un cliente de Supabase
falso y verifica que ninguna explote y que muestren lo que corresponde: que el
jefe no aparezca en su propio ranking, que las notas arranquen en 7, que
editar una celda habilite el guardado y que se envíe sólo lo editado.

Requiere `jsdom` y `esbuild`. La lógica de cálculo no se prueba acá sino en
`../tests/01_test_calculo.sql`, que es donde vive.

---

## Configuración

`renderer/js/config.js` tiene la URL del proyecto y la clave publicable. Esa
clave es pública por diseño y no da acceso a nada por sí sola: todo lo que se
puede leer o escribir lo decide el RLS según quién inició sesión.

Los tipos de emergencia y sus pesos también están ahí. Son un punto de
partida: conviene revisarlos con el jefe, porque expresan qué salida vale más
que otra en este cuartel.
