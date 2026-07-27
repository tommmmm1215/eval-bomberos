// Registro de salidas.
//
// Sólo se tildan los presentes. El resto de la dotación queda 'ausente'
// automáticamente, salvo quien tenga una novedad vigente ese día, que pasa
// a 'no_convocable' y por lo tanto no le cuenta en contra.

import { dotacion, emergencias, registrarEmergencia, anularEmergencia } from "../api.js";
import { el, montar, limpiar, avisar, errorDe, cargando, fechaHora, dialogo, confirmar, num } from "../ui.js";
import { TIPOS_EMERGENCIA } from "../config.js";
import { estado } from "../main.js";

export async function pantallaSalidas(hoja) {
  const periodo = estado.periodo;
  const cerrado = periodo.estado === "cerrado";

  montar(limpiar(hoja), cargando());

  let gente, lista;
  try {
    [gente, lista] = await Promise.all([
      dotacion({ soloEvaluables: true }),
      emergencias(periodo.id)
    ]);
  } catch (e) { errorDe(e); limpiar(hoja); return; }

  const porId = Object.fromEntries(gente.map(b => [b.id, b]));
  const computables = lista.filter(e => e.computable);

  // ------------------------------------------------------------- alta

  async function nuevaSalida() {
    const selTipo = el("select");
    for (const t of TIPOS_EMERGENCIA)
      selTipo.append(el("option", { value: t.k, text: t.label, dataset: { peso: t.peso } }));

    const inpPeso = el("input", { type: "number", min: "0.25", max: "5", step: "0.25",
                                  value: TIPOS_EMERGENCIA[0].peso });
    selTipo.onchange = () => { inpPeso.value = selTipo.selectedOptions[0].dataset.peso; };

    // Por defecto ahora, pero editable: lo normal es cargarla después.
    const ahora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
    const inpFecha = el("input", { type: "datetime-local", value: ahora });
    const inpCodigo = el("input", { type: "text", placeholder: "opcional" });

    const seleccion = new Set();
    const contador = el("span", { class: "chip", text: "0 presentes" });

    const listaGente = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:5px" },
      gente.map(b => {
        const chk = el("input", { type: "checkbox", style: "width:auto;margin-right:8px" });
        const lbl = el("label", {
          style: "display:flex;align-items:center;padding:6px 8px;border:1px solid var(--borde);" +
                 "border-radius:6px;cursor:pointer;font-size:14px",
          onclick: ev => {
            if (ev.target !== chk) { ev.preventDefault(); chk.checked = !chk.checked; }
            chk.checked ? seleccion.add(b.id) : seleccion.delete(b.id);
            lbl.style.background = chk.checked ? "#ecfdf3" : "";
            lbl.style.borderColor = chk.checked ? "#067647" : "var(--borde)";
            contador.textContent = `${seleccion.size} presentes`;
          }
        }, chk, b.nombre);
        return lbl;
      })
    );

    const ok = await dialogo({
      titulo: "Registrar una salida",
      confirmar: "Registrar",
      cuerpo: el("div", {},
        el("div", { class: "fila" },
          el("label", { class: "campo" }, el("span", { text: "Tipo" }), selTipo),
          el("label", { class: "campo" }, el("span", { text: "Peso" }), inpPeso,
            el("small", { text: "Cuánto vale esta salida frente a una común (1.0)" }))
        ),
        el("div", { class: "fila" },
          el("label", { class: "campo" }, el("span", { text: "Fecha y hora" }), inpFecha,
            el("small", { text: "Se puede cargar después: poné la hora real de la salida" })),
          el("label", { class: "campo" }, el("span", { text: "Código / parte" }), inpCodigo)
        ),
        el("label", { class: "campo" },
          el("span", {}, "Quiénes salieron  ", contador),
          el("small", { style: "margin:0 0 7px", text:
            "Marcá sólo a los presentes. Al resto se le cuenta ausente, salvo que " +
            "tenga una novedad cargada ese día." }),
          listaGente
        )
      ),
      alConfirmar: async () => {
        if (!seleccion.size) {
          const seguir = await confirmar("Sin presentes",
            "No marcaste a nadie. ¿Registrar igual la salida?",
            { confirmar: "Registrar igual", peligro: false });
          if (!seguir) return false;
        }
        await registrarEmergencia(periodo.id, {
          ocurridaEn: new Date(inpFecha.value).toISOString(),
          tipo: selTipo.value,
          peso: Number(inpPeso.value),
          codigo: inpCodigo.value.trim(),
          presentes: [...seleccion]
        });
      }
    });

    if (ok) { avisar("Salida registrada", "ok"); pantallaSalidas(hoja); }
  }

  // ------------------------------------------------------------- tabla

  const filas = lista.map(e => {
    const asis = e.emergencia_asistencia ?? [];
    const presentes = asis.filter(a => a.estado === "presente");
    const convocables = asis.filter(a => a.estado !== "no_convocable");
    const etiqueta = TIPOS_EMERGENCIA.find(t => t.k === e.tipo)?.label ?? e.tipo;

    return el("tr", { style: e.computable ? "" : "opacity:.45" },
      el("td", { class: "num", style: "white-space:nowrap", text: fechaHora(e.ocurrida_en) }),
      el("td", {}, etiqueta,
        e.codigo ? el("span", { class: "legajo", text: " · " + e.codigo }) : null,
        !e.computable ? el("span", { class: "chip rojo", style: "margin-left:6px" }, "no computa") : null),
      el("td", { class: "cen num", text: num(e.peso, 2) }),
      el("td", { class: "cen num", text: `${presentes.length} / ${convocables.length}` }),
      el("td", {}, el("div", { style: "font-size:13px;color:var(--suave)" },
        presentes.map(p => porId[p.bombero_id]?.nombre?.split(",")[0]).filter(Boolean).join(", ") || "—")),
      el("td", { class: "der" },
        cerrado ? null : el("button", {
          class: "btn sec chico",
          text: e.computable ? "Anular" : "Restaurar",
          title: e.computable
            ? "Saca la salida del cálculo sin borrarla (falsa alarma, carga errónea)"
            : "Vuelve a incluirla en el cálculo",
          onclick: async () => {
            try {
              await anularEmergencia(e.id, !e.computable);
              avisar(e.computable ? "Salida anulada" : "Salida restaurada", "ok");
              pantallaSalidas(hoja);
            } catch (err) { errorDe(err); }
          }
        })
      )
    );
  });

  montar(limpiar(hoja), 
    el("div", { class: "cabecera" },
      el("div", {},
        el("h1", { text: "Salidas del mes" }),
        el("p", { class: "bajada", text:
          "El presentismo se mide sobre las salidas a las que cada uno podía ir, " +
          "no sobre el total del cuartel." })
      ),
      el("div", { class: "acciones" },
        el("span", { class: "chip", text: `${computables.length} computables` }),
        el("button", { class: "btn", disabled: cerrado, onclick: nuevaSalida }, "Registrar salida")
      )
    ),

    cerrado ? el("div", { class: "cerrado-aviso" },
      "Este mes está cerrado. Para modificarlo hay que reabrirlo desde Resultados.") : null,

    el("div", { class: "tarjeta" },
      lista.length
        ? el("div", { class: "scroll-tabla" }, el("table", {},
            el("thead", {}, el("tr", {},
              el("th", { style: "width:140px" }, "Cuándo"),
              el("th", {}, "Tipo"),
              el("th", { class: "cen", style: "width:70px" }, "Peso"),
              el("th", { class: "cen", style: "width:90px" }, "Asistió"),
              el("th", {}, "Presentes"),
              el("th", { style: "width:100px" }, "")
            )),
            el("tbody", {}, filas)
          ))
        : el("div", { class: "vacio" },
            el("p", { text: "Todavía no hay salidas cargadas este mes." }),
            cerrado ? null : el("button", { class: "btn", onclick: nuevaSalida }, "Registrar la primera"))
    )
  );
}
