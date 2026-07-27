// Evaluación mensual: las seis notas que pone el jefe.
//
// Todas nacen en 7 al abrir el mes. La idea es que el jefe no evalúe a 17
// personas en 6 dimensiones, sino que toque solamente los desvíos. Lo que
// quedó en 7 se muestra apagado; lo editado, resaltado.

import { dotacion, evaluaciones, guardarEvaluacion } from "../api.js";
import { el, montar, limpiar, avisar, errorDe, cargando, dialogo } from "../ui.js";
import { CATEGORIAS } from "../config.js";
import { estado } from "../main.js";
import { marcarCambiosSinGuardar } from "../actualizador.js";

const AYUDA_ESCALA = [
  ["9–10", "Excede el estándar de forma visible y sostenida"],
  ["8",    "Por encima de lo esperado"],
  ["7",    "Cumple el estándar, sin observaciones (valor por defecto)"],
  ["5–6",  "Cumple con observaciones puntuales"],
  ["3–4",  "Incumplimiento reiterado"],
  ["1–2",  "Falta grave o negativa a cumplir"]
];

export async function pantallaEvaluacion(hoja) {
  const periodo = estado.periodo;
  const cerrado = periodo.estado === "cerrado";

  montar(limpiar(hoja), cargando());

  let gente, evals;
  try {
    [gente, evals] = await Promise.all([
      dotacion({ soloEvaluables: true }),
      evaluaciones(periodo.id)
    ]);
  } catch (e) { errorDe(e); limpiar(hoja); return; }

  const pendientes = new Map();   // bombero_id -> { campo: valor }

  const btnGuardar = el("button", { class: "btn", disabled: true, onclick: guardarTodo },
    "Guardar cambios");

  function marcar() {
    marcarCambiosSinGuardar(pendientes.size > 0);
    btnGuardar.disabled = cerrado || pendientes.size === 0;
    btnGuardar.textContent = pendientes.size
      ? `Guardar cambios (${pendientes.size})` : "Guardar cambios";
  }

  function pendiente(bomberoId, campo, valor) {
    const actual = pendientes.get(bomberoId) ?? {};
    actual[campo] = valor;
    pendientes.set(bomberoId, actual);
    marcar();
  }

  async function guardarTodo() {
    btnGuardar.disabled = true; btnGuardar.textContent = "Guardando…";
    const errores = [];
    for (const [bomberoId, campos] of pendientes) {
      try { await guardarEvaluacion(periodo.id, bomberoId, campos); }
      catch (e) {
        const b = gente.find(g => g.id === bomberoId);
        errores.push(`${b?.nombre ?? bomberoId}: ${e.message}`);
      }
    }
    if (errores.length) {
      errorDe(new Error(errores.join(" · ")));
      marcar();
    } else {
      avisar("Evaluaciones guardadas", "ok");
    }
    await pantallaEvaluacion(hoja);
  }

  // -------------------------------------------------------- comentario

  async function editarComentario(b, ev) {
    const ta = el("textarea", { value: ev?.comentario_jefe ?? "", rows: 5,
      placeholder: "Qué se observó, con hechos concretos…" });
    const ok = await dialogo({
      titulo: `Observaciones — ${b.nombre}`,
      confirmar: "Aplicar",
      cuerpo: el("div", {},
        el("p", { class: "nota info", text:
          "Una nota de conducta fuera del rango 5–8 exige un comentario de al menos " +
          "15 caracteres. Es donde se juegan los reclamos: un puntaje bajo sin " +
          "fundamento escrito es indefendible." }),
        ta
      ),
      alConfirmar: () => true
    });
    if (ok) {
      pendiente(b.id, "comentario_jefe", ta.value.trim() || null);
      avisar("Comentario listo — falta guardar");
      pintarFila(b);
    }
  }

  // ------------------------------------------------------------- filas

  const cuerpo = el("tbody");
  const filasPorId = new Map();

  function pintarFila(b) {
    const ev = evals[b.id];
    const fila = filasPorId.get(b.id);
    if (!fila || !ev) return;
    const pend = pendientes.get(b.id) ?? {};

    limpiar(fila);
    fila.append(
      el("td", { class: "legajo", text: b.legajo }),
      el("td", { style: "min-width:190px" }, b.nombre)
    );

    const noAplica = new Set(pend.no_aplica ?? ev.no_aplica ?? []);

    for (const cat of CATEGORIAS) {
      const valor = pend[cat.k] ?? ev[cat.k];
      const na = noAplica.has(cat.k);
      const sel = el("select", {
        class: "nota-sel" + (valor !== 7 && !na ? " cambiada" : "") + (na ? " na" : ""),
        disabled: cerrado || na,
        title: cat.ayuda,
        onchange: e => { pendiente(b.id, cat.k, Number(e.target.value)); pintarFila(b); }
      });
      for (let n = 1; n <= 10; n++)
        sel.append(el("option", { value: n, selected: n === valor, text: n }));

      const chkNa = el("input", {
        type: "checkbox", checked: na, disabled: cerrado,
        title: `Marcar "${cat.label}" como no evaluable este mes: sale del cálculo y su peso se redistribuye`,
        style: "width:auto;margin-top:4px",
        onchange: e => {
          const s = new Set(noAplica);
          e.target.checked ? s.add(cat.k) : s.delete(cat.k);
          pendiente(b.id, "no_aplica", [...s]);
          pintarFila(b);
        }
      });

      fila.append(el("td", { class: "cen", style: "width:82px" },
        sel,
        el("div", { style: "font-size:10.5px;color:var(--suave);margin-top:1px" }, chkNa, " n/a")
      ));
    }

    const tieneComentario = (pend.comentario_jefe ?? ev.comentario_jefe ?? "").trim().length > 0;
    fila.append(el("td", { class: "der", style: "width:120px" },
      el("button", {
        class: "btn sec chico", disabled: cerrado,
        onclick: () => editarComentario(b, { ...ev, ...pend })
      }, tieneComentario ? "Ver nota ✓" : "Observaciones")
    ));
  }

  for (const b of gente) {
    const fila = el("tr");
    filasPorId.set(b.id, fila);
    cuerpo.append(fila);
    pintarFila(b);
  }

  // ------------------------------------------------------------ armado

  const faltanEvals = gente.filter(b => !evals[b.id]);

  montar(limpiar(hoja), 
    el("div", { class: "cabecera" },
      el("div", {},
        el("h1", { text: "Evaluación mensual" }),
        el("p", { class: "bajada", text:
          "Todas las notas arrancan en 7, que significa «cumple el estándar». " +
          "Editá solamente los desvíos." })
      ),
      el("div", { class: "acciones" },
        el("button", { class: "btn sec", onclick: () => dialogo({
          titulo: "Qué significa cada nota",
          confirmar: "Entendido",
          cuerpo: el("div", {},
            el("table", {}, el("tbody", {}, AYUDA_ESCALA.map(([n, t]) =>
              el("tr", {},
                el("td", { style: "font-weight:700;width:60px", text: n }),
                el("td", { style: "font-size:13.5px", text: t }))))),
            el("p", { class: "nota info", style: "margin-top:14px", text:
              "Sin este anclaje cada oficial califica con su propio criterio y el " +
              "ranking deja de ser comparable entre meses." })
          )
        })}, "Escala"),
        btnGuardar
      )
    ),

    cerrado ? el("div", { class: "cerrado-aviso" },
      "Este mes está cerrado. Para modificarlo hay que reabrirlo desde Resultados.") : null,

    faltanEvals.length ? el("div", { class: "nota warn", text:
      `${faltanEvals.length} bombero(s) sin fila de evaluación. Se dan de alta al ` +
      `abrir el mes; si se sumaron después, volvé a abrir el mes para precargarlos.` }) : null,

    el("div", { class: "tarjeta" },
      el("div", { class: "scroll-tabla" },
        el("table", {},
          el("thead", {}, el("tr", {},
            el("th", { style: "width:70px" }, "Legajo"),
            el("th", {}, "Bombero"),
            CATEGORIAS.map(c => el("th", { class: "cen", title: c.ayuda },
              c.label.replace(" de guardia", "").replace("Cambio", "Relevo"))),
            el("th", {}, "")
          )),
          cuerpo
        )
      )
    )
  );

  marcar();
}
