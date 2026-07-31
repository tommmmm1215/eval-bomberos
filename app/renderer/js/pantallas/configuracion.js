// Configuración: versión instalada y actualizaciones.
//
// La app se actualiza sola, así que esta pantalla no es para operar nada: es
// para diagnosticar. Cuando el jefe llama y dice "no me anda", lo primero que
// hay que saber es qué versión está corriendo y si la máquina llega a GitHub.
// Sin un lugar donde ver eso, el soporte por teléfono es adivinar.
//
// Por eso el botón muestra el error crudo. El chequeo automático falla en
// silencio a propósito —un problema de red no debe interrumpir la carga
// semanal—, pero ese silencio es justamente lo que deja sin pistas.

import { el, montar, limpiar } from "../ui.js";
import { VERSION } from "../config.js";

export async function pantallaConfiguracion(hoja) {
  limpiar(hoja);

  // En desarrollo (`npm start`) el puente del preload no existe.
  const puente = window.actualizador ?? null;

  const versionReal = puente
    ? await puente.version().catch(() => VERSION)
    : VERSION;

  const resultado = el("div");

  const btn = el("button", {
    class: "btn",
    text: "Buscar actualización",
    onclick: async () => {
      btn.disabled = true;
      const previo = btn.textContent;
      btn.textContent = "Buscando…";
      limpiar(resultado);

      try {
        const r = await puente.buscar();

        if (!r) {
          nota(resultado, "warn", "No se obtuvo respuesta del actualizador.");
        } else if (!r.ok) {
          nota(resultado, "error",
            `No se pudo consultar: ${r.error}`,
            "Si dice 404, todavía no hay ninguna versión publicada en GitHub. " +
            "Si menciona la red o un timeout, la computadora no está llegando a internet.");
        } else if (r.hay) {
          nota(resultado, "ok",
            `Hay una versión nueva: ${r.version}. Se está descargando en segundo plano.`,
            "Cuando termine vas a ver el aviso abajo. No hace falta hacer nada más.");
        } else {
          nota(resultado, "info", `Ya tenés la última versión (${r.actual}).`);
        }
      } catch (e) {
        nota(resultado, "error", `Falló la consulta: ${e?.message ?? e}`);
      } finally {
        btn.disabled = false;
        btn.textContent = previo;
      }
    }
  });

  montar(hoja,
    el("div", { class: "cabecera" },
      el("div", {},
        el("h1", { text: "Configuración" }),
        el("p", { class: "bajada", text:
          "Versión instalada y estado de las actualizaciones." })
      )
    ),

    el("div", { class: "tarjeta" },
      el("header", {}, el("h2", { text: "Versión" })),
      el("div", { class: "cuerpo" },
        el("p", { style: "font-size:14px;margin:0 0 4px",
                  text: `Versión instalada: ${versionReal}` }),
        el("p", { style: "font-size:13px;color:var(--suave);margin:0" , text:
          "Es la que hay que decir cuando se reporta un problema: distingue " +
          "un error real de una copia vieja sin actualizar." })
      )
    ),

    el("div", { class: "tarjeta" },
      el("header", {}, el("h2", { text: "Actualizaciones" })),
      el("div", { class: "cuerpo" },
        el("p", { style: "font-size:14px;margin:0 0 14px", text:
          "La app busca versiones nuevas sola cada vez que se abre y las " +
          "instala sin interrumpir el trabajo. Este botón fuerza la búsqueda " +
          "ahora y muestra el resultado." }),

        puente
          ? montar(el("div"), btn, resultado)
          : nota(el("div"), "warn",
              "Estás corriendo la app en modo desarrollo.",
              "El actualizador solo funciona en la versión instalada.")
      )
    )
  );
}

function nota(destino, tono, texto, detalle) {
  return montar(destino,
    el("div", { class: `nota ${tono}`, style: "margin:14px 0 0" },
      el("div", { text: texto }),
      detalle ? el("div", { style: "margin-top:5px;opacity:.85", text: detalle }) : null
    )
  );
}
