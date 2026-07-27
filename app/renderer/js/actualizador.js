// Aviso de actualización en la interfaz.
//
// El proceso principal descarga la versión nueva en segundo plano y avisa acá
// en qué estado va. La app no se interrumpe en ningún momento: si no hay nada
// sin guardar se reinicia sola, y si lo hay, espera a que el jefe decida.

import { el, montar, limpiar } from "./ui.js";

// La interfaz marca acá cuando hay trabajo pendiente de guardar. El proceso
// principal lo consulta antes de reiniciar por su cuenta.
let sinGuardar = false;

export function marcarCambiosSinGuardar(hay) {
  if (hay === sinGuardar) return;
  sinGuardar = hay;
  window.actualizador?.avisarCambiosSinGuardar(hay);
}

// Evita perder la carga a medio hacer si se cierra la ventana con el aspa.
window.addEventListener("beforeunload", ev => {
  if (!sinGuardar) return;
  ev.preventDefault();
  ev.returnValue = "";
});

let barra = null;

function contenedor() {
  if (barra && barra.isConnected) return barra;
  barra = el("div", { id: "barra-update" });
  document.body.append(barra);
  return barra;
}

function ocultar() {
  if (barra?.isConnected) barra.remove();
  barra = null;
}

function pintar({ tono = "info", texto, progreso = null, acciones = [] }) {
  const c = limpiar(contenedor());
  c.className = `barra-update ${tono}`;
  montar(c,
    progreso !== null
      ? el("div", { class: "barra-update-pista" },
          el("i", { style: `width:${progreso}%` }))
      : null,
    el("span", { class: "barra-update-texto", text: texto }),
    acciones.map(a => el("button", {
      class: a.principal ? "btn chico" : "btn sec chico",
      text: a.label, onclick: a.onclick
    }))
  );
}

export function iniciarActualizador() {
  // En desarrollo (`npm start`) el puente no existe: no hay nada que hacer.
  if (!window.actualizador) return;

  window.actualizador.alCambiar(estado => {
    switch (estado.fase) {
      case "buscando":
        // Silencioso: nadie necesita saber que se está fijando.
        break;

      case "al-dia":
        // Sólo se muestra si lo pidió a mano desde el menú.
        break;

      case "descargando":
        pintar({
          tono: "info",
          texto: estado.progreso
            ? `Descargando la versión ${estado.version ?? "nueva"}… ${estado.progreso}%`
            : `Hay una versión nueva. Descargando en segundo plano…`,
          progreso: estado.progreso ?? 0
        });
        break;

      case "lista-reiniciando":
        pintar({
          tono: "ok",
          texto: `Versión ${estado.version} lista. Reiniciando…`,
          acciones: [{
            label: "Ahora no", onclick: ocultar
          }]
        });
        break;

      case "lista-esperando":
        pintar({
          tono: "ok",
          texto: `Versión ${estado.version} lista para instalar. ` +
                 `Tenés cambios sin guardar: guardalos y reiniciá cuando quieras.`,
          acciones: [
            { label: "Reiniciar ahora", principal: true,
              onclick: () => window.actualizador.instalarAhora() },
            { label: "Más tarde", onclick: ocultar }
          ]
        });
        break;

      case "error":
        // Quedarse sin internet no es un problema que deba interrumpir a
        // nadie: la app funciona igual contra Supabase cuando vuelva.
        console.warn("Actualizador:", estado.mensaje);
        break;
    }
  });
}

export function buscarActualizaciones() {
  window.actualizador?.buscar();
}
