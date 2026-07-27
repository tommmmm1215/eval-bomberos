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

export const CATEGORIAS = [
  { k: "orden_interno",  label: "Orden interno",  ayuda: "Mantenimiento de instalaciones, equipos y móviles" },
  { k: "capacitacion",   label: "Capacitación",   ayuda: "Rendimiento y actitud en simulacros" },
  { k: "protocolar",     label: "Protocolar",     ayuda: "Uniforme, presentación y actos" },
  { k: "cursos",         label: "Cursos",         ayuda: "Aprobación de formación externa" },
  { k: "cambio_guardia", label: "Cambio de guardia", ayuda: "Puntualidad en el relevo y calidad del traspaso" },
  { k: "conducta",       label: "Conducta",       ayuda: "Disciplina, trato y criterio general" }
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

export const RANGOS = [
  "aspirante", "bombero", "cabo", "sargento", "oficial", "subjefe", "jefe"
];
