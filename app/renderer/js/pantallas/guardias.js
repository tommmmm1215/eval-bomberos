// Carga semanal de horas de guardia.
//
// Es la pantalla que más se usa y donde está el ahorro de tiempo, así que
// está pensada para completarse con el teclado: se tipea un número, Enter
// baja a la siguiente fila, y al final un solo guardado para todo el cuartel.

import { sesion, dotacion, guardiasDeSemana, totalesGuardia, guardarSemana } from "../api.js";
import { el, montar, limpiar, avisar, errorDe, num, cargando, semanaDelMes, barra } from "../ui.js";
import { estado } from "../main.js";
import { marcarCambiosSinGuardar } from "../actualizador.js";

let semanaActual = null;

export async function pantallaGuardias(hoja) {
  const periodo = estado.periodo;
  const cerrado = periodo.estado === "cerrado";
  if (semanaActual === null) semanaActual = semanaDelMes();

  montar(limpiar(hoja), cargando());

  let gente, horasSemana, totales, meta;
  try {
    gente = await dotacion({ soloEvaluables: true });
    [horasSemana, totales] = await Promise.all([
      guardiasDeSemana(periodo.id, semanaActual),
      totalesGuardia(periodo.id)
    ]);
    // Meta base del mes. La meta real de cada bombero se prorratea por sus
    // días disponibles; acá sólo se usa para dibujar la barra de referencia.
    meta = Number(sesion.config?.meta_horas_mes ?? 0) || null;
  } catch (e) { errorDe(e); limpiar(hoja); return; }

  const editados = new Map();   // bombero_id -> horas (sólo lo que se tocó)
  const inputs = [];

  // ------------------------------------------------------------ cabecera

  const selSemana = el("select", { style: "width:auto", onchange: ev => {
    semanaActual = Number(ev.target.value);
    pantallaGuardias(hoja);
  }});
  for (let s = 1; s <= 5; s++)
    selSemana.append(el("option", { value: s, selected: s === semanaActual, text: `Semana ${s}` }));

  const btnGuardar = el("button", { class: "btn", disabled: true, onclick: guardar },
    "Guardar semana");

  const btnCopiar = el("button", {
    class: "btn sec", disabled: cerrado || semanaActual === 1,
    title: "Trae las horas de la semana anterior a esta",
    onclick: copiarAnterior
  }, "Copiar semana anterior");

  function marcarPendiente() {
    marcarCambiosSinGuardar(editados.size > 0);
    btnGuardar.disabled = cerrado || editados.size === 0;
    btnGuardar.textContent = editados.size
      ? `Guardar semana (${editados.size})`
      : "Guardar semana";
  }

  // -------------------------------------------------------------- acciones

  async function guardar() {
    if (!editados.size) return;
    btnGuardar.disabled = true; btnGuardar.textContent = "Guardando…";
    try {
      const registros = [...editados.entries()].map(([bombero_id, horas]) => ({ bombero_id, horas }));
      await guardarSemana(periodo.id, semanaActual, registros);
      avisar(`Semana ${semanaActual} guardada — ${registros.length} registro(s)`, "ok");
      await pantallaGuardias(hoja);
    } catch (e) {
      errorDe(e);
      btnGuardar.disabled = false; marcarPendiente();
    }
  }

  async function copiarAnterior() {
    try {
      const previa = await guardiasDeSemana(periodo.id, semanaActual - 1);
      if (!Object.keys(previa).length) {
        avisar(`La semana ${semanaActual - 1} está vacía`, "error");
        return;
      }
      let n = 0;
      for (const inp of inputs) {
        const v = previa[inp.dataset.bombero];
        if (v === undefined) continue;
        if (Number(inp.value || 0) === v) continue;
        inp.value = v;
        inp.classList.add("editado");
        editados.set(inp.dataset.bombero, v);
        n++;
      }
      marcarPendiente();
      avisar(n ? `${n} fila(s) copiadas — falta guardar` : "Ya estaba igual que la semana anterior");
    } catch (e) { errorDe(e); }
  }

  // ---------------------------------------------------------------- tabla

  const cuerpo = el("tbody");

  gente.forEach((b, i) => {
    const original = horasSemana[b.id] ?? 0;
    const totalMes = totales[b.id] ?? 0;

    const inp = el("input", {
      type: "number", class: "horas num", min: "0", max: "168", step: "0.25",
      value: original || "", disabled: cerrado,
      dataset: { bombero: b.id, i },
      onfocus: ev => ev.target.select(),
      oninput: ev => {
        const v = ev.target.value === "" ? 0 : Number(ev.target.value);
        if (v === original) { editados.delete(b.id); ev.target.classList.remove("editado"); }
        else { editados.set(b.id, v); ev.target.classList.add("editado"); }
        marcarPendiente();
      },
      onkeydown: ev => {
        const idx = Number(ev.target.dataset.i);
        if (ev.key === "Enter" || ev.key === "ArrowDown") {
          ev.preventDefault();
          (inputs[idx + 1] ?? btnGuardar).focus();
        } else if (ev.key === "ArrowUp") {
          ev.preventDefault();
          inputs[idx - 1]?.focus();
        }
      }
    });
    inputs.push(inp);

    cuerpo.append(el("tr", {},
      el("td", { class: "legajo", text: b.legajo }),
      el("td", {}, b.nombre),
      el("td", { class: "der" }, inp),
      el("td", { class: "der num", text: num(totalMes, 2) }),
      el("td", { style: "width:130px" },
        meta ? barra(100 * totalMes / meta, totalMes >= meta ? "#067647" : "#1849a9") : "")
    ));
  });

  // ---------------------------------------------------------------- armado

  montar(limpiar(hoja), 
    el("div", { class: "cabecera" },
      el("div", {},
        el("h1", { text: "Horas de guardia" }),
        el("p", { class: "bajada", text:
          "Un número por bombero. Enter baja a la siguiente fila. " +
          "Si te equivocás, volvés a cargar la semana y se corrige: no se duplica." })
      ),
      el("div", { class: "acciones" }, selSemana, btnCopiar, btnGuardar)
    ),

    cerrado ? el("div", { class: "cerrado-aviso" },
      "Este mes está cerrado. Para modificarlo hay que reabrirlo desde Resultados.") : null,

    el("div", { class: "tarjeta" },
      el("div", { class: "scroll-tabla" },
        el("table", {},
          el("thead", {}, el("tr", {},
            el("th", { style: "width:70px" }, "Legajo"),
            el("th", {}, "Bombero"),
            el("th", { class: "der", style: "width:110px" }, `Semana ${semanaActual}`),
            el("th", { class: "der", style: "width:110px" }, "Total del mes"),
            el("th", { style: "width:150px" }, meta ? `Meta ${num(meta, 1)} h` : "")
          )),
          cuerpo
        )
      )
    )
  );

  marcarPendiente();
  if (!cerrado) setTimeout(() => inputs[0]?.focus(), 60);
}
