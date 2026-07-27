// Resultados del mes: ranking, desglose y cierre.
//
// El desglose es lo que convierte una discusión en una conversación: ante un
// reclamo se abre y se ve exactamente qué categoría restó y cuánto.

import {
  dotacion, puntajes, detalleGuardias, penalizaciones,
  guardarPenalizacion, borrarPenalizacion, cerrarPeriodo, reabrirPeriodo
} from "../api.js";
import {
  el, montar, limpiar, avisar, errorDe, cargando, num, pct, chipBanda,
  celdaPersona, dialogo, confirmar, tituloPeriodo, barra
} from "../ui.js";
import { CATEGORIAS, BANDAS } from "../config.js";
import { estado, refrescarPeriodos, repintar } from "../main.js";

const ETIQUETA = Object.fromEntries([
  ["guardia", "Guardia"], ["salidas", "Salidas"],
  ...CATEGORIAS.map(c => [c.k, c.label])
]);

export async function pantallaRanking(hoja) {
  const periodo = estado.periodo;
  const cerrado = periodo.estado === "cerrado";

  montar(limpiar(hoja), cargando());

  let gente, filas, detalle, penas;
  try {
    [gente, filas, detalle, penas] = await Promise.all([
      dotacion({ soloEvaluables: true }),
      puntajes(periodo.id),
      cerrado ? Promise.resolve({}) : detalleGuardias(periodo.id),
      penalizaciones(periodo.id)
    ]);
  } catch (e) { errorDe(e); limpiar(hoja); return; }

  const porId = Object.fromEntries(gente.map(b => [b.id, b]));
  filas = filas
    .filter(f => porId[f.bombero_id])
    .sort((a, b) => Number(b.puntaje_final) - Number(a.puntaje_final));

  const penasPorBombero = {};
  for (const p of penas) (penasPorBombero[p.bombero_id] ??= []).push(p);

  // ------------------------------------------------------------ desglose

  async function verDesglose(f) {
    const b = porId[f.bombero_id];
    const d = f.desglose ?? {};
    const cats = d.categorias ?? {};
    const det = detalle[f.bombero_id];

    const tabla = el("table", {},
      el("thead", {}, el("tr", {},
        el("th", {}, "Categoría"),
        el("th", { class: "der" }, "Nivel"),
        el("th", { class: "der" }, "Peso"),
        el("th", { class: "der" }, "Aporte"))),
      el("tbody", {},
        Object.entries(cats)
          .sort((a, b2) => Number(b2[1].peso) - Number(a[1].peso))
          .map(([k, v]) => el("tr", {},
            el("td", { text: ETIQUETA[k] ?? k }),
            el("td", { class: "der num", text: pct(Number(v.n) * 100) }),
            el("td", { class: "der num", text: num(v.peso, 0) }),
            el("td", { class: "der num", style: "font-weight:600", text: num(v.aporte, 2) })
          ))
      ),
      el("tfoot", {}, el("tr", {},
        el("td", { colspan: "2", style: "font-weight:600" }, "Puntaje bruto"),
        el("td", { class: "der num", text: num(d.peso_aplicado, 0) }),
        el("td", { class: "der num", style: "font-weight:700", text: num(f.puntaje_bruto, 2) })
      ))
    );

    const notas = [];
    if (d.no_aplica?.length)
      notas.push(el("p", { class: "nota info", text:
        `${d.no_aplica.map(k => ETIQUETA[k] ?? k).join(", ")} no se evaluó este mes: ` +
        `sale del divisor y su peso se redistribuye entre el resto. Por eso el ` +
        `total de pesos es ${num(d.peso_aplicado, 0)} y no 100.` }));
    if (Number(f.penalizaciones) > 0)
      notas.push(el("p", { class: "nota warn", text:
        `Se restaron ${num(f.penalizaciones, 1)} puntos por sanciones.` }));
    if (d.tope_aplicado)
      notas.push(el("p", { class: "nota error", text:
        "No alcanzó el piso operativo, así que el puntaje quedó topeado y la banda " +
        "no puede ser mejor que «requiere mejora», por buenas que sean las notas." }));

    await dialogo({
      titulo: `${b.nombre} — ${tituloPeriodo(periodo)}`,
      confirmar: "Cerrar",
      cuerpo: el("div", {},
        el("div", { class: "grilla-3", style: "margin-bottom:16px" },
          el("div", { class: "tarjeta dato" },
            el("div", { class: "k", text: "Puntaje final" }),
            el("div", { class: "v", text: num(f.puntaje_final, 2) }),
            el("div", { class: "sub" }, chipBanda(f.banda))),
          el("div", { class: "tarjeta dato" },
            el("div", { class: "k", text: "Guardia" }),
            el("div", { class: "v", text: pct(f.pct_guardia) }),
            det ? el("div", { class: "sub", text:
              `${num(det.horas, 2)} h de ${num(det.meta_ajustada, 2)} exigidas` }) : null),
          el("div", { class: "tarjeta dato" },
            el("div", { class: "k", text: "Salidas" }),
            el("div", { class: "v", text: pct(f.pct_salidas) }),
            det ? el("div", { class: "sub", text:
              `${det.salidas_presente} de ${det.salidas_convocable} convocables` }) : null)
        ),
        notas,
        el("div", { class: "tarjeta" }, tabla)
      )
    });
  }

  // ---------------------------------------------------------- sanciones

  async function gestionarSanciones() {
    const selB = el("select");
    for (const b of gente) selB.append(el("option", { value: b.id, text: b.nombre }));
    const selTipo = el("select");
    for (const [k, l] of [["apercibimiento", "Apercibimiento"], ["suspension", "Suspensión"], ["otro", "Otro"]])
      selTipo.append(el("option", { value: k, text: l }));
    const inpPuntos = el("input", { type: "number", min: "0.5", max: "100", step: "0.5", value: "5" });
    const inpMotivo = el("input", { type: "text", placeholder: "Motivo (queda registrado)" });

    const listado = el("div", {}, penas.length
      ? penas.map(p => el("div", {
          style: "display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--linea)"
        },
          el("div", { style: "flex:1;font-size:13.5px" },
            el("b", { text: porId[p.bombero_id]?.nombre ?? "—" }),
            el("div", { style: "color:var(--suave)" }, `${p.tipo} · ${p.motivo}`)),
          el("span", { class: "chip rojo", text: `−${num(p.puntos, 1)}` }),
          el("button", { class: "btn sec chico", text: "Quitar", onclick: async ev => {
            try { await borrarPenalizacion(p.id); ev.target.closest("div").remove(); avisar("Sanción quitada", "ok"); }
            catch (e) { errorDe(e); }
          }})
        ))
      : el("p", { style: "color:var(--suave);font-size:13.5px" }, "Sin sanciones este mes."));

    const ok = await dialogo({
      titulo: "Sanciones del mes",
      confirmar: "Agregar sanción",
      cuerpo: el("div", {},
        el("p", { class: "nota info", text:
          "Los puntos se restan del puntaje bruto, fuera de la ponderación: son " +
          "hechos disciplinarios, no una dimensión de desempeño." }),
        listado,
        el("div", { style: "margin-top:16px" },
          el("label", { class: "campo" }, el("span", { text: "Bombero" }), selB),
          el("div", { class: "fila" },
            el("label", { class: "campo" }, el("span", { text: "Tipo" }), selTipo),
            el("label", { class: "campo" }, el("span", { text: "Puntos a restar" }), inpPuntos)),
          el("label", { class: "campo" }, el("span", { text: "Motivo" }), inpMotivo))
      ),
      alConfirmar: async () => {
        if (!inpMotivo.value.trim()) { avisar("Hace falta un motivo", "error"); return false; }
        await guardarPenalizacion(periodo.id, selB.value, {
          tipo: selTipo.value, puntos: Number(inpPuntos.value), motivo: inpMotivo.value.trim()
        });
      }
    });
    if (ok) { avisar("Sanción registrada", "ok"); pantallaRanking(hoja); }
    else pantallaRanking(hoja);
  }

  // ------------------------------------------------------ cerrar / reabrir

  async function cerrar() {
    const ok = await confirmar("Cerrar el mes",
      `Se congelan los resultados de ${tituloPeriodo(periodo)} y se bloquea toda ` +
      `modificación: horas, salidas y notas quedan como están. Se puede reabrir, ` +
      `pero queda registrado el motivo.`,
      { confirmar: "Cerrar el mes" });
    if (!ok) return;
    try {
      const n = await cerrarPeriodo(periodo.id);
      avisar(`Mes cerrado — ${n} resultados congelados`, "ok");
      await refrescarPeriodos(); repintar();
    } catch (e) { errorDe(e); }
  }

  async function reabrir() {
    const ta = el("textarea", { placeholder: "Por qué se reabre (mínimo 10 caracteres)" });
    const ok = await dialogo({
      titulo: "Reabrir el mes", confirmar: "Reabrir", peligro: true,
      cuerpo: el("div", {},
        el("p", { class: "nota warn", text:
          "Se borra la foto congelada y el puntaje vuelve a calcularse en vivo. " +
          "El motivo queda asentado." }),
        ta),
      alConfirmar: async () => {
        if (ta.value.trim().length < 10) { avisar("El motivo es muy corto", "error"); return false; }
        await reabrirPeriodo(periodo.id, ta.value.trim());
      }
    });
    if (ok) { avisar("Mes reabierto", "ok"); await refrescarPeriodos(); repintar(); }
  }

  // --------------------------------------------------------- resumen

  const conTope = filas.filter(f => f.desglose?.tope_aplicado).length;
  const promedio = filas.length
    ? filas.reduce((a, f) => a + Number(f.puntaje_final), 0) / filas.length : 0;

  montar(limpiar(hoja), 
    el("div", { class: "cabecera" },
      el("div", {},
        el("h1", { text: `Resultados de ${tituloPeriodo(periodo)}` }),
        el("p", { class: "bajada", text: cerrado
          ? "Mes cerrado: estos números son la foto congelada al momento del cierre."
          : "Cálculo en vivo. Cambia solo a medida que se cargan horas, salidas y notas." })
      ),
      el("div", { class: "acciones" },
        el("button", { class: "btn sec", disabled: cerrado, onclick: gestionarSanciones }, "Sanciones"),
        cerrado
          ? el("button", { class: "btn sec", onclick: reabrir }, "Reabrir mes")
          : el("button", { class: "btn", onclick: cerrar }, "Cerrar mes")
      )
    ),

    el("div", { class: "grilla-3", style: "margin-bottom:18px" },
      el("div", { class: "tarjeta dato" },
        el("div", { class: "k", text: "Evaluados" }),
        el("div", { class: "v num", text: filas.length })),
      el("div", { class: "tarjeta dato" },
        el("div", { class: "k", text: "Promedio del cuartel" }),
        el("div", { class: "v num", text: num(promedio, 1) })),
      el("div", { class: "tarjeta dato" },
        el("div", { class: "k", text: "Bajo el piso operativo" }),
        el("div", { class: "v num", text: conTope }),
        el("div", { class: "sub", text: conTope ? "puntaje topeado" : "nadie" }))
    ),

    el("div", { class: "tarjeta" },
      el("div", { class: "scroll-tabla" }, el("table", {},
        el("thead", {}, el("tr", {},
          el("th", { style: "width:44px" }, "#"),
          el("th", {}, "Bombero"),
          el("th", { class: "der", style: "width:100px" }, "Guardia"),
          el("th", { class: "der", style: "width:100px" }, "Salidas"),
          el("th", { class: "der", style: "width:90px" }, "Sanción"),
          el("th", { class: "der", style: "width:90px" }, "Puntaje"),
          el("th", { style: "width:140px" }, "Banda"),
          el("th", { style: "width:110px" }, "")
        )),
        el("tbody", {}, filas.map((f, i) => {
          const b = porId[f.bombero_id];
          const color = BANDAS[f.banda]?.color ?? "#6d675d";
          return el("tr", {},
            el("td", { class: "num legajo", text: i + 1 }),
            el("td", {}, celdaPersona(b)),
            el("td", { class: "der num", text: pct(f.pct_guardia) }),
            el("td", { class: "der num", text: pct(f.pct_salidas) }),
            el("td", { class: "der num", style: Number(f.penalizaciones) ? "color:var(--rojo)" : "color:var(--suave)",
                       text: Number(f.penalizaciones) ? "−" + num(f.penalizaciones, 1) : "—" }),
            el("td", { class: "der num", style: "font-weight:700;font-size:15px",
                       text: num(f.puntaje_final, 1) }),
            el("td", {}, chipBanda(f.banda), barra(f.puntaje_final, color)),
            el("td", { class: "der" },
              el("button", { class: "btn sec chico", onclick: () => verDesglose(f) }, "Desglose"))
          );
        }))
      )),
      !filas.length ? el("div", { class: "vacio" },
        el("p", { text: "Todavía no hay nada que calcular este mes." })) : null
    )
  );
}
