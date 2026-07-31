// Personal: alta y baja de bomberos, retratos y novedades.
//
// Las novedades (licencias, comisiones) no son un trámite administrativo:
// son lo que evita que una licencia médica se lea como bajo rendimiento.
// Descuentan días de la meta de horas y sacan al bombero del denominador
// de las salidas que ocurrieron mientras no estaba.

import {
  dotacion, guardarBombero, subirFoto, urlFoto,
  novedades, guardarNovedad, borrarNovedad, importarBomberos
} from "../api.js";
import {
  el, montar, limpiar, avisar, errorDe, cargando, dialogo, confirmar,
  avatar, fecha
} from "../ui.js";
import { RANGOS, RANGO_LABEL, TIPOS_NOVEDAD } from "../config.js";
import { importarPlanilla, normalizar } from "../importar.js";

export async function pantallaPersonal(hoja) {
  montar(limpiar(hoja), cargando());

  let gente;
  try { gente = await dotacion({ soloActivos: false }); }
  catch (e) { errorDe(e); limpiar(hoja); return; }

  // ---------------------------------------------------------- importación

  async function importarPadron() {
    const legajosEnArchivo = new Set();

    const n = await importarPlanilla({
      titulo: "Importar personal desde una planilla",
      bajada:
        "El legajo es la clave: si ya existe, se actualizan sus datos; si no, " +
        "se da de alta. Reimportar la misma planilla corrige, no duplica.",
      columnas: [
        { clave: "legajo", requerida: true, alias: ["nro legajo", "n legajo", "numero"],
          ayuda: "identifica a la persona, no se puede repetir" },
        { clave: "nombre", requerida: true, alias: ["apellido y nombre", "nombre y apellido"],
          ayuda: "se ordena mejor como APELLIDO, Nombre" },
        { clave: "dni", alias: ["documento", "d n i"] },
        { clave: "rango", alias: ["jerarquia", "grado"],
          ayuda: RANGOS.map(r => r.label).join(", ") + ". Vacío = bombero" },
        { clave: "evaluable", alias: ["se evalua", "evalua"],
          ayuda: "no / false / 0 para jefatura y administrativos. Vacío = sí" },
        { clave: "activo", alias: ["alta", "de baja"],
          ayuda: "no / false / 0 para los dados de baja. Vacío = sí" }
      ],

      validar: (f) => {
        const legajo = f.legajo.trim();
        if (!legajo) return { ok: false, motivo: "sin legajo" };
        if (legajosEnArchivo.has(legajo))
          return { ok: false, motivo: `el legajo ${legajo} está repetido en la planilla` };

        const nombre = f.nombre.trim();
        if (!nombre) return { ok: false, motivo: "sin nombre" };

        // El rango llega escrito a mano: "Oficial", "SEGUNDO JEFE",
        // "suboficial superior ". Se acepta tanto la etiqueta como la clave.
        let rango = "bombero";
        if (f.rango.trim()) {
          const buscado = normalizar(f.rango);
          const hallado = RANGOS.find(r =>
            normalizar(r.label) === buscado || normalizar(r.k) === buscado);
          if (!hallado) return { ok: false, motivo: `rango desconocido: «${f.rango}»` };
          rango = hallado.k;
        }

        // El DNI se guarda como texto pero tiene que parecer un DNI: si viene
        // una fecha o un nombre en esa columna, es que la planilla está
        // corrida, y conviene enterarse ahora y no dentro de seis meses.
        const dni = f.dni.replace(/[.\s]/g, "");
        if (dni && !/^\d{7,9}$/.test(dni))
          return { ok: false, motivo: `el DNI «${f.dni}» no parece un documento` };

        legajosEnArchivo.add(legajo);
        return {
          ok: true,
          valor: {
            legajo, nombre, dni,
            rango,
            evaluable: siONo(f.evaluable),
            activo: siONo(f.activo)
          }
        };
      },

      aplicar: async (validos, informar) => {
        informar(0, validos.length);
        await importarBomberos(validos);
        informar(validos.length, validos.length);
      }
    });

    if (n) { avisar(`${n} persona(s) importadas`, "ok"); pantallaPersonal(hoja); }
  }

  // "no", "NO", "false", "0" y "n" son no. Vacío es sí, porque la planilla
  // típica sólo marca las excepciones y deja el resto en blanco.
  function siONo(v) {
    const t = normalizar(v);
    return !["no", "false", "0", "n", "baja"].includes(t);
  }

  // ------------------------------------------------------------- ficha

  async function editar(b) {
    const nuevo = !b;
    b ??= { legajo: "", nombre: "", dni: "", rango: "bombero", activo: true, evaluable: true };

    const inpLegajo = el("input", { type: "text", value: b.legajo, placeholder: "018" });
    const inpNombre = el("input", { type: "text", value: b.nombre, placeholder: "APELLIDO, Nombre" });
    const inpDni    = el("input", { type: "text", value: b.dni ?? "", placeholder: "30123456",
                                    inputmode: "numeric" });
    const selRango  = el("select");
    for (const r of RANGOS)
      selRango.append(el("option", { value: r.k, selected: r.k === b.rango, text: r.label }));

    const chkActivo = el("input", { type: "checkbox", checked: b.activo, style: "width:auto" });
    const chkEval   = el("input", { type: "checkbox", checked: b.evaluable, style: "width:auto" });

    const ok = await dialogo({
      titulo: nuevo ? "Alta de bombero" : b.nombre,
      cuerpo: el("div", {},
        el("div", { class: "fila" },
          el("label", { class: "campo" }, el("span", { text: "Legajo" }), inpLegajo),
          el("label", { class: "campo" }, el("span", { text: "DNI" }), inpDni,
            el("small", { text: "7 u 8 dígitos, sin puntos" }))),
        el("label", { class: "campo" }, el("span", { text: "Nombre" }), inpNombre,
          el("small", { text: "Se ordena por apellido: conviene «APELLIDO, Nombre»" })),
        el("label", { class: "campo" }, el("span", { text: "Rango" }), selRango),
        el("label", { class: "campo", style: "display:flex;gap:8px;align-items:center" },
          chkActivo, el("span", { style: "margin:0", text: "Activo en la dotación" })),
        el("label", { class: "campo", style: "display:flex;gap:8px;align-items:flex-start" },
          chkEval, el("div", {},
            el("span", { style: "margin:0", text: "Entra en el ranking" }),
            el("small", { text: "Destildado para jefatura, administrativos y honorarios: " +
                                "integran la dotación pero no se evalúan." })))
      ),
      alConfirmar: async () => {
        if (!inpLegajo.value.trim() || !inpNombre.value.trim()) {
          avisar("Legajo y nombre son obligatorios", "error"); return false;
        }
        await guardarBombero({
          id: b.id,
          legajo: inpLegajo.value.trim(),
          nombre: inpNombre.value.trim(),
          dni: inpDni.value.replace(/\D/g, "") || null,
          rango: selRango.value,
          activo: chkActivo.checked,
          evaluable: chkEval.checked
        });
      }
    });
    if (ok) { avisar("Guardado", "ok"); pantallaPersonal(hoja); }
  }

  // -------------------------------------------------------------- foto

  function cambiarFoto(b) {
    const inp = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp",
                              style: "display:none" });
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { avisar("La foto no puede pasar de 5 MB", "error"); return; }
      try {
        avisar("Subiendo…");
        await subirFoto(b.id, f);
        avisar("Foto actualizada", "ok");
        pantallaPersonal(hoja);
      } catch (e) { errorDe(e); }
      finally { inp.remove(); }
    };
    document.body.append(inp);
    inp.click();
  }

  // ---------------------------------------------------------- novedades

  async function verNovedades(b) {
    let lista;
    try { lista = await novedades(b.id); } catch (e) { return errorDe(e); }

    const hoy = new Date().toISOString().slice(0, 10);
    const inpDesde = el("input", { type: "date", value: hoy });
    const inpHasta = el("input", { type: "date", value: hoy });
    const selTipo  = el("select");
    for (const t of TIPOS_NOVEDAD) selTipo.append(el("option", { value: t.k, text: t.label }));
    const chkAfecta = el("input", { type: "checkbox", checked: true, style: "width:auto" });
    const inpDetalle = el("input", { type: "text", placeholder: "opcional" });

    // Una suspensión no debería aliviar la meta: por eso el tilde es editable.
    selTipo.onchange = () => { chkAfecta.checked = selTipo.value !== "suspension"; };

    const listado = el("div", {}, lista.length
      ? lista.map(n => el("div", {
          style: "display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--linea)"
        },
          el("div", { style: "flex:1;font-size:13.5px" },
            el("b", { text: TIPOS_NOVEDAD.find(t => t.k === n.tipo)?.label ?? n.tipo }),
            el("div", { style: "color:var(--suave)" },
              `${fecha(n.desde)} → ${fecha(n.hasta)}${n.detalle ? " · " + n.detalle : ""}`)),
          n.afecta_meta ? el("span", { class: "chip verde", text: "descuenta meta" })
                        : el("span", { class: "chip", text: "no descuenta" }),
          el("button", { class: "btn sec chico", text: "Borrar", onclick: async ev => {
            try { await borrarNovedad(n.id); ev.target.closest("div").remove(); avisar("Borrada", "ok"); }
            catch (e) { errorDe(e); }
          }})
        ))
      : el("p", { style: "color:var(--suave);font-size:13.5px" }, "Sin novedades registradas."));

    const ok = await dialogo({
      titulo: `Novedades — ${b.nombre}`,
      confirmar: "Agregar novedad",
      cuerpo: el("div", {},
        el("p", { class: "nota info", text:
          "Los días de novedad se descuentan de la meta de horas y sacan al bombero " +
          "del denominador de las salidas de esos días. Es lo que evita que una " +
          "licencia médica se lea como bajo rendimiento." }),
        listado,
        el("div", { style: "margin-top:16px" },
          el("label", { class: "campo" }, el("span", { text: "Tipo" }), selTipo),
          el("div", { class: "fila" },
            el("label", { class: "campo" }, el("span", { text: "Desde" }), inpDesde),
            el("label", { class: "campo" }, el("span", { text: "Hasta" }), inpHasta)),
          el("label", { class: "campo" }, el("span", { text: "Detalle" }), inpDetalle),
          el("label", { class: "campo", style: "display:flex;gap:8px;align-items:center" },
            chkAfecta, el("span", { style: "margin:0", text: "Descuenta días de la meta" })))
      ),
      alConfirmar: async () => {
        if (inpHasta.value < inpDesde.value) {
          avisar("La fecha de fin no puede ser anterior al inicio", "error"); return false;
        }
        await guardarNovedad({
          bombero_id: b.id, desde: inpDesde.value, hasta: inpHasta.value,
          tipo: selTipo.value, afecta_meta: chkAfecta.checked, detalle: inpDetalle.value.trim()
        });
      }
    });
    if (ok) avisar("Novedad registrada", "ok");
  }

  // ------------------------------------------------------------ armado

  const activos = gente.filter(b => b.activo);
  const bajas   = gente.filter(b => !b.activo);
  const sinFoto = activos.filter(b => !b.foto_path).length;

  function tarjetaPersona(b) {
    const av = avatar(b, 56);

    return el("div", {
      class: "tarjeta", style: "padding:14px;display:flex;gap:13px;align-items:flex-start" +
                               (b.activo ? "" : ";opacity:.55")
    },
      el("div", { style: "cursor:pointer", title: "Cambiar foto", onclick: () => cambiarFoto(b) }, av),
      el("div", { style: "flex:1;min-width:0" },
        el("div", { style: "font-weight:600;font-size:14.5px", text: b.nombre }),
        el("div", { style: "font-size:12.5px;color:var(--suave)" },
          `Legajo ${b.legajo} · ${RANGO_LABEL[b.rango] ?? b.rango}${b.dni ? " · DNI " + b.dni : ""}`),
        el("div", { style: "margin-top:7px;display:flex;gap:5px;flex-wrap:wrap" },
          !b.evaluable ? el("span", { class: "chip", text: "no se evalúa" }) : null,
          !b.activo    ? el("span", { class: "chip rojo", text: "baja" }) : null,
          !b.foto_path ? el("span", { class: "chip", text: "sin foto" }) : null),
        el("div", { style: "margin-top:9px;display:flex;gap:5px" },
          el("button", { class: "btn sec chico", text: "Editar", onclick: () => editar(b) }),
          el("button", { class: "btn sec chico", text: "Novedades", onclick: () => verNovedades(b) }))
      )
    );
  }

  montar(limpiar(hoja), 
    el("div", { class: "cabecera" },
      el("div", {},
        el("h1", { text: "Personal" }),
        el("p", { class: "bajada", text:
          `${activos.length} activos${bajas.length ? ` · ${bajas.length} de baja` : ""}. ` +
          `Clic en la foto para cambiarla.` })
      ),
      el("div", { class: "acciones" },
        el("button", { class: "btn sec", onclick: importarPadron }, "Importar planilla"),
        el("button", { class: "btn", onclick: () => editar(null) }, "Alta de bombero"))
    ),

    sinFoto ? el("div", { class: "nota info", text:
      `${sinFoto} bombero(s) sin retrato cargado. Las fotos se guardan en un bucket ` +
      `privado y se muestran con enlaces firmados de una hora: no quedan accesibles ` +
      `desde afuera.` }) : null,

    el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:13px" },
      activos.map(tarjetaPersona)),

    bajas.length ? el("div", {},
      el("h2", { style: "margin:26px 0 11px" }, "Bajas"),
      el("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:13px" },
        bajas.map(tarjetaPersona))) : null
  );
}
