// Registro de salidas.
//
// Sólo se tildan los presentes. El resto de la dotación queda 'ausente'
// automáticamente, salvo quien tenga una novedad vigente ese día, que pasa
// a 'no_convocable' y por lo tanto no le cuenta en contra.
//
// Aparece TODA la dotación activa, no sólo los evaluables: el jefe y los
// administrativos salen igual, y la planilla contesta una pregunta
// operativa —quién fue— que no depende de a quién se le pone nota. A ellos
// nunca se les cuenta una ausencia; el contador de presentismo se calcula
// aparte, sólo sobre los evaluables.

import { dotacion, emergencias, registrarEmergencia, anularEmergencia,
         borrarEmergencia, actualizarEmergencia } from "../api.js";
import { el, montar, limpiar, avisar, errorDe, cargando, fechaHora, dialogo,
         confirmar, num, nombreMes } from "../ui.js";
import { TIPOS_EMERGENCIA } from "../config.js";
import { estado } from "../main.js";
import { importarPlanilla, normalizar } from "../importar.js";

export async function pantallaSalidas(hoja) {
  const periodo = estado.periodo;
  const cerrado = periodo.estado === "cerrado";

  montar(limpiar(hoja), cargando());

  let gente, lista;
  try {
    [gente, lista] = await Promise.all([
      dotacion(),                       // toda la dotación activa
      emergencias(periodo.id)
    ]);
  } catch (e) { errorDe(e); limpiar(hoja); return; }

  const porId = Object.fromEntries(gente.map(b => [b.id, b]));
  const esEvaluable = new Set(gente.filter(b => b.evaluable).map(b => b.id));
  const computables = lista.filter(e => e.computable);

  // ------------------------------------------------------------- alta

  // Sirve para el alta y para la corrección. Son el mismo formulario: hacer
  // dos habría dejado dos lugares donde arreglar cualquier cosa que cambie
  // de la carga de una salida.
  async function editorSalida(existente = null) {
    const edita = Boolean(existente);

    const selTipo = el("select");
    for (const t of TIPOS_EMERGENCIA)
      selTipo.append(el("option", {
        value: t.k, text: t.label, dataset: { peso: t.peso },
        selected: edita && t.k === existente.tipo
      }));

    const inpPeso = el("input", { type: "number", min: "0.25", max: "5", step: "0.25",
      value: edita ? Number(existente.peso) : TIPOS_EMERGENCIA[0].peso });

    // Al cambiar el tipo se trae su peso sugerido. En edición también: si el
    // jefe corrige el tipo, lo habitual es que el peso viejo ya no aplique.
    selTipo.onchange = () => { inpPeso.value = selTipo.selectedOptions[0].dataset.peso; };

    // Por defecto ahora, pero editable: lo normal es cargarla después.
    const local = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
    const inpFecha = el("input", { type: "datetime-local",
      value: local(edita ? new Date(existente.ocurrida_en) : new Date()) });
    const inpCodigo = el("input", { type: "text", placeholder: "opcional",
      value: edita ? (existente.codigo ?? "") : "" });

    // La salida pertenece al mes de su fecha, no al mes que esté abierto en
    // la barra. Como eso significa que tocar la fecha puede MUDARLA de mes,
    // hay que decirlo antes de guardar y no después: mover una salida sin
    // querer es exactamente el problema que este cambio viene a arreglar.
    const avisoMes = el("div", { style: "display:none" });

    function revisarMes() {
      const f = inpFecha.value ? new Date(inpFecha.value) : null;
      if (!f || isNaN(f)) { avisoMes.style.display = "none"; return; }

      const anio = f.getFullYear(), mes = f.getMonth() + 1;
      const destino = estado.periodos.find(p => p.anio === anio && p.mes === mes);
      const mismoMes = destino && (!edita || destino.id === existente.periodo_id);

      limpiar(avisoMes);
      avisoMes.style.display = "";

      if (!destino) {
        avisoMes.className = "nota error";
        montar(avisoMes, `No hay ningún mes abierto para ${nombreMes(mes)} ${anio}. ` +
          `Abrilo primero con «Nuevo mes» en la barra de arriba.`);
      } else if (destino.estado === "cerrado") {
        avisoMes.className = "nota error";
        montar(avisoMes, `${nombreMes(mes)} ${anio} está cerrado. ` +
          `Hay que reabrirlo desde Resultados para poder cargarle salidas.`);
      } else if (mismoMes) {
        avisoMes.style.display = "none";
      } else {
        avisoMes.className = "nota warn";
        montar(avisoMes, el("b", { text: "Cambia de mes. " }),
          `Esta salida va a quedar contada en ${nombreMes(mes)} ${anio}` +
          (edita ? ", y sale del mes donde está ahora." : "."));
      }
    }

    inpFecha.oninput = revisarMes;
    inpFecha.onchange = revisarMes;

    // En edición arranca con los que ya figuraban presentes.
    const seleccion = new Set(
      edita
        ? (existente.emergencia_asistencia ?? [])
            .filter(a => a.estado === "presente").map(a => a.bombero_id)
        : []);
    const contador = el("span", { class: "chip", text: `${seleccion.size} presentes` });

    const listaGente = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:5px" },
      gente.map(b => {
        const marcado = seleccion.has(b.id);
        const chk = el("input", { type: "checkbox", checked: marcado,
                                  style: "width:auto;margin-right:8px" });
        const lbl = el("label", {
          style: "display:flex;align-items:center;padding:6px 8px;border-radius:6px;" +
                 "cursor:pointer;font-size:14px;border:1px solid " +
                 (marcado ? "#067647" : "var(--borde)") +
                 (marcado ? ";background:#ecfdf3" : ""),
          onclick: ev => {
            if (ev.target !== chk) { ev.preventDefault(); chk.checked = !chk.checked; }
            chk.checked ? seleccion.add(b.id) : seleccion.delete(b.id);
            lbl.style.background = chk.checked ? "#ecfdf3" : "";
            lbl.style.borderColor = chk.checked ? "#067647" : "var(--borde)";
            contador.textContent = `${seleccion.size} presentes`;
          }
        }, chk, b.nombre,
           // Se los marca en vez de esconderlos: el jefe tiene que poder
           // tildarlos, pero también saber de un vistazo que tildarlos no
           // le mueve el presentismo a nadie.
           b.evaluable ? null : el("span", {
             class: "chip", style: "margin-left:auto", text: "no se evalúa" }));
        return lbl;
      })
    );

    revisarMes();

    const ok = await dialogo({
      titulo: edita ? "Corregir la salida" : "Registrar una salida",
      confirmar: edita ? "Guardar cambios" : "Registrar",
      cuerpo: el("div", {},
        el("div", { class: "fila" },
          el("label", { class: "campo" }, el("span", { text: "Tipo" }), selTipo),
          el("label", { class: "campo" }, el("span", { text: "Peso" }), inpPeso,
            el("small", { text: "Cuánto vale esta salida frente a una común (1.0)" }))
        ),
        el("div", { class: "fila" },
          el("label", { class: "campo" }, el("span", { text: "Fecha y hora" }), inpFecha,
            el("small", { text: "La salida se cuenta en el mes de esta fecha" })),
          el("label", { class: "campo" }, el("span", { text: "Código / parte" }), inpCodigo)
        ),
        avisoMes,
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
        const datos = {
          ocurridaEn: new Date(inpFecha.value).toISOString(),
          tipo: selTipo.value,
          peso: Number(inpPeso.value),
          codigo: inpCodigo.value.trim(),
          presentes: [...seleccion]
        };
        if (edita) await actualizarEmergencia(existente.id, datos);
        else       await registrarEmergencia(periodo.id, datos);
      }
    });

    if (ok) {
      avisar(edita ? "Salida corregida" : "Salida registrada", "ok");
      pantallaSalidas(hoja);
    }
  }

  const nuevaSalida = () => editorSalida(null);

  // ---------------------------------------------------------- importación

  async function importarSalidas() {
    const porLegajo = new Map(gente.map(b => [String(b.legajo).trim(), b]));

    // El mes del período acota qué fechas son aceptables. Una salida de marzo
    // cargada en el período de agosto no es un error de tipeo del que uno se
    // entere después: queda muda, porque las vistas filtran por período.
    const { anio, mes } = periodo;
    const desde = new Date(anio, mes - 1, 1);
    const hasta = new Date(anio, mes, 1);

    const n = await importarPlanilla({
      titulo: "Importar salidas desde una planilla",
      bajada:
        "Una fila por salida. Los presentes van en una sola celda, con los " +
        "legajos separados por coma. Las salidas se agregan: si la planilla " +
        "ya se importó, se duplican.",
      columnas: [
        { clave: "fecha", requerida: true, alias: ["fecha y hora", "cuando", "dia"],
          ayuda: `tiene que caer dentro del mes del período abierto` },
        { clave: "tipo", requerida: true, alias: ["tipo de emergencia", "emergencia"],
          ayuda: TIPOS_EMERGENCIA.map(t => t.label).join(" / ") },
        { clave: "presentes", requerida: true, alias: ["legajos", "asistieron", "quienes"],
          ayuda: "legajos separados por coma: 002, 005, 011" },
        { clave: "codigo", alias: ["parte", "nro parte", "codigo de parte"] },
        { clave: "peso", alias: ["ponderacion"], ayuda: "opcional: si falta, el del tipo" }
      ],

      validar: (f, { numero }) => {
        // Excel puede entregar una Date real o un texto tipeado a mano.
        let cuando = null;
        const bruto = f.fecha.trim();
        if (/^\d{4}-\d{2}-\d{2}T/.test(bruto)) cuando = new Date(bruto);
        else {
          // dd/mm/aaaa, con hora opcional. Se arma explícito y no con
          // new Date(texto): el parseo libre interpreta 03/08 como 3 de
          // agosto o como 8 de marzo según el idioma del sistema.
          const m = bruto.match(/^(\d{1,2})\D(\d{1,2})\D(\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/);
          if (m) {
            const [, d, mm, aa, hh = "0", mi = "0"] = m;
            const año = aa.length === 2 ? 2000 + Number(aa) : Number(aa);
            cuando = new Date(año, Number(mm) - 1, Number(d), Number(hh), Number(mi));
          }
        }
        if (!cuando || isNaN(cuando))
          return { ok: false, motivo: `no se entiende la fecha «${f.fecha}»` };
        if (cuando < desde || cuando >= hasta)
          return { ok: false, motivo:
            `${cuando.toLocaleDateString("es-AR")} cae fuera del mes que está abierto` };

        const buscado = normalizar(f.tipo);
        const tipo = TIPOS_EMERGENCIA.find(t =>
          normalizar(t.label) === buscado || normalizar(t.k) === buscado);
        if (!tipo) return { ok: false, motivo: `tipo desconocido: «${f.tipo}»` };

        const peso = f.peso.trim() ? numero(f.peso) : tipo.peso;
        if (peso === null || peso <= 0 || peso > 5)
          return { ok: false, motivo: `peso inválido: «${f.peso}»` };

        // Los legajos vienen en una celda. Se rechaza la fila entera si uno
        // solo no existe: importar una salida con la mitad de la gente es
        // peor que no importarla, porque el error queda invisible.
        const crudos = f.presentes.split(/[,;/]+/).map(s => s.trim()).filter(Boolean);
        if (!crudos.length) return { ok: false, motivo: "sin presentes" };

        const ids = [];
        const nombres = [];
        for (const c of crudos) {
          const b = porLegajo.get(c);
          if (!b) return { ok: false, motivo: `legajo ${c} inexistente` };
          if (ids.includes(b.id)) continue;         // repetido en la misma fila
          ids.push(b.id);
          nombres.push(b.nombre.split(",")[0]);
        }

        return {
          ok: true,
          valor: {
            fecha: cuando.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
            tipo: tipo.label,
            presentes: nombres,
            codigo: f.codigo.trim(),
            _payload: {
              ocurridaEn: cuando.toISOString(),
              tipo: tipo.k, peso, codigo: f.codigo.trim(), presentes: ids
            }
          }
        };
      },

      aplicar: async (validos, informar) => {
        let hechas = 0;
        for (const v of validos) {
          await registrarEmergencia(periodo.id, v._payload);
          informar(++hechas, validos.length);
        }
      }
    });

    if (n) { avisar(`${n} salida(s) importadas`, "ok"); pantallaSalidas(hoja); }
  }

  // ------------------------------------------------------------- tabla

  const filas = lista.map(e => {
    const asis = e.emergencia_asistencia ?? [];
    const presentes = asis.filter(a => a.estado === "presente");
    const etiqueta = TIPOS_EMERGENCIA.find(t => t.k === e.tipo)?.label ?? e.tipo;

    // El contador tiene que seguir leyéndose como presentismo, y el
    // presentismo se mide sólo sobre los evaluables. Si el jefe sale, suma
    // al numerador operativo pero no al denominador del cálculo, así que
    // el ratio se arma aparte: de lo contrario un "2 / 3" haría pensar que
    // hubo un ausente que no existe.
    const presentesEval  = presentes.filter(a => esEvaluable.has(a.bombero_id));
    const convocablesEval = asis.filter(a =>
      a.estado !== "no_convocable" && esEvaluable.has(a.bombero_id));
    const extras = presentes.length - presentesEval.length;

    return el("tr", { style: e.computable ? "" : "opacity:.45" },
      el("td", { class: "num", style: "white-space:nowrap", text: fechaHora(e.ocurrida_en) }),
      el("td", {}, etiqueta,
        e.codigo ? el("span", { class: "legajo", text: " · " + e.codigo }) : null,
        !e.computable ? el("span", { class: "chip rojo", style: "margin-left:6px" }, "no computa") : null),
      el("td", { class: "cen num", text: num(e.peso, 2) }),
      el("td", { class: "cen num",
                 title: extras
                   ? `${presentesEval.length} de ${convocablesEval.length} evaluables. ` +
                     `Salieron además ${extras} que no se evalúan.`
                   : "Presentes sobre convocables, entre los evaluables" },
        `${presentesEval.length} / ${convocablesEval.length}`,
        extras ? el("span", { class: "chip", style: "margin-left:6px", text: `+${extras}` }) : null),
      el("td", {}, el("div", { style: "font-size:13px;color:var(--suave)" },
        presentes.map(p => porId[p.bombero_id]?.nombre?.split(",")[0]).filter(Boolean).join(", ") || "—")),
      el("td", { class: "der", style: "white-space:nowrap" },
        // Editar va primero porque es la acción normal: corregir el tipo o la
        // fecha de una salida recién cargada es mucho más frecuente que
        // anularla, y muchísimo más que borrarla.
        cerrado ? null : el("button", {
          class: "btn sec chico",
          text: "Editar",
          title: "Corregir el tipo, la fecha, el peso o quiénes salieron",
          onclick: () => editorSalida(e)
        }),

        cerrado ? null : el("button", {
          class: "btn sec chico",
          style: "margin-left:6px",
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
        }),

        // Anular y borrar no son lo mismo, y por eso conviven.
        //
        // Anular deja la salida a la vista, tachada, diciendo "esto pasó pero
        // no cuenta": es la falsa alarma. Borrar es para la salida que nunca
        // existió —la prueba, el duplicado, el dedazo—, donde dejar rastro no
        // documenta nada, sólo ensucia la planilla del mes.
        cerrado ? null : el("button", {
          class: "btn sec chico peligro",
          style: "margin-left:6px",
          text: "Borrar",
          title: "Elimina la salida y su asistencia. No se puede deshacer.",
          onclick: async () => {
            const quienes = presentes.length
              ? `Figuran ${presentes.length} presente(s).`
              : "No tiene presentes cargados.";
            const ok = await confirmar(
              "Borrar la salida",
              `${etiqueta} del ${fechaHora(e.ocurrida_en)}. ${quienes} ` +
              `Se borra junto con la asistencia de todos y no se puede deshacer. ` +
              `Si la salida existió pero no querés que compute, usá Anular.`,
              { confirmar: "Borrar" }
            );
            if (!ok) return;
            try {
              await borrarEmergencia(e.id);
              avisar("Salida borrada", "ok");
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
        cerrado ? null : el("button", { class: "btn sec", onclick: importarSalidas },
                            "Importar planilla"),
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
