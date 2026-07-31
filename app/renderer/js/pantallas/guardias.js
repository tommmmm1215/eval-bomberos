// Carga mensual de horas de guardia.
//
// Es la pantalla que más se usa y donde está el ahorro de tiempo, así que
// está pensada para completarse con el teclado: se tipea un número, Enter
// baja a la siguiente fila, y al final un solo guardado para todo el cuartel.
//
// Un número por bombero y por mes. Antes se cargaba semana por semana, pero
// la semana nunca entró en el cálculo: la vista suma el período entero y la
// meta se prorratea por días disponibles. Lo único que hacía era obligar a
// elegir una semana antes de tipear y repetir la operación cinco veces por
// mes para un dato que el jefe ya tiene anotado como total.

import { sesion, dotacion, guardiasDelMes, guardarGuardias } from "../api.js";
import { el, montar, limpiar, avisar, errorDe, num, cargando, barra } from "../ui.js";
import { estado } from "../main.js";
import { marcarCambiosSinGuardar } from "../actualizador.js";
import { importarPlanilla } from "../importar.js";

export async function pantallaGuardias(hoja) {
  const periodo = estado.periodo;
  const cerrado = periodo.estado === "cerrado";

  montar(limpiar(hoja), cargando());

  let gente, horas, meta;
  try {
    gente = await dotacion({ soloEvaluables: true });
    horas = await guardiasDelMes(periodo.id);
    // Meta base del mes. La meta real de cada bombero se prorratea por sus
    // días disponibles; acá sólo se usa para dibujar la barra de referencia.
    meta = Number(sesion.config?.meta_horas_mes ?? 0) || null;
  } catch (e) { errorDe(e); limpiar(hoja); return; }

  const editados = new Map();   // bombero_id -> horas (sólo lo que se tocó)
  const inputs = [];

  // ------------------------------------------------------------ cabecera

  const btnGuardar = el("button", { class: "btn", disabled: true, onclick: guardar },
    "Guardar");

  function marcarPendiente() {
    marcarCambiosSinGuardar(editados.size > 0);
    btnGuardar.disabled = cerrado || editados.size === 0;
    btnGuardar.textContent = editados.size ? `Guardar (${editados.size})` : "Guardar";
  }

  // -------------------------------------------------------------- acciones

  async function guardar() {
    if (!editados.size) return;
    btnGuardar.disabled = true; btnGuardar.textContent = "Guardando…";
    try {
      const registros = [...editados.entries()].map(([bombero_id, horas]) => ({ bombero_id, horas }));
      await guardarGuardias(periodo.id, registros);
      avisar(`Guardado — ${registros.length} registro(s)`, "ok");
      await pantallaGuardias(hoja);
    } catch (e) {
      errorDe(e);
      btnGuardar.disabled = false; marcarPendiente();
    }
  }

  // ---------------------------------------------------------- importación

  async function importarHoras() {
    // El legajo es lo único que une la planilla del jefe con la base. Se
    // resuelve contra la dotación ya cargada en pantalla, así que un legajo
    // que no existe se rechaza en la vista previa y no llega a la base.
    const porLegajo = new Map(gente.map(b => [String(b.legajo).trim(), b]));
    const vistos = new Set();

    const n = await importarPlanilla({
      titulo: `Importar horas de ${estado.periodo ? "este mes" : "guardia"}`,
      bajada:
        "Una fila por bombero con las horas del mes. Se pisan las que ya " +
        "estén cargadas: reimportar corrige, no suma.",
      columnas: [
        { clave: "legajo", requerida: true, alias: ["nro legajo", "n legajo"],
          ayuda: "tiene que coincidir con el de la app" },
        { clave: "horas", requerida: true, alias: ["hs", "horas de guardia", "total"],
          ayuda: "del mes entero. Admite 12,5 y 12.5" }
      ],

      validar: (f, { numero }) => {
        const legajo = f.legajo.trim();
        const b = porLegajo.get(legajo);
        if (!b) return { ok: false, motivo: `no hay ningún bombero con legajo ${legajo}` };
        if (!b.evaluable)
          return { ok: false, motivo: `${b.nombre} no se evalúa: no lleva horas` };
        if (vistos.has(b.id))
          return { ok: false, motivo: `el legajo ${legajo} aparece dos veces` };

        const horas = numero(f.horas);
        if (horas === null) return { ok: false, motivo: `«${f.horas}» no es un número` };
        // El mismo tope que la base, para que el error se vea en la vista
        // previa y no como un rechazo críptico de Postgres al confirmar.
        if (horas < 0 || horas > 744)
          return { ok: false, motivo: `${horas} h está fuera de rango (0 a 744)` };

        vistos.add(b.id);
        return { ok: true, valor: { legajo, nombre: b.nombre, horas, bombero_id: b.id } };
      },

      aplicar: async (validos, informar) => {
        informar(0, validos.length);
        await guardarGuardias(periodo.id,
          validos.map(v => ({ bombero_id: v.bombero_id, horas: v.horas })));
        informar(validos.length, validos.length);
      }
    });

    if (n) { avisar(`${n} fila(s) importadas`, "ok"); pantallaGuardias(hoja); }
  }

  // ---------------------------------------------------------------- tabla

  const cuerpo = el("tbody");

  gente.forEach((b, i) => {
    const original = horas[b.id] ?? 0;

    // El total de la fila sigue a lo que se tipea, sin esperar al guardado:
    // la barra es la única señal de cuánto falta para la meta, y si no se
    // moviera hasta guardar, mentiría justo mientras se está cargando.
    const celdaBarra = el("td", { style: "width:150px" });
    function pintarBarra(v) {
      limpiar(celdaBarra);
      if (meta) montar(celdaBarra, barra(100 * v / meta, v >= meta ? "#067647" : "#1849a9"));
    }

    const inp = el("input", {
      // max en 744 (31 × 24) y no en 168: 168 era el tope de una semana y
      // con carga mensual rechazaría a quien hace muchas guardias.
      type: "number", class: "horas num", min: "0", max: "744", step: "0.25",
      value: original || "", disabled: cerrado,
      inputmode: "decimal",
      dataset: { bombero: b.id, i },
      onfocus: ev => ev.target.select(),
      oninput: ev => {
        const v = ev.target.value === "" ? 0 : Number(ev.target.value);
        if (v === original) { editados.delete(b.id); ev.target.classList.remove("editado"); }
        else { editados.set(b.id, v); ev.target.classList.add("editado"); }
        pintarBarra(v);
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
    pintarBarra(original);

    cuerpo.append(el("tr", {},
      el("td", { class: "legajo", text: b.legajo }),
      el("td", { "data-col": "Bombero" }, b.nombre),
      el("td", { class: "der" }, inp),
      celdaBarra
    ));
  });

  // ---------------------------------------------------------------- armado

  montar(limpiar(hoja),
    el("div", { class: "cabecera" },
      el("div", {},
        el("h1", { text: "Horas de guardia" }),
        el("p", { class: "bajada", text:
          "Las horas del mes, un número por bombero. Enter baja a la siguiente " +
          "fila. Si te equivocás, lo volvés a cargar y se corrige: no se suma." })
      ),
      el("div", { class: "acciones" },
        cerrado ? null : el("button", { class: "btn sec", onclick: importarHoras },
                            "Importar planilla"),
        btnGuardar)
    ),

    cerrado ? el("div", { class: "cerrado-aviso" },
      "Este mes está cerrado. Para modificarlo hay que reabrirlo desde Resultados.") : null,

    el("div", { class: "tarjeta" },
      el("div", { class: "scroll-tabla" },
        el("table", {},
          el("thead", {}, el("tr", {},
            el("th", { style: "width:70px" }, "Legajo"),
            el("th", {}, "Bombero"),
            el("th", { class: "der", style: "width:120px" }, "Horas del mes"),
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
