// Dotación: alta y baja de bomberos, retratos y novedades.
//
// Las novedades (licencias, comisiones) no son un trámite administrativo:
// son lo que evita que una licencia médica se lea como bajo rendimiento.
// Descuentan días de la meta de horas y sacan al bombero del denominador
// de las salidas que ocurrieron mientras no estaba.

import {
  dotacion, guardarBombero, subirFoto, urlFoto,
  novedades, guardarNovedad, borrarNovedad
} from "../api.js";
import {
  el, montar, limpiar, avisar, errorDe, cargando, dialogo, confirmar,
  avatar, fecha
} from "../ui.js";
import { RANGOS, TIPOS_NOVEDAD } from "../config.js";

export async function pantallaDotacion(hoja) {
  montar(limpiar(hoja), cargando());

  let gente;
  try { gente = await dotacion({ soloActivos: false }); }
  catch (e) { errorDe(e); limpiar(hoja); return; }

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
      selRango.append(el("option", { value: r, selected: r === b.rango, text: r }));

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
    if (ok) { avisar("Guardado", "ok"); pantallaDotacion(hoja); }
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
        pantallaDotacion(hoja);
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
          `Legajo ${b.legajo} · ${b.rango}${b.dni ? " · DNI " + b.dni : ""}`),
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
        el("h1", { text: "Dotación" }),
        el("p", { class: "bajada", text:
          `${activos.length} activos${bajas.length ? ` · ${bajas.length} de baja` : ""}. ` +
          `Clic en la foto para cambiarla.` })
      ),
      el("div", { class: "acciones" },
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
