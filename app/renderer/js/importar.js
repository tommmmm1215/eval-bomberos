// Importación de planillas.
//
// Una sola regla gobierna todo este archivo: no se escribe nada hasta que el
// jefe vio exactamente qué va a pasar. Importar a ciegas sobre un padrón real
// es cómo se terminan con treinta y cuatro bomberos donde había diecisiete, y
// deshacer eso a mano lleva más tiempo del que la importación ahorró.
//
// Por eso el flujo es: leer → mapear → validar → MOSTRAR → recién ahí aplicar.
// El botón de confirmar dice cuántas filas van a entrar y cuántas se van a
// ignorar, y las que se ignoran se listan con el número de fila de la planilla
// y el motivo, para poder corregirlas en Excel y volver a intentar.

import { el, montar, limpiar, dialogo } from "./ui.js";

// ---------------------------------------------------------------- el lector
//
// SheetJS pesa 864 KB. Cargarlo en cada arranque para una función que se usa
// una vez por mes sería pagarlo siempre para usarlo casi nunca, así que se
// inyecta recién cuando alguien abre un importador. El CSP es `script-src
// 'self'`: por eso el archivo está en vendor/ y no en un CDN.

let promesaXLSX = null;

function cargarLector() {
  if (promesaXLSX) return promesaXLSX;
  promesaXLSX = new Promise((resolver, rechazar) => {
    if (window.XLSX) return resolver(window.XLSX);
    const s = document.createElement("script");
    s.src = "vendor/xlsx.full.min.js";
    s.onload = () => window.XLSX
      ? resolver(window.XLSX)
      : rechazar(new Error("El lector de planillas cargó pero no se registró."));
    s.onerror = () => {
      promesaXLSX = null;   // que un fallo de red no deje el módulo envenenado
      rechazar(new Error("No se pudo cargar el lector de planillas."));
    };
    document.head.append(s);
  });
  return promesaXLSX;
}

// ------------------------------------------------------------ normalización

// "Legajo ", "LEGAJO", "legajo" y "Nº Legajo" tienen que ser la misma columna.
// El jefe no va a escribir los encabezados exactos, y no tiene por qué.
export function normalizar(texto) {
  return String(texto ?? "")
    // NFD separa la letra de su tilde y el rango borra las tildes sueltas.
    // Escrito con \u y no con los caracteres literales: son invisibles en un
    // editor y el día que alguien "limpie espacios" se los lleva puestos.
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Excel devuelve números, fechas y texto mezclados. Todo lo que se compara o
// se guarda como texto pasa por acá.
function texto(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function numero(v) {
  if (v === null || v === undefined || v === "") return null;
  // "12,5" es lo que escribe cualquiera en Argentina; Number() lo rechaza.
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// --------------------------------------------------------------- la lectura

async function leerArchivo(archivo) {
  const XLSX = await cargarLector();
  const buffer = await archivo.arrayBuffer();

  // cellDates para que las fechas lleguen como Date y no como el número de
  // serie de Excel, que es la trampa clásica: 45678 en vez de una fecha.
  const libro = XLSX.read(buffer, { type: "array", cellDates: true });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  if (!hoja) throw new Error("La planilla no tiene ninguna hoja con datos.");

  // header:1 devuelve filas como arrays, no como objetos: hace falta el
  // control sobre los encabezados para poder mapearlos con tolerancia.
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, blankrows: false, defval: "" });
  if (!filas.length) throw new Error("La planilla está vacía.");

  return filas;
}

// Busca la fila de encabezados. Casi siempre es la primera, pero las planillas
// reales suelen traer un título arriba, o una fila en blanco, así que se
// recorren las primeras cinco y se elige la que más columnas conocidas tenga.
function ubicarEncabezado(filas, columnas) {
  const conocidas = new Set();
  for (const c of columnas) {
    conocidas.add(normalizar(c.clave));
    for (const a of c.alias ?? []) conocidas.add(normalizar(a));
  }

  let mejor = { indice: 0, aciertos: -1 };
  for (let i = 0; i < Math.min(5, filas.length); i++) {
    const aciertos = filas[i].filter(c => conocidas.has(normalizar(c))).length;
    if (aciertos > mejor.aciertos) mejor = { indice: i, aciertos };
  }
  return mejor;
}

// ------------------------------------------------------------- el importador

/**
 * @param titulo    Encabezado del diálogo.
 * @param bajada    Una línea explicando qué hace esta importación.
 * @param columnas  [{ clave, alias?, requerida?, ayuda? }]
 * @param validar   (fila, indice) => ({ok:true, valor} | {ok:false, motivo})
 * @param aplicar   (validos, informar) => Promise. `informar(n)` mueve la barra.
 */
export async function importarPlanilla({ titulo, bajada, columnas, validar, aplicar }) {
  const estado = { filas: null, validos: [], rechazados: [], nombreArchivo: "" };

  const zona = el("div", {
    style: "border:2px dashed var(--borde);border-radius:8px;padding:26px;" +
           "text-align:center;cursor:pointer;background:#fcfbf9"
  });
  const resultado = el("div");
  const entrada = el("input", {
    type: "file", accept: ".xlsx,.xls,.csv", style: "display:none"
  });

  let btnConfirmar = null;

  function pintarZona(mensaje) {
    limpiar(zona);
    montar(zona,
      el("div", { style: "font-size:14px;font-weight:600", text: mensaje }),
      el("div", { style: "font-size:13px;color:var(--suave);margin-top:4px",
                  text: "Arrastrá el archivo acá, o hacé clic para elegirlo. Excel o CSV." })
    );
  }
  pintarZona("Ninguna planilla elegida");

  zona.onclick = () => entrada.click();
  zona.ondragover = ev => { ev.preventDefault(); zona.style.borderColor = "var(--azul)"; };
  zona.ondragleave = () => { zona.style.borderColor = "var(--borde)"; };
  zona.ondrop = ev => {
    ev.preventDefault();
    zona.style.borderColor = "var(--borde)";
    if (ev.dataTransfer.files[0]) procesarArchivo(ev.dataTransfer.files[0]);
  };
  entrada.onchange = () => { if (entrada.files[0]) procesarArchivo(entrada.files[0]); };

  async function procesarArchivo(archivo) {
    estado.nombreArchivo = archivo.name;
    pintarZona(archivo.name);
    limpiar(resultado);
    montar(resultado, el("div", { class: "cargando", text: "Leyendo la planilla…" }));

    try {
      const crudas = await leerArchivo(archivo);
      const { indice, aciertos } = ubicarEncabezado(crudas, columnas);

      if (aciertos === 0) {
        limpiar(resultado);
        montar(resultado, el("div", { class: "nota error" },
          el("div", { text: "No se reconoció ninguna columna." }),
          el("div", { style: "margin-top:6px", text:
            "La primera fila de la planilla tiene que tener los nombres de las " +
            "columnas. Se encontró: " +
            (crudas[indice] ?? []).map(c => `«${texto(c)}»`).join(", ") })
        ));
        if (btnConfirmar) btnConfirmar.disabled = true;
        return;
      }

      // Mapa columna -> posición, resuelto por alias.
      const encabezados = crudas[indice].map(normalizar);
      const posicion = {};
      for (const c of columnas) {
        const candidatos = [c.clave, ...(c.alias ?? [])].map(normalizar);
        const i = encabezados.findIndex(h => candidatos.includes(h));
        if (i >= 0) posicion[c.clave] = i;
      }

      const faltan = columnas.filter(c => c.requerida && posicion[c.clave] === undefined);
      if (faltan.length) {
        limpiar(resultado);
        montar(resultado, el("div", { class: "nota error", text:
          `Faltan columnas obligatorias: ${faltan.map(c => c.clave).join(", ")}.` }));
        if (btnConfirmar) btnConfirmar.disabled = true;
        return;
      }

      // Se validan todas antes de tocar nada. El número de fila que se informa
      // es el de Excel —empezando en 1 y contando el encabezado—, para que
      // buscarla en la planilla sea directo.
      estado.validos = [];
      estado.rechazados = [];

      for (let i = indice + 1; i < crudas.length; i++) {
        const cruda = crudas[i];
        const fila = {};
        for (const c of columnas) {
          const p = posicion[c.clave];
          fila[c.clave] = p === undefined ? "" : texto(cruda[p]);
        }
        if (Object.values(fila).every(v => v === "")) continue;   // fila vacía

        const r = validar(fila, { numero, texto });
        if (r.ok) estado.validos.push({ ...r.valor, _fila: i + 1 });
        else estado.rechazados.push({ fila: i + 1, motivo: r.motivo });
      }

      pintarResultado();
    } catch (e) {
      limpiar(resultado);
      montar(resultado, el("div", { class: "nota error", text: e.message }));
      if (btnConfirmar) btnConfirmar.disabled = true;
    }
  }

  function pintarResultado() {
    limpiar(resultado);
    const { validos, rechazados } = estado;

    montar(resultado,
      el("div", { class: validos.length ? "nota ok" : "nota warn", style: "margin-top:14px" },
        el("div", { style: "font-weight:600", text:
          validos.length
            ? `${validos.length} fila(s) listas para importar`
            : "Ninguna fila utilizable" }),
        rechazados.length
          ? el("div", { style: "margin-top:4px", text:
              `${rechazados.length} se van a ignorar.` })
          : null
      ),

      rechazados.length
        ? el("details", { style: "margin-top:10px" },
            el("summary", { style: "cursor:pointer;font-size:13px",
                            text: `Ver las ${rechazados.length} que no entran` }),
            el("div", { class: "scroll-tabla", style: "max-height:150px;margin-top:8px" },
              el("table", {},
                el("thead", {}, el("tr", {},
                  el("th", { style: "width:70px" }, "Fila"), el("th", {}, "Motivo"))),
                el("tbody", {}, rechazados.slice(0, 50).map(r =>
                  el("tr", {},
                    el("td", { class: "num", text: r.fila }),
                    el("td", { style: "font-size:13px", text: r.motivo }))))))
          )
        : null,

      validos.length
        ? el("details", { style: "margin-top:10px", open: true },
            el("summary", { style: "cursor:pointer;font-size:13px",
                            text: "Vista previa de lo que se va a importar" }),
            el("div", { class: "scroll-tabla", style: "max-height:220px;margin-top:8px" },
              tablaPrevia(validos)))
        : null
    );

    if (btnConfirmar) {
      btnConfirmar.disabled = validos.length === 0;
      btnConfirmar.textContent = validos.length
        ? `Importar ${validos.length}` : "Importar";
    }
  }

  function tablaPrevia(validos) {
    const claves = Object.keys(validos[0]).filter(k => k !== "_fila");
    return el("table", {},
      el("thead", {}, el("tr", {},
        el("th", { style: "width:60px" }, "Fila"),
        claves.map(k => el("th", {}, k)))),
      el("tbody", {}, validos.slice(0, 40).map(v =>
        el("tr", {},
          el("td", { class: "num", text: v._fila }),
          claves.map(k => el("td", { style: "font-size:13px",
            text: Array.isArray(v[k]) ? v[k].join(", ") : texto(v[k]) })))))
    );
  }

  // ------------------------------------------------------------- el diálogo

  const progreso = el("div", { style: "display:none;margin-top:12px" });

  // dialogo() monta el <dialog> de forma sincrónica antes de devolver la
  // promesa, así que apenas se la llama el botón ya existe en el DOM. Se lo
  // toma de ahí porque el helper no lo expone, y hace falta para poder
  // deshabilitarlo mientras no haya nada válido que importar.
  const promesa = dialogo({
    titulo,
    confirmar: "Importar",
    cuerpo: el("div", {},
      el("p", { class: "nota info", text: bajada }),
      el("div", { style: "font-size:13px;color:var(--suave);margin-bottom:12px" },
        el("div", { style: "font-weight:600;margin-bottom:4px", text: "Columnas que se leen:" }),
        el("div", {}, columnas.map(c =>
          el("div", { style: "margin-top:2px" },
            el("b", { text: c.clave }),
            c.requerida ? el("span", { style: "color:var(--rojo)", text: " *" }) : null,
            c.ayuda ? el("span", { text: " — " + c.ayuda }) : null)))),
      zona, entrada, resultado, progreso
    ),
    alConfirmar: async () => {
      if (!estado.validos.length) return false;
      progreso.style.display = "";
      limpiar(progreso);
      const barra = el("div", { class: "barra-mini" }, el("i", { style: "width:0%" }));
      const texto2 = el("div", { style: "font-size:13px;margin-bottom:5px",
                                 text: "Importando…" });
      montar(progreso, texto2, barra);

      await aplicar(estado.validos, (hechas, total) => {
        const pct = Math.round(100 * hechas / total);
        barra.firstChild.style.width = pct + "%";
        barra.firstChild.style.background = "#067647";
        texto2.textContent = `Importando… ${hechas} de ${total}`;
      });
      return true;
    }
  });

  btnConfirmar = document.querySelector("dialog[open] footer button:last-child");
  if (btnConfirmar) btnConfirmar.disabled = true;

  const ok = await promesa;
  return ok ? estado.validos.length : 0;
}
