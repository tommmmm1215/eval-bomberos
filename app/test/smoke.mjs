/* =====================================================================
 * smoke.mjs — Prueba de humo de la interfaz.
 *
 * Monta la app en un DOM simulado contra un cliente de Supabase falso y
 * recorre las seis pantallas. No prueba el cálculo (eso lo hacen los
 * tests SQL): prueba que ninguna pantalla explote al pintarse y que lo que
 * se ve en cada una sea lo que corresponde.
 *
 *   npm test
 *
 * Corre igual en Windows, Linux y Mac: no hay ninguna ruta absoluta, y el
 * bundle se arma en memoria en vez de en un archivo temporal.
 * ===================================================================== */

import { JSDOM } from "jsdom";
import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let fallos = 0, pruebas = 0;
const ok  = (m) => { pruebas++; console.log("  \x1b[32m✓\x1b[0m " + m); };
const mal = (m) => { pruebas++; fallos++; console.log("  \x1b[31m✗ " + m + "\x1b[0m"); };
function afirmar(cond, m) { cond ? ok(m) : mal(m); }

// ---------------------------------------------------------------- fixtures

const CUARTEL = "00000000-0000-0000-0000-0000000000e1";
const PERIODO = "aaaaaaaa-0000-0000-0000-000000000001";
const USER    = "99999999-9999-9999-9999-999999999999";

const GENTE = [
  { id: "b1", legajo: "001", nombre: "ROMERO, Jefe de Cuartel", dni: "30123456", rango: "jefe",
    activo: true, evaluable: false, foto_path: null, cuartel_id: CUARTEL },
  { id: "b2", legajo: "002", nombre: "PEREZ, Ana Maria", dni: "30123457", rango: "bombero",
    activo: true, evaluable: true, foto_path: "b2.jpg", cuartel_id: CUARTEL },
  { id: "b3", legajo: "003", nombre: "GOMEZ, Carlos Alberto", dni: "30123458", rango: "bombero",
    activo: true, evaluable: true, foto_path: null, cuartel_id: CUARTEL },
  { id: "b4", legajo: "004", nombre: "DIAZ, Lucia Beatriz", dni: "30123459", rango: "cabo",
    activo: false, evaluable: true, foto_path: null, cuartel_id: CUARTEL }
];
const EVALUABLES = GENTE.filter(b => b.activo && b.evaluable);

const DATOS = {
  bombero: GENTE,
  config_evaluacion: [{ id: "c1", cuartel_id: CUARTEL, vigente_desde: "2026-01-01",
    meta_horas_mes: 24, pesos: { guardia: 25, salidas: 25, orden_interno: 10, capacitacion: 10,
    protocolar: 5, cursos: 8, cambio_guardia: 7, conducta: 10 },
    tope_por_piso: 60, piso_guardia: 0.5, piso_salidas: 0.4 }],
  periodo: [{ id: PERIODO, anio: 2026, mes: 8, estado: "abierto", cerrado_en: null, cuartel_id: CUARTEL }],
  registro_guardia: [
    { periodo_id: PERIODO, bombero_id: "b2", semana: 1, horas: 12 },
    { periodo_id: PERIODO, bombero_id: "b3", semana: 1, horas: 6 }
  ],
  emergencia: [{ id: 1, periodo_id: PERIODO, ocurrida_en: "2026-08-03T04:00:00Z",
    tipo: "incendio_estructural", codigo: "INC-01", peso: 2.5, computable: true,
    emergencia_asistencia: [
      { bombero_id: "b2", estado: "presente" }, { bombero_id: "b3", estado: "ausente" }] }],
  evaluacion_mensual: EVALUABLES.map(b => ({
    periodo_id: PERIODO, bombero_id: b.id, orden_interno: 7, capacitacion: 7, protocolar: 7,
    cursos: 7, cambio_guardia: 7, conducta: 7, comentario_jefe: null, no_aplica: [] })),
  penalizacion: [{ id: 9, periodo_id: PERIODO, bombero_id: "b3", tipo: "apercibimiento",
    puntos: 5, motivo: "Llegada tarde reiterada" }],
  novedad_personal: [],
  v_puntaje_consolidado: [
    { periodo_id: PERIODO, bombero_id: "b2", pct_guardia: 100, pct_salidas: 100,
      puntaje_bruto: 85.5, penalizaciones: 0, puntaje_final: 85.5, banda: "muy_bueno",
      origen: "en_vivo", desglose: { categorias: {
        guardia: { n: 1, peso: 25, aporte: 25 }, salidas: { n: 1, peso: 25, aporte: 25 },
        conducta: { n: .7, peso: 10, aporte: 7 } },
        peso_aplicado: 92, no_aplica: ["cursos"], tope_aplicado: false, penalizaciones: 0 } },
    { periodo_id: PERIODO, bombero_id: "b3", pct_guardia: 25, pct_salidas: 0,
      puntaje_bruto: 61.2, penalizaciones: 5, puntaje_final: 56.2, banda: "requiere_mejora",
      origen: "en_vivo", desglose: { categorias: {
        guardia: { n: .25, peso: 25, aporte: 6.25 } },
        peso_aplicado: 100, no_aplica: [], tope_aplicado: true, penalizaciones: 5 } }
  ],
  v_puntaje_mensual: EVALUABLES.map(b => ({ periodo_id: PERIODO, bombero_id: b.id,
    horas: 12, meta_ajustada: 24, excedente: 0, salidas_presente: 1, salidas_convocable: 1 })),
  cuartel: [{ id: CUARTEL, nombre: "Bomberos Voluntarios de Espartillar", localidad: "Espartillar" }]
};

const llamadas = [];

// -------------------------------------------------- cliente supabase falso

function constructorConsulta(tabla) {
  const filtros = [];
  let unaSola = false;

  const q = {
    select() { return q; },
    eq(col, val) { filtros.push([col, val]); return q; },
    lte() { return q; },
    order() { return q; },
    limit() { return q; },
    maybeSingle() { unaSola = true; return q; },
    single() { unaSola = true; return q; },
    insert(v) { llamadas.push(["insert", tabla, v]); return Promise.resolve({ data: null, error: null }); },
    update(v) { llamadas.push(["update", tabla, v]); return q; },
    delete() { llamadas.push(["delete", tabla]); return q; },
    then(res, rej) {
      let filas = (DATOS[tabla] ?? []).filter(f =>
        filtros.every(([c, v]) => f[c] === undefined || f[c] === v));
      // El join anidado `cuartel:cuartel_id (...)` que usa cargarSesion
      if (tabla === "bombero" && unaSola) {
        filas = filas.map(f => ({ ...f, cuartel: DATOS.cuartel[0] }));
      }
      return Promise.resolve({ data: unaSola ? (filas[0] ?? null) : filas, error: null })
        .then(res, rej);
    }
  };
  return q;
}

function clienteFalso({ conSesion }) {
  return {
    auth: {
      getSession: async () => ({ data: { session: conSesion ? { user: { id: USER } } : null } }),
      signInWithPassword: async () => ({ data: { user: { id: USER } }, error: null }),
      signOut: async () => ({ error: null })
    },
    from: constructorConsulta,
    rpc: async (nombre, args) => {
      llamadas.push(["rpc", nombre, args]);
      return { data: nombre === "abrir_periodo" ? PERIODO : 1, error: null };
    },
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: "app://foto" }, error: null }),
        upload: async () => ({ data: {}, error: null })
      })
    }
  };
}

// ------------------------------------------------------------------ arranque

// El renderer son módulos ES que se cargan por el esquema `app://`. Acá no
// hay esquema propio, así que se empaquetan a un solo script y se evalúa
// dentro del DOM simulado.
//
// `write: false` deja el resultado en memoria. La versión anterior escribía
// un archivo temporal en una ruta absoluta de Linux, así que el test sólo
// corría en la máquina donde se escribió: en Windows fallaba siempre.
const salida = await esbuild.build({
  entryPoints: [path.join(raiz, "renderer/js/main.js")],
  bundle: true,
  format: "iife",
  write: false,
  absWorkingDir: raiz,
  logLevel: "silent"
});

const codigo = salida.outputFiles[0].text;
const css = readFileSync(path.join(raiz, "renderer/app.css"), "utf8");

async function montar({ conSesion }) {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body><div id="app"></div><style>${css}</style></body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://local/" }
  );
  const w = dom.window;
  w.supabase = { createClient: () => clienteFalso({ conSesion }) };
  // jsdom todavía no implementa <dialog>.showModal
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event("close")); };

  const errores = [];
  w.addEventListener("error", e => errores.push(e.message));
  const errOriginal = w.console.error;
  w.console.error = (...a) => { errores.push(a.map(String).join(" ")); errOriginal(...a); };

  w.eval(codigo);
  // deja correr las promesas del arranque
  for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 5));
  return { w, doc: w.document, errores };
}

const texto = doc => doc.body.textContent.replace(/\s+/g, " ");

// Node.append() convierte null en el texto "null" y lo mete en el DOM. Con el
// patrón `condicion ? el(...) : null`, que usan todas las pantallas para los
// avisos opcionales, eso imprimía «null» en pantalla. Se busca el nodo de
// texto suelto, no la palabra en el contenido: "null" puede aparecer
// legítimamente dentro de un mensaje.
function textosSueltos(doc, valor) {
  const it = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  const encontrados = [];
  let n;
  while ((n = it.nextNode())) {
    if (n.textContent.trim() === valor) {
      encontrados.push(n.parentElement?.className || n.parentElement?.tagName || "?");
    }
  }
  return encontrados;
}

function sinBasura(doc, pantalla) {
  for (const valor of ["null", "undefined", "NaN", "false", "[object Object]"]) {
    const sitios = textosSueltos(doc, valor);
    if (sitios.length) {
      mal(`${pantalla}: imprime «${valor}» en pantalla (dentro de .${sitios[0]})`);
      return;
    }
  }
  ok(`${pantalla}: no imprime valores basura`);
}

// --------------------------------------------------------------- pruebas

console.log("\nInterfaz — prueba de humo\n");

console.log("Login");
{
  const { doc, errores } = await montar({ conSesion: false });
  afirmar(doc.querySelector(".login-caja"), "muestra la pantalla de acceso");
  afirmar(doc.querySelector('input[type=email]') && doc.querySelector('input[type=password]'),
    "tiene los campos de correo y contraseña");
  afirmar(errores.length === 0, "sin errores en consola" + (errores[0] ? ` — ${errores[0]}` : ""));
  sinBasura(doc, "Login");
}

console.log("\nCon sesión iniciada");
const { w, doc, errores } = await montar({ conSesion: true });
afirmar(doc.querySelector(".topbar"), "pinta la barra superior");
afirmar(texto(doc).includes("ROMERO, Jefe de Cuartel"), "muestra quién inició sesión");
afirmar(texto(doc).includes("Bomberos Voluntarios de Espartillar"), "muestra el cuartel");
afirmar(errores.length === 0, "sin errores al arrancar" + (errores[0] ? ` — ${errores[0]}` : ""));
sinBasura(doc, "shell");

async function irA(nombre) {
  const btn = [...doc.querySelectorAll(".nav button")].find(b => b.textContent === nombre);
  if (!btn) { mal(`existe la solapa ${nombre}`); return false; }
  btn.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 5));
  return true;
}

console.log("\nGuardias");
if (await irA("Guardias")) {
  // La app abre en la semana en curso; el fixture cargó horas en la 1.
  const selSemana = doc.querySelector("main select");
  selSemana.value = "1";
  selSemana.dispatchEvent(new w.Event("change", { bubbles: true }));
  for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 5));

  const inputs = doc.querySelectorAll("input.horas");
  // Se mira sólo la tabla: el nombre del jefe aparece igual en la barra
  // superior porque es quien inició sesión.
  const tabla = doc.querySelector("main table").textContent;

  afirmar(inputs.length === EVALUABLES.length,
    `una celda por evaluable (${inputs.length} de ${EVALUABLES.length})`);
  afirmar(!tabla.includes("DIAZ"), "excluye a los dados de baja");
  afirmar(!tabla.includes("ROMERO"), "excluye al jefe, que no se evalúa a sí mismo");
  afirmar(inputs[0]?.value === "12", "trae las horas ya cargadas de la semana");

  // editar una celda tiene que habilitar el guardado
  const btnGuardar = [...doc.querySelectorAll("button")].find(b => b.textContent.startsWith("Guardar semana"));
  afirmar(btnGuardar?.disabled === true, "el botón arranca deshabilitado");
  inputs[0].value = "18";
  inputs[0].dispatchEvent(new w.Event("input", { bubbles: true }));
  afirmar(btnGuardar?.disabled === false, "editar una celda habilita el guardado");
  afirmar(btnGuardar?.textContent.includes("(1)"), "cuenta los cambios pendientes");
  afirmar(inputs[0].classList.contains("editado"), "resalta la celda tocada");

  btnGuardar.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  for (let i = 0; i < 40; i++) await new Promise(r => setTimeout(r, 5));
  const env = llamadas.find(c => c[1] === "upsert_guardias_semana");
  afirmar(env, "guardar llama a upsert_guardias_semana");
  afirmar(env && env[2].p_registros.length === 1 && env[2].p_registros[0].horas === 18,
    "manda sólo lo editado, con el valor nuevo");
  sinBasura(doc, "Guardias");
}

console.log("\nSalidas");
if (await irA("Salidas")) {
  afirmar(texto(doc).includes("Incendio estructural"), "lista la salida cargada");
  afirmar(texto(doc).includes("INC-01"), "muestra el código de parte");
  afirmar(texto(doc).includes("1 / 2"), "muestra presentes sobre convocables");
  sinBasura(doc, "Salidas");
}

console.log("\nEvaluación");
if (await irA("Evaluación")) {
  const selects = doc.querySelectorAll("select.nota-sel");
  afirmar(selects.length === EVALUABLES.length * 6, `6 notas por bombero (${selects.length})`);
  afirmar([...selects].every(s => s.value === "7"), "todas precargadas en 7");
  const btn = [...doc.querySelectorAll("button")].find(b => b.textContent.startsWith("Guardar cambios"));
  afirmar(btn?.disabled === true, "sin cambios, no hay nada que guardar");
  selects[0].value = "9";
  selects[0].dispatchEvent(new w.Event("change", { bubbles: true }));
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 5));
  afirmar(btn?.disabled === false, "cambiar una nota habilita el guardado");
  afirmar(doc.querySelector("select.nota-sel.cambiada"), "resalta la nota que se movió del 7");
  sinBasura(doc, "Evaluación");
}

console.log("\nResultados");
if (await irA("Resultados")) {
  const t = texto(doc);
  afirmar(t.includes("85.5") || t.includes("85,5"), "muestra el puntaje");
  afirmar(t.includes("Muy bueno"), "traduce la banda a algo legible");
  afirmar(t.includes("Requiere mejora"), "muestra la banda del que quedó bajo el piso");
  const filas = doc.querySelectorAll("tbody tr");
  afirmar(filas.length === 2, "una fila por bombero con resultado");
  afirmar(filas[0]?.textContent.includes("PEREZ"), "ordena de mayor a menor puntaje");
  afirmar(t.includes("−5") || t.includes("-5"), "muestra la sanción descontada");
  sinBasura(doc, "Resultados");
}

console.log("\nDotación");
if (await irA("Dotación")) {
  const t = texto(doc);
  afirmar(t.includes("DIAZ"), "incluye a los dados de baja");
  afirmar(t.includes("Bajas"), "los separa en su propia sección");
  afirmar(t.includes("30123456"), "muestra el DNI");
  afirmar(t.includes("sin foto"), "marca a quién le falta el retrato");
  sinBasura(doc, "Dotación");
}

console.log("\nConfiguración");
if (await irA("Configuración")) {
  const t = texto(doc);
  afirmar(t.includes("Versión instalada"), "muestra la versión instalada");
  // En el DOM simulado no existe el puente del preload, igual que en
  // `npm start`. La pantalla tiene que decirlo en vez de romperse.
  afirmar(t.includes("modo desarrollo"), "avisa que el actualizador está desactivado sin empaquetar");
  afirmar(!doc.querySelector("main button.btn")?.textContent?.includes("Buscar"),
    "no ofrece un botón que no puede funcionar");
  sinBasura(doc, "Configuración");
}

console.log(`\n${pruebas - fallos}/${pruebas} pruebas pasaron\n`);
process.exit(fallos ? 1 : 0);
