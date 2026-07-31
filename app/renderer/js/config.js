// Configuración del proyecto Supabase.
// La clave publicable es pública por diseño: no da acceso a nada por sí sola.
// Todo lo que se puede leer o escribir lo decide el RLS según quién inició
// sesión. Por eso puede vivir acá sin problema.

// Sólo respaldo para `npm start`, donde no hay ejecutable al que preguntarle
// la versión. En la app instalada, la que se muestra arriba y en Configuración
// sale de package.json a través del proceso principal, así que no hace falta
// mantener este número sincronizado a mano.
export const VERSION = "1.0.3 (dev)";

// Año más antiguo que ofrece el selector de períodos. La base acepta desde
// 2000; el límite acá es sólo para que la lista sea manejable.
export const ANIO_MINIMO = 2015;

export const SUPABASE_URL = "https://azyinwfguzohifjfiazw.supabase.co";
export const SUPABASE_KEY = "sb_publishable_2ZYjDwueddxGS2UFmUE3mw_BHLvs7Hb";

export const BUCKET_FOTOS = "fotos-bomberos";

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

// Las seis notas manuales.
//
// `k` es la columna en la base y NO se toca: renombrarla obligaría a una
// migración y a reescribir los `pesos` de config_evaluacion, que la usan como
// clave. Lo que se ve en pantalla es `label`, y `corto` es la versión para el
// encabezado de la tabla, donde no entra el nombre completo.
//
// Antes el corto salía de recortar el label con `.replace(" de guardia","")
// .replace("Cambio","Relevo")`. Funcionaba hasta que alguien cambiaba el
// label —justo lo que pasó— y el encabezado quedaba diciendo otra cosa.
export const CATEGORIAS = [
  { k: "orden_interno",  label: "Orden interno",       corto: "Orden",    ayuda: "Mantenimiento de instalaciones, equipos y móviles" },
  { k: "capacitacion",   label: "Capacitación",        corto: "Capacit.", ayuda: "Rendimiento y actitud en simulacros" },
  { k: "protocolar",     label: "Protocolar",          corto: "Protoc.",  ayuda: "Uniforme, presentación y actos" },
  { k: "cursos",         label: "Cursos",              corto: "Cursos",   ayuda: "Aprobación de formación externa" },
  { k: "cambio_guardia", label: "Puntuación del jefe", corto: "P. Jefe",  ayuda: "Valoración general del jefe de cuartel" },
  { k: "conducta",       label: "Conducta",            corto: "Conducta", ayuda: "Disciplina, trato y criterio general" }
];

export const TIPOS_EMERGENCIA = [
  { k: "incendio_estructural", label: "Incendio estructural", peso: 2.5 },
  { k: "incendio_forestal",    label: "Incendio forestal",    peso: 2.0 },
  { k: "incendio_vehicular",   label: "Incendio vehicular",   peso: 1.8 },
  { k: "accidente_vehicular",  label: "Accidente vehicular",  peso: 2.0 },
  { k: "rescate",              label: "Rescate",              peso: 2.0 },
  { k: "escape_gas",           label: "Escape de gas",        peso: 1.5 },
  { k: "asistencia",           label: "Asistencia / varios",  peso: 1.0 },
  { k: "falsa_alarma",         label: "Falsa alarma",         peso: 1.0 }
];

export const BANDAS = {
  destacado:       { label: "Destacado",       color: "#067647" },
  muy_bueno:       { label: "Muy bueno",       color: "#3f7d20" },
  satisfactorio:   { label: "Satisfactorio",   color: "#8a6d1f" },
  requiere_mejora: { label: "Requiere mejora", color: "#b54708" },
  critico:         { label: "Crítico",         color: "#b42318" }
};

export const TIPOS_NOVEDAD = [
  { k: "licencia_medica",    label: "Licencia médica" },
  { k: "licencia_ordinaria", label: "Licencia ordinaria" },
  { k: "comision",           label: "Comisión" },
  { k: "franco_especial",    label: "Franco especial" },
  { k: "suspension",         label: "Suspensión" },
  { k: "otro",               label: "Otro" }
];

// El escalafón, de menor a mayor. La clave va a la base y la etiqueta a la
// pantalla: antes era una sola lista de strings que se imprimía cruda, lo que
// funcionaba mientras todos los rangos fueran de una palabra y dejaba de
// funcionar con "suboficial subalterno".
//
// El orden es el jerárquico y se respeta en el selector: una lista alfabética
// obligaría a leerla entera para encontrar el que sigue.
export const RANGOS = [
  { k: "aspirante",             label: "Aspirante" },
  { k: "bombero",               label: "Bombero" },
  { k: "suboficial_subalterno", label: "Suboficial subalterno" },
  { k: "suboficial_superior",   label: "Suboficial superior" },
  { k: "oficial",               label: "Oficial" },
  { k: "segundo_jefe",          label: "Segundo jefe" },
  { k: "jefe",                  label: "Jefe" }
];

export const RANGO_LABEL = Object.fromEntries(RANGOS.map(r => [r.k, r.label]));
