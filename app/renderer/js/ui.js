// Helpers de interfaz. Nada de framework: crear nodos, avisar, confirmar.

import { MESES, BANDAS } from "./config.js";
import { urlFoto } from "./api.js";

export function el(tag, props = {}, ...hijos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "text") n.textContent = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") n.value = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  montar(n, hijos);
  return n;
}

// Node.append() convierte null en el TEXTO "null" y lo inserta en el DOM.
// Con el patrón `condicion ? el(...) : null` —que se usa en todas las
// pantallas para avisos opcionales— eso imprimía la palabra «null» en
// pantalla cada vez que la condición era falsa.
//
// Toda composición de nodos pasa por acá. Nunca se llama a .append() nativo
// con algo que pueda ser null.
export function montar(padre, ...hijos) {
  for (const h of hijos.flat(Infinity)) {
    if (h === null || h === undefined || h === false || h === "") continue;
    padre.append(h.nodeType ? h : document.createTextNode(String(h)));
  }
  return padre;
}

export function limpiar(nodo) { while (nodo.firstChild) nodo.removeChild(nodo.firstChild); return nodo; }

let avisoActual = null;
export function avisar(mensaje, tipo = "") {
  if (avisoActual) avisoActual.remove();
  const n = el("div", { class: `aviso-flotante ${tipo}`, text: mensaje });
  document.body.append(n);
  avisoActual = n;
  setTimeout(() => { if (n.isConnected) n.remove(); }, tipo === "error" ? 6000 : 2800);
}

export function errorDe(e) {
  console.error(e);
  avisar(e?.message || "Ocurrió un error inesperado.", "error");
}

// Diálogo genérico. `campos` arma el cuerpo; devuelve true si se confirmó.
export function dialogo({ titulo, cuerpo, confirmar = "Guardar", peligro = false, alConfirmar }) {
  return new Promise(resolve => {
    const d = el("dialog");
    const cont = el("div", { class: "cuerpo" }, cuerpo);
    const btnOk = el("button", {
      class: `btn ${peligro ? "peligro" : ""}`, type: "button", text: confirmar
    });
    const btnNo = el("button", { class: "btn sec", type: "button", text: "Cancelar" });

    btnNo.onclick = () => { d.close(); resolve(false); };
    btnOk.onclick = async () => {
      btnOk.disabled = true;
      try {
        const ok = alConfirmar ? await alConfirmar() : true;
        if (ok !== false) { d.close(); resolve(true); }
      } catch (e) { errorDe(e); }
      finally { btnOk.disabled = false; }
    };

    d.append(
      el("header", {}, titulo),
      cont,
      el("footer", {}, btnNo, btnOk)
    );
    d.addEventListener("cancel", () => resolve(false));
    document.body.append(d);
    d.addEventListener("close", () => d.remove());
    d.showModal();
    const primero = cont.querySelector("input, select, textarea");
    if (primero) setTimeout(() => primero.focus(), 40);
  });
}

export function confirmar(titulo, texto, { confirmar: txt = "Confirmar", peligro = true } = {}) {
  return dialogo({
    titulo,
    cuerpo: el("p", { text: texto, style: "font-size:14px;line-height:1.55" }),
    confirmar: txt, peligro
  });
}

// --------------------------------------------------------------- formato

export const nombreMes = m => MESES[m - 1];
export const tituloPeriodo = p => p ? `${nombreMes(p.mes)} ${p.anio}` : "—";

export function num(v, dec = 2) {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
export function pct(v) { return v === null || v === undefined ? "—" : num(v, 1) + "%"; }

export function fechaHora(iso) {
  return new Date(iso).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit"
  });
}
export function fecha(iso) {
  return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("es-AR",
    { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function chipBanda(banda) {
  const b = BANDAS[banda] ?? { label: banda ?? "—", color: "#6d675d" };
  return el("span", { class: "banda", style: `background:${b.color}`, text: b.label });
}

export function iniciales(nombre) {
  const limpio = nombre.replace(/\(.*?\)/g, "").trim();
  const [ape, nom] = limpio.split(",").map(s => s.trim());
  return ((ape?.[0] ?? "") + (nom?.[0] ?? "")).toUpperCase() || "?";
}

// Avatar que arranca con las iniciales y se reemplaza por la foto cuando llega.
//
// El tamaño va como parámetro y no como estilo puesto desde afuera: el nodo se
// reemplaza cuando llega la foto, así que cualquier estilo inline aplicado al
// placeholder se perdía y la foto volvía al tamaño por defecto de la clase.
export function avatar(bombero, tam = 30) {
  const estilo = `width:${tam}px;height:${tam}px;font-size:${Math.round(tam * 0.36)}px`;
  const n = el("div", {
    class: "avatar", style: estilo,
    text: iniciales(bombero.nombre), title: bombero.nombre
  });
  if (bombero.foto_path) {
    urlFoto(bombero.foto_path).then(url => {
      if (!url || !n.isConnected) return;
      n.replaceWith(el("img", {
        class: "avatar", style: estilo,
        src: url, alt: bombero.nombre, title: bombero.nombre
      }));
    }).catch(() => {});
  }
  return n;
}

export function celdaPersona(bombero) {
  return el("div", { class: "persona" }, avatar(bombero), el("span", { text: bombero.nombre }));
}

export function barra(valor, color = "#1849a9") {
  const pctv = Math.max(0, Math.min(100, Number(valor) || 0));
  return el("div", { class: "barra-mini" },
    el("i", { style: `width:${pctv}%;background:${color}` }));
}

export function vacio(texto, accion) {
  return el("div", { class: "vacio" }, el("p", { text: texto }), accion);
}

export function cargando(texto = "Cargando…") {
  return el("div", { class: "cargando", text: texto });
}

// (Acá vivía semanaDelMes(). Se fue con la carga semanal de guardias: las
// horas se cargan por mes y ya no hay nada que ubicar en una semana.)
