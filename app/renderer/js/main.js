// Arranque, login y ruteo entre pantallas.

import { sesion, cargarSesion, entrar, salir, periodos, abrirPeriodo } from "./api.js";
import { el, montar, limpiar, avisar, errorDe, tituloPeriodo, nombreMes } from "./ui.js";
import { MESES, VERSION, ANIO_MINIMO } from "./config.js";
import { iniciarActualizador } from "./actualizador.js";

import { pantallaGuardias }   from "./pantallas/guardias.js";
import { pantallaSalidas }    from "./pantallas/salidas.js";
import { pantallaEvaluacion } from "./pantallas/evaluacion.js";
import { pantallaRanking }    from "./pantallas/ranking.js";
import { pantallaDotacion }   from "./pantallas/dotacion.js";
import { pantallaConfiguracion } from "./pantallas/configuracion.js";

const app = document.getElementById("app");

// La versión que se muestra arriba sale del ejecutable, no de config.js.
//
// Antes estaba escrita en dos lugares —package.json y config.js— y tenían que
// coincidir a mano. Cuando no coincidían, la barra mentía: decía 1.0.2 sobre
// una app que por dentro era 1.0.3, que es exactamente el dato que uno mira
// para saber si la actualización entró. Ahora config.js queda sólo como
// respaldo para `npm start`, donde no hay ejecutable del que preguntar.
let versionApp = VERSION;

export const estado = {
  periodos: [],
  periodo: null,          // período seleccionado
  pantalla: "guardias"
};

const PANTALLAS = {
  guardias:      { label: "Guardias",      render: pantallaGuardias },
  salidas:       { label: "Salidas",       render: pantallaSalidas },
  evaluacion:    { label: "Evaluación",    render: pantallaEvaluacion },
  ranking:       { label: "Resultados",    render: pantallaRanking },
  dotacion:      { label: "Dotación",      render: pantallaDotacion },
  configuracion: { label: "Configuración", render: pantallaConfiguracion }
};

// ------------------------------------------------------------------ login

function vistaLogin(mensaje) {
  const email = el("input", { type: "email", required: true, autocomplete: "username", placeholder: "nombre@correo.com" });
  const pass  = el("input", { type: "password", required: true, autocomplete: "current-password", placeholder: "••••••••" });
  const btn   = el("button", { class: "btn", type: "submit", style: "width:100%;justify-content:center" }, "Entrar");
  const err   = el("div", { class: "nota error", style: "display:none" });

  if (mensaje) { err.textContent = mensaje; err.style.display = ""; }

  const form = el("form", { onsubmit: async ev => {
    ev.preventDefault();
    err.style.display = "none";
    btn.disabled = true; btn.textContent = "Entrando…";
    try {
      await entrar(email.value.trim(), pass.value);
      await iniciar();
    } catch (e) {
      err.textContent = e.message; err.style.display = "";
      btn.disabled = false; btn.textContent = "Entrar";
      pass.select();
    }
  }},
    el("label", { class: "campo" }, el("span", { text: "Correo" }), email),
    el("label", { class: "campo" }, el("span", { text: "Contraseña" }), pass),
    err, btn
  );

  montar(limpiar(app), 
    el("div", { class: "login-fondo" },
      el("div", { class: "login-caja" },
        el("div", { class: "marca-grande" },
          el("svg", { html: '<use href="#ico-casco"/>', style: "color:#b42318" }),
          el("h1", { text: "Evaluación de Personal" }),
          el("p", { text: "Bomberos Voluntarios de Espartillar" })
        ),
        form
      )
    )
  );
  setTimeout(() => email.focus(), 60);
}

// ------------------------------------------------------------------ shell

function vistaApp() {
  const nav = el("nav", { class: "nav" },
    Object.entries(PANTALLAS).map(([k, p]) =>
      el("button", {
        class: k === estado.pantalla ? "activo" : "",
        text: p.label,
        onclick: () => { estado.pantalla = k; vistaApp(); }
      })
    )
  );

  const selPeriodo = el("select", { class: "periodo-sel", onchange: ev => {
    estado.periodo = estado.periodos.find(p => p.id === ev.target.value) ?? null;
    vistaApp();
  }});
  for (const p of estado.periodos) {
    selPeriodo.append(el("option", {
      value: p.id,
      selected: estado.periodo?.id === p.id,
      text: `${nombreMes(p.mes)} ${p.anio}${p.estado === "cerrado" ? " · cerrado" : ""}`
    }));
  }
  if (!estado.periodos.length) selPeriodo.append(el("option", { text: "sin períodos" }));

  const contenido = el("main");

  montar(limpiar(app), 
    el("header", { class: "topbar" },
      el("div", { class: "marca" },
        el("svg", { class: "casco", html: '<use href="#ico-casco"/>' }),
        el("div", {},
          el("div", { text: "Evaluación de Personal" }),
          el("small", {}, sesion.bombero?.cuartel?.nombre ?? "",
            el("span", { class: "version", text: "v" + versionApp }))
        )
      ),
      nav,
      el("div", { class: "der" },
        selPeriodo,
        el("button", { class: "btn sec chico", text: "Nuevo mes", onclick: nuevoPeriodo }),
        el("span", { class: "quien" }, el("b", { text: sesion.bombero?.nombre ?? "" })),
        el("button", { class: "btn sec chico", text: "Salir", onclick: async () => {
          await salir(); vistaLogin();
        }})
      )
    ),
    contenido
  );

  const hoja = el("div", { class: "hoja" });
  contenido.append(hoja);

  if (!estado.periodo) {
    hoja.append(
      el("div", { class: "vacio" },
        el("p", { text: "Todavía no hay ningún mes abierto." }),
        el("button", { class: "btn", text: "Abrir el primer mes", onclick: nuevoPeriodo })
      )
    );
    return;
  }

  PANTALLAS[estado.pantalla].render(hoja);
}

// -------------------------------------------------------------- período nuevo

async function nuevoPeriodo() {
  const hoy = new Date();

  // Rango amplio y en orden descendente: el mes en curso queda arriba, pero
  // se puede bajar a cualquier año para cargar historia vieja. La base acepta
  // cualquier período; antes el selector era el único que lo impedía.
  const selAnio = el("select");
  for (let a = hoy.getFullYear() + 1; a >= ANIO_MINIMO; a--)
    selAnio.append(el("option", { value: a, selected: a === hoy.getFullYear(), text: a }));

  const selMes = el("select");
  MESES.forEach((m, i) =>
    selMes.append(el("option", { value: i + 1, selected: i === hoy.getMonth(), text: m })));

  // Aviso cuando el mes elegido no es el actual: cargar historia es legítimo,
  // pero equivocarse de año y no notarlo, no.
  const avisoRetro = el("p", { class: "nota warn", style: "display:none" });
  function revisarRetro() {
    const a = Number(selAnio.value), m = Number(selMes.value);
    const esActual = a === hoy.getFullYear() && m === hoy.getMonth() + 1;
    const futuro = a > hoy.getFullYear() || (a === hoy.getFullYear() && m > hoy.getMonth() + 1);
    if (esActual) { avisoRetro.style.display = "none"; return; }
    avisoRetro.style.display = "";
    avisoRetro.textContent = futuro
      ? `Estás por abrir un mes que todavía no empezó (${MESES[m - 1]} ${a}).`
      : `Carga histórica: vas a abrir ${MESES[m - 1]} de ${a}, un mes ya pasado. ` +
        `Sirve para completar información vieja.`;
  }
  selAnio.onchange = revisarRetro;
  selMes.onchange = revisarRetro;

  const { dialogo } = await import("./ui.js");
  const ok = await dialogo({
    titulo: "Abrir un mes nuevo",
    confirmar: "Abrir",
    cuerpo: el("div", {},
      el("p", { class: "nota info", text:
        "Al abrir el mes, las seis notas de cada bombero quedan precargadas en 7 " +
        "(cumple el estándar). Después sólo hay que editar los desvíos." }),
      el("div", { class: "fila" },
        el("label", { class: "campo" }, el("span", { text: "Mes" }), selMes),
        el("label", { class: "campo" }, el("span", { text: "Año" }), selAnio)
      ),
      avisoRetro
    ),
    alConfirmar: async () => {
      await abrirPeriodo(Number(selAnio.value), Number(selMes.value));
    }
  });

  if (ok) {
    const anio = Number(selAnio.value), mes = Number(selMes.value);
    await refrescarPeriodos();
    estado.periodo = estado.periodos.find(p => p.anio === anio && p.mes === mes) ?? estado.periodo;
    avisar(`Mes de ${nombreMes(mes)} listo`, "ok");
    vistaApp();
  }
}

export async function refrescarPeriodos() {
  estado.periodos = await periodos();
  if (!estado.periodo || !estado.periodos.some(p => p.id === estado.periodo.id))
    estado.periodo = estado.periodos[0] ?? null;
  else
    estado.periodo = estado.periodos.find(p => p.id === estado.periodo.id);
}

export function repintar() { vistaApp(); }

// ----------------------------------------------------------------- arranque

async function iniciar() {
  iniciarActualizador();

  // Se resuelve antes de pintar nada: si llegara después, la barra ya estaría
  // dibujada con el valor de respaldo y no se repintaría hasta el próximo
  // cambio de pantalla.
  versionApp = await window.actualizador?.version().catch(() => VERSION) ?? VERSION;

  montar(limpiar(app), el("div", { class: "cargando", text: "Cargando…" }));
  try {
    const s = await cargarSesion();
    if (!s) { vistaLogin(); return; }
    await refrescarPeriodos();
    vistaApp();
  } catch (e) {
    await salir().catch(() => {});
    vistaLogin(e.message);
  }
}

window.addEventListener("DOMContentLoaded", iniciar);
if (document.readyState !== "loading") iniciar();
