// Informe imprimible.
//
// Dos partes: un resumen general con una columna por mes y el promedio del
// período, y después una hoja por bombero con su detalle.
//
// La columna por mes no es adorno. Un promedio de seis meses esconde
// exactamente lo que hay que ver: quién venía mal y se recuperó, y quién se
// cayó en los últimos dos. Dos personas con 72 de promedio pueden ser una que
// mejoró de 60 a 85 y otra que se desplomó de 85 a 60, y son conversaciones
// opuestas.
//
// Se imprime desde el navegador: el diálogo de Windows incluye "Microsoft
// Print to PDF", así que guardar en PDF sale gratis y no hay que empaquetar
// un generador.

import { el, montar, limpiar, dialogo, avisar, errorDe, num, pct, nombreMes } from "./ui.js";
import { CATEGORIAS, BANDAS, RANGO_LABEL } from "./config.js";
import {
  puntajesDeVarios, evaluacionesDeVarios, detalleDeVarios, penalizacionesDeVarios
} from "./api.js";

const CUANTOS_POR_DEFECTO = 6;

export async function abrirInforme({ periodos, gente, cuartel }) {
  if (!periodos.length) { avisar("No hay meses para informar", "error"); return; }

  // Los períodos llegan del más nuevo al más viejo. Se preseleccionan los seis
  // últimos, que es lo que se pidió, pero cada uno se puede destildar.
  const elegidos = new Set(periodos.slice(0, CUANTOS_POR_DEFECTO).map(p => p.id));

  const lista = el("div", {
    style: "display:grid;grid-template-columns:1fr 1fr;gap:4px;max-height:230px;overflow:auto"
  });

  const resumen = el("div", { class: "nota info", style: "margin-top:12px" });

  function actualizarResumen() {
    resumen.textContent = elegidos.size
      ? `${elegidos.size} mes(es) · ${gente.length} personas · ` +
        `${1 + gente.length} hojas aproximadamente`
      : "Elegí al menos un mes.";
  }

  for (const p of periodos) {
    const chk = el("input", {
      type: "checkbox", checked: elegidos.has(p.id), style: "width:auto;margin-right:8px"
    });
    const lbl = el("label", {
      style: "display:flex;align-items:center;padding:6px 8px;border:1px solid var(--borde);" +
             "border-radius:6px;cursor:pointer;font-size:14px",
      onclick: ev => {
        if (ev.target !== chk) { ev.preventDefault(); chk.checked = !chk.checked; }
        chk.checked ? elegidos.add(p.id) : elegidos.delete(p.id);
        lbl.style.background = chk.checked ? "#ecfdf3" : "";
        actualizarResumen();
      }
    }, chk, `${nombreMes(p.mes)} ${p.anio}`,
       p.estado === "cerrado"
         ? el("span", { class: "chip", style: "margin-left:auto", text: "cerrado" })
         : null);
    if (chk.checked) lbl.style.background = "#ecfdf3";
    lista.append(lbl);
  }
  actualizarResumen();

  await dialogo({
    titulo: "Imprimir informe",
    confirmar: "Generar",
    cuerpo: el("div", {},
      el("p", { class: "nota info", text:
        "Un resumen general con una columna por mes, y después una hoja por " +
        "persona con sus notas, horas y presentismo." }),
      el("div", { style: "font-size:13px;font-weight:600;margin-bottom:6px",
                  text: "Meses a incluir" }),
      lista,
      resumen
    ),
    alConfirmar: async () => {
      if (!elegidos.size) return false;
      const sel = periodos.filter(p => elegidos.has(p.id))
                          .sort((a, b) => (a.anio - b.anio) || (a.mes - b.mes));
      try {
        await generar(sel, gente, cuartel);
      } catch (e) { errorDe(e); return false; }
      return true;
    }
  });
}

// --------------------------------------------------------------- generación

async function generar(periodos, gente, cuartel) {
  const ids = periodos.map(p => p.id);

  const [puntajes, evals, detalles, penas] = await Promise.all([
    puntajesDeVarios(ids), evaluacionesDeVarios(ids),
    detalleDeVarios(ids), penalizacionesDeVarios(ids)
  ]);

  // Se indexa todo por período+bombero antes de dibujar: buscar con .find()
  // dentro de un bucle anidado de 6 meses × 18 personas × 6 categorías es
  // lento de una manera que se nota justo cuando el jefe está esperando.
  const clave = (p, b) => `${p}|${b}`;
  const porPuntaje = new Map(puntajes.map(r => [clave(r.periodo_id, r.bombero_id), r]));
  const porEval    = new Map(evals.map(r => [clave(r.periodo_id, r.bombero_id), r]));
  const porDetalle = new Map(detalles.map(r => [clave(r.periodo_id, r.bombero_id), r]));
  const porPena    = new Map();
  for (const p of penas) {
    const k = clave(p.periodo_id, p.bombero_id);
    if (!porPena.has(k)) porPena.set(k, []);
    porPena.get(k).push(p);
  }

  // Sólo se informa a quien se evalúa: el resto no tiene puntaje que mostrar.
  const evaluables = gente.filter(b => b.evaluable);

  const titulo = periodos.length === 1
    ? `${nombreMes(periodos[0].mes)} ${periodos[0].anio}`
    : `${nombreMes(periodos[0].mes)} ${periodos[0].anio} — ` +
      `${nombreMes(periodos.at(-1).mes)} ${periodos.at(-1).anio}`;

  const raiz = el("div", { id: "informe" });

  // ------------------------------------------------------ resumen general

  const promedioDe = b => {
    const vs = periodos
      .map(p => porPuntaje.get(clave(p.id, b.id))?.puntaje_final)
      .filter(v => v !== null && v !== undefined)
      .map(Number);
    return vs.length ? vs.reduce((a, c) => a + c, 0) / vs.length : null;
  };

  const ordenados = [...evaluables].sort((a, b) => (promedioDe(b) ?? -1) - (promedioDe(a) ?? -1));

  montar(raiz,
    el("section", { class: "hoja-informe" },
      encabezado(cuartel, "Resumen general", titulo),
      el("table", { class: "tabla-informe" },
        el("thead", {}, el("tr", {},
          el("th", { style: "width:52px" }, "Leg."),
          el("th", {}, "Bombero"),
          periodos.map(p => el("th", { class: "cen" },
            `${nombreMes(p.mes).slice(0, 3)} ${String(p.anio).slice(2)}`)),
          el("th", { class: "cen" }, "Promedio"),
          el("th", {}, "Banda"))),
        el("tbody", {}, ordenados.map(b => {
          const prom = promedioDe(b);
          // La banda del último mes con datos, no la del promedio: es la
          // situación actual de la persona, que es lo que se acciona.
          const ultimo = [...periodos].reverse()
            .map(p => porPuntaje.get(clave(p.id, b.id)))
            .find(r => r && r.banda);
          const banda = BANDAS[ultimo?.banda];
          return el("tr", {},
            el("td", { class: "num", text: b.legajo }),
            el("td", {}, b.nombre),
            periodos.map(p => {
              const r = porPuntaje.get(clave(p.id, b.id));
              return el("td", { class: "cen num",
                text: r?.puntaje_final === null || r?.puntaje_final === undefined
                  ? "—" : num(r.puntaje_final, 1) });
            }),
            el("td", { class: "cen num", style: "font-weight:700",
                       text: prom === null ? "—" : num(prom, 1) }),
            el("td", { style: banda ? `color:${banda.color};font-weight:600` : "",
                       text: banda?.label ?? "—" }));
        }))),
      el("p", { class: "pie-informe", text:
        "El puntaje surge de horas de guardia, presentismo en salidas y seis " +
        "notas del jefe de cuartel, ponderadas según la configuración vigente " +
        "de cada mes. La banda corresponde al último mes con datos." })
    )
  );

  // ------------------------------------------------- una hoja por bombero

  for (const b of ordenados) {
    montar(raiz,
      el("section", { class: "hoja-informe" },
        encabezado(cuartel, b.nombre,
          `Legajo ${b.legajo} · ${RANGO_LABEL[b.rango] ?? b.rango} · ${titulo}`),

        el("table", { class: "tabla-informe" },
          el("thead", {}, el("tr", {},
            el("th", {}, "Concepto"),
            periodos.map(p => el("th", { class: "cen" },
              `${nombreMes(p.mes).slice(0, 3)} ${String(p.anio).slice(2)}`)))),
          el("tbody", {},
            fila("Horas de guardia", periodos, p => {
              const d = porDetalle.get(clave(p.id, b.id));
              return d ? `${num(d.horas, 1)} / ${num(d.meta_ajustada, 1)}` : "—";
            }),
            fila("Cumplimiento de horas", periodos, p =>
              pct(porPuntaje.get(clave(p.id, b.id))?.pct_guardia)),
            fila("Salidas asistidas", periodos, p => {
              const d = porDetalle.get(clave(p.id, b.id));
              return d ? `${d.salidas_presente} / ${d.salidas_convocable}` : "—";
            }),
            fila("Presentismo", periodos, p =>
              pct(porPuntaje.get(clave(p.id, b.id))?.pct_salidas)),

            el("tr", { class: "separador" },
              el("td", { colspan: periodos.length + 1 }, "Notas del jefe (1 a 10)")),

            ...CATEGORIAS.map(c =>
              fila(c.label, periodos, p => {
                const e = porEval.get(clave(p.id, b.id));
                if (!e) return "—";
                if ((e.no_aplica ?? []).includes(c.k)) return "N/A";
                return e[c.k] ?? "—";
              })),

            el("tr", { class: "separador" },
              el("td", { colspan: periodos.length + 1 }, "Resultado")),

            fila("Sanciones", periodos, p => {
              const ps = porPena.get(clave(p.id, b.id)) ?? [];
              const t = ps.reduce((a, c) => a + Number(c.puntos), 0);
              return t ? `−${num(t, 1)}` : "—";
            }),
            fila("Puntaje final", periodos, p => {
              const r = porPuntaje.get(clave(p.id, b.id));
              return r?.puntaje_final == null ? "—" : num(r.puntaje_final, 1);
            }, true),
            fila("Banda", periodos, p => {
              const r = porPuntaje.get(clave(p.id, b.id));
              return BANDAS[r?.banda]?.label ?? "—";
            }))),

        comentarios(periodos, b, porEval, porPena),

        el("div", { class: "firmas" },
          el("div", {}, el("div", { class: "linea-firma" }), "Jefe de cuartel"),
          el("div", {}, el("div", { class: "linea-firma" }), "Notificado"))
      )
    );
  }

  imprimir(raiz);
}

function fila(etiqueta, periodos, valor, fuerte = false) {
  return el("tr", { class: fuerte ? "fuerte" : "" },
    el("td", {}, etiqueta),
    periodos.map(p => el("td", { class: "cen num", text: String(valor(p)) })));
}

function encabezado(cuartel, titulo, subtitulo) {
  return el("header", { class: "enc-informe" },
    el("div", {},
      el("div", { class: "cuartel", text: cuartel || "Cuerpo de Bomberos Voluntarios" }),
      el("h1", { text: titulo }),
      el("div", { class: "sub", text: subtitulo })),
    el("div", { class: "emitido",
      text: "Emitido " + new Date().toLocaleDateString("es-AR") }));
}

// Los comentarios del jefe y los motivos de sanción son texto libre: es lo
// único del informe que explica un número en lugar de repetirlo, así que si
// existen valen más que cualquier tabla.
function comentarios(periodos, b, porEval, porPena) {
  const items = [];
  for (const p of periodos) {
    const k = `${p.id}|${b.id}`;
    const c = porEval.get(k)?.comentario_jefe;
    if (c) items.push([`${nombreMes(p.mes)} ${p.anio}`, c]);
    for (const s of porPena.get(k) ?? [])
      if (s.motivo) items.push([`${nombreMes(p.mes)} ${p.anio} · sanción`, s.motivo]);
  }
  if (!items.length) return null;

  return el("div", { class: "observaciones" },
    el("h2", { text: "Observaciones" }),
    items.map(([cuando, texto]) =>
      el("p", {}, el("b", { text: cuando + ": " }), texto)));
}

// ---------------------------------------------------------------- impresión

function imprimir(raiz) {
  document.getElementById("informe")?.remove();
  document.body.append(raiz);
  document.body.classList.add("imprimiendo");

  // El limpiado va en afterprint y no justo después de print(): en Electron
  // print() no bloquea, así que borrar el nodo en la línea siguiente deja al
  // diálogo del sistema imprimiendo una página en blanco.
  const limpiar = () => {
    document.body.classList.remove("imprimiendo");
    raiz.remove();
    window.removeEventListener("afterprint", limpiar);
  };
  window.addEventListener("afterprint", limpiar);

  window.print();
}
