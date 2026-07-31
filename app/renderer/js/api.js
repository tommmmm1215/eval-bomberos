// Capa de datos. Todo lo que habla con Supabase pasa por acá; las pantallas
// no arman queries. Si mañana cambia una RPC, se toca un solo archivo.

import { SUPABASE_URL, SUPABASE_KEY, BUCKET_FOTOS } from "./config.js";

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// Contexto de la sesión: quién soy y a qué cuartel pertenezco.
export const sesion = { user: null, bombero: null, cuartelId: null, config: null };

function fallar(error, contexto) {
  if (!error) return;
  console.error(contexto, error);
  const e = new Error(traducir(error, contexto));
  e.original = error;
  throw e;
}

// Los errores crudos de Postgres no le dicen nada a un jefe de cuartel.
function traducir(error, contexto) {
  const m = error.message || "";
  if (error.code === "42501" || m.includes("No autorizado"))
    return "No tenés permiso para esta operación.";
  if (error.code === "55006" || m.includes("cerrado"))
    return "El período está cerrado. Hay que reabrirlo para modificarlo.";
  if (m.includes("extremos_justificados"))
    return "Una nota de conducta fuera del rango 5–8 necesita un comentario de al menos 15 caracteres.";
  if (m.includes("pesos_completos") || m.includes("deben sumar 100"))
    return "Los pesos de la configuración tienen que sumar 100.";
  if (m.includes("dni_formato"))
    return "El DNI tiene que ser de 7 u 8 dígitos, sin puntos.";
  if (m.includes("duplicate key") && m.includes("legajo"))
    return "Ya existe un bombero con ese legajo.";
  if (m.includes("duplicate key") && m.includes("dni"))
    return "Ya existe un bombero con ese DNI.";
  if (m.includes("Failed to fetch") || m.includes("NetworkError"))
    return "Sin conexión con el servidor. Revisá internet e intentá de nuevo.";
  return `${contexto}: ${m}`;
}

// ---------------------------------------------------------------- sesión

export async function entrar(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if ((error.message || "").includes("Invalid login"))
      throw new Error("Email o contraseña incorrectos.");
    fallar(error, "Iniciar sesión");
  }
  return data.user;
}

export async function salir() {
  await sb.auth.signOut();
  sesion.user = null; sesion.bombero = null; sesion.cuartelId = null; sesion.config = null;
}

export async function cargarSesion() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  sesion.user = session.user;

  const { data, error } = await sb
    .from("bombero")
    .select("id, legajo, nombre, rango, cuartel_id, cuartel:cuartel_id (id, nombre, localidad)")
    .eq("user_id", session.user.id)
    .maybeSingle();
  fallar(error, "Cargar perfil");

  if (!data) {
    // Cuenta creada pero sin fila en `bombero`: el RLS le va a negar todo.
    throw new Error(
      "Tu usuario no está vinculado a ningún legajo del cuartel. " +
      "Hay que completar el user_id en la tabla bombero."
    );
  }

  sesion.bombero = data;
  sesion.cuartelId = data.cuartel_id;
  sesion.config = await configVigente();
  return sesion;
}

async function configVigente() {
  const { data, error } = await sb
    .from("config_evaluacion")
    .select("*")
    .eq("cuartel_id", sesion.cuartelId)
    .lte("vigente_desde", new Date().toISOString().slice(0, 10))
    .order("vigente_desde", { ascending: false })
    .limit(1)
    .maybeSingle();
  fallar(error, "Cargar configuración");
  return data;
}

// ---------------------------------------------------------------- dotación

export async function dotacion({ soloActivos = true, soloEvaluables = false } = {}) {
  let q = sb.from("bombero")
    .select("id, legajo, nombre, dni, rango, activo, evaluable, foto_path, fecha_alta")
    .eq("cuartel_id", sesion.cuartelId)
    .order("legajo");
  if (soloActivos) q = q.eq("activo", true);
  if (soloEvaluables) q = q.eq("evaluable", true);
  const { data, error } = await q;
  fallar(error, "Cargar dotación");
  return data ?? [];
}

// Alta o actualización masiva desde una planilla.
//
// La clave es el legajo, no el id: quien arma la planilla en Excel no conoce
// los UUID y no tiene por qué. `unique (cuartel_id, legajo)` es lo que
// convierte a esto en un upsert real —volver a importar la misma planilla
// corrige, no duplica— y es la razón por la que reimportar es seguro.
//
// Se manda todo en una sola llamada: 18 filas son 18 viajes si se hace en un
// bucle, y con la conexión del cuartel eso se nota.
export async function importarBomberos(filas) {
  const { error } = await sb.from("bombero")
    .upsert(filas.map(b => ({
      cuartel_id: sesion.cuartelId,
      legajo: b.legajo,
      nombre: b.nombre,
      dni: b.dni || null,
      rango: b.rango,
      activo: b.activo,
      evaluable: b.evaluable
    })), { onConflict: "cuartel_id,legajo" });
  fallar(error, "Importar personal");
}

export async function guardarBombero(b) {
  const fila = {
    cuartel_id: sesion.cuartelId,
    legajo: b.legajo, nombre: b.nombre, dni: b.dni || null,
    rango: b.rango, activo: b.activo, evaluable: b.evaluable
  };
  const q = b.id
    ? sb.from("bombero").update(fila).eq("id", b.id)
    : sb.from("bombero").insert(fila);
  const { error } = await q;
  fallar(error, "Guardar bombero");
}

export async function subirFoto(bomberoId, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${bomberoId}.${ext}`;
  const { error: e1 } = await sb.storage
    .from(BUCKET_FOTOS)
    .upload(path, file, { upsert: true, contentType: file.type });
  fallar(e1, "Subir foto");
  const { error: e2 } = await sb.from("bombero").update({ foto_path: path }).eq("id", bomberoId);
  fallar(e2, "Vincular foto");
  return path;
}

// El bucket es privado: la foto se sirve con una URL firmada de corta vida.
const cacheFotos = new Map();
export async function urlFoto(path) {
  if (!path) return null;
  const cacheado = cacheFotos.get(path);
  if (cacheado && cacheado.vence > Date.now()) return cacheado.url;

  const { data, error } = await sb.storage.from(BUCKET_FOTOS).createSignedUrl(path, 3600);
  if (error) { console.warn("Foto no disponible", path, error); return null; }
  cacheFotos.set(path, { url: data.signedUrl, vence: Date.now() + 3000 * 1000 });
  return data.signedUrl;
}

// ---------------------------------------------------------------- períodos

export async function periodos() {
  const { data, error } = await sb.from("periodo")
    .select("id, anio, mes, estado, cerrado_en")
    .eq("cuartel_id", sesion.cuartelId)
    .order("anio", { ascending: false }).order("mes", { ascending: false });
  fallar(error, "Cargar períodos");
  return data ?? [];
}

export async function abrirPeriodo(anio, mes) {
  const { data, error } = await sb.rpc("abrir_periodo", {
    p_cuartel: sesion.cuartelId, p_anio: anio, p_mes: mes
  });
  fallar(error, "Abrir período");
  return data;
}

export async function cerrarPeriodo(periodoId) {
  const { data, error } = await sb.rpc("cerrar_periodo", { p_periodo: periodoId });
  fallar(error, "Cerrar período");
  return data;
}

export async function reabrirPeriodo(periodoId, motivo) {
  const { error } = await sb.rpc("reabrir_periodo", { p_periodo: periodoId, p_motivo: motivo });
  fallar(error, "Reabrir período");
}

// ---------------------------------------------------------------- guardias

// Horas del mes, una fila por bombero. Antes esto se cargaba por semana,
// pero la semana nunca entró en el cálculo —la vista suma el período entero
// y la meta se prorratea por días, no por semanas—, así que sólo obligaba a
// elegir una antes de poder tipear.
export async function guardiasDelMes(periodoId) {
  const { data, error } = await sb.from("registro_guardia")
    .select("bombero_id, horas")
    .eq("periodo_id", periodoId);
  fallar(error, "Cargar horas");
  return Object.fromEntries((data ?? []).map(r => [r.bombero_id, Number(r.horas)]));
}

export async function totalesGuardia(periodoId) {
  const { data, error } = await sb.from("registro_guardia")
    .select("bombero_id, horas")
    .eq("periodo_id", periodoId);
  fallar(error, "Cargar totales");
  const acc = {};
  for (const r of data ?? []) acc[r.bombero_id] = (acc[r.bombero_id] ?? 0) + Number(r.horas);
  return acc;
}

// Idempotente: reenviar el mes corrige el valor, no lo acumula. Es lo que
// permite volver sobre una fila mal tipeada sin borrar nada primero.
export async function guardarGuardias(periodoId, registros) {
  const { data, error } = await sb.rpc("upsert_guardias_mes", {
    p_periodo: periodoId, p_registros: registros
  });
  fallar(error, "Guardar horas");
  return data;
}

// ---------------------------------------------------------------- salidas

export async function emergencias(periodoId) {
  const { data, error } = await sb.from("emergencia")
    // periodo_id se trae aunque se esté filtrando por él: el editor lo usa
    // para saber si la fecha que se está tipeando muda la salida de mes.
    .select("id, periodo_id, ocurrida_en, tipo, codigo, peso, computable, " +
            "emergencia_asistencia(bombero_id, estado)")
    .eq("periodo_id", periodoId)
    .order("ocurrida_en", { ascending: false });
  fallar(error, "Cargar salidas");
  return data ?? [];
}

export async function registrarEmergencia(periodoId, { ocurridaEn, tipo, peso, codigo, presentes }) {
  const { data, error } = await sb.rpc("registrar_emergencia", {
    p_periodo: periodoId,
    p_ocurrida_en: ocurridaEn,
    p_tipo: tipo,
    p_presentes: presentes,
    p_peso: peso,
    p_codigo: codigo || null,
    p_no_convocables: []
  });
  fallar(error, "Registrar salida");
  return data;
}

// Corrige una salida ya cargada. Reemplaza la asistencia entera, así que se
// mandan todos los presentes, no sólo los que cambiaron.
export async function actualizarEmergencia(id, { ocurridaEn, tipo, peso, codigo, presentes }) {
  const { error } = await sb.rpc("actualizar_emergencia", {
    p_emergencia: id,
    p_ocurrida_en: ocurridaEn,
    p_tipo: tipo,
    p_presentes: presentes,
    p_peso: peso,
    p_codigo: codigo || null,
    p_no_convocables: []
  });
  fallar(error, "Editar salida");
}

export async function anularEmergencia(id, computable) {
  const { error } = await sb.from("emergencia").update({ computable }).eq("id", id);
  fallar(error, "Actualizar salida");
}

// Borra la salida de verdad. Es distinto de anular: anular deja constancia de
// que la salida ocurrió pero no computa —una falsa alarma, por ejemplo—;
// borrar es para la que nunca existió, la cargada por error.
//
// La asistencia se va sola: emergencia_asistencia tiene ON DELETE CASCADE.
// Y el trigger t_guard_emergencia lo rechaza si el período está cerrado, así
// que un mes ya cerrado no se puede tocar ni por acá.
export async function borrarEmergencia(id) {
  const { error } = await sb.from("emergencia").delete().eq("id", id);
  fallar(error, "Borrar salida");
}

// ---------------------------------------------------------------- evaluación

export async function evaluaciones(periodoId) {
  const { data, error } = await sb.from("evaluacion_mensual")
    .select("*").eq("periodo_id", periodoId);
  fallar(error, "Cargar evaluaciones");
  return Object.fromEntries((data ?? []).map(e => [e.bombero_id, e]));
}

export async function guardarEvaluacion(periodoId, bomberoId, campos) {
  const { error } = await sb.from("evaluacion_mensual")
    .update({ ...campos, evaluador_id: sesion.user.id })
    .eq("periodo_id", periodoId).eq("bombero_id", bomberoId);
  fallar(error, "Guardar evaluación");
}

// ---------------------------------------------------------------- resultados

export async function puntajes(periodoId) {
  const { data, error } = await sb.from("v_puntaje_consolidado")
    .select("*").eq("periodo_id", periodoId);
  fallar(error, "Cargar puntajes");
  return data ?? [];
}

export async function detalleGuardias(periodoId) {
  const { data, error } = await sb.from("v_puntaje_mensual")
    .select("bombero_id, horas, meta_ajustada, excedente, salidas_presente, salidas_convocable")
    .eq("periodo_id", periodoId);
  fallar(error, "Cargar detalle");
  return Object.fromEntries((data ?? []).map(r => [r.bombero_id, r]));
}

// ---------------------------------------------------------------- novedades

export async function novedades(bomberoId) {
  const { data, error } = await sb.from("novedad_personal")
    .select("*").eq("bombero_id", bomberoId).order("desde", { ascending: false });
  fallar(error, "Cargar novedades");
  return data ?? [];
}

export async function guardarNovedad(n) {
  const { error } = await sb.from("novedad_personal").insert({
    bombero_id: n.bombero_id, desde: n.desde, hasta: n.hasta,
    tipo: n.tipo, afecta_meta: n.afecta_meta, detalle: n.detalle || null
  });
  fallar(error, "Guardar novedad");
}

export async function borrarNovedad(id) {
  const { error } = await sb.from("novedad_personal").delete().eq("id", id);
  fallar(error, "Borrar novedad");
}

// ---------------------------------------------------------------- sanciones

// --- Lecturas de varios meses, para el informe -------------------------
//
// Van por `.in()` y no en un bucle: seis meses × cuatro consultas serían 24
// viajes, y sobre la conexión del cuartel eso es la diferencia entre un
// informe que sale y uno que el jefe cancela a la mitad.

export async function puntajesDeVarios(periodoIds) {
  if (!periodoIds.length) return [];
  const { data, error } = await sb.from("v_puntaje_consolidado")
    .select("*").in("periodo_id", periodoIds);
  fallar(error, "Cargar puntajes del informe");
  return data ?? [];
}

export async function evaluacionesDeVarios(periodoIds) {
  if (!periodoIds.length) return [];
  const { data, error } = await sb.from("evaluacion_mensual")
    .select("*").in("periodo_id", periodoIds);
  fallar(error, "Cargar evaluaciones del informe");
  return data ?? [];
}

export async function detalleDeVarios(periodoIds) {
  if (!periodoIds.length) return [];
  const { data, error } = await sb.from("v_puntaje_mensual")
    .select("periodo_id, bombero_id, horas, meta_ajustada, salidas_presente, salidas_convocable")
    .in("periodo_id", periodoIds);
  fallar(error, "Cargar detalle del informe");
  return data ?? [];
}

export async function penalizacionesDeVarios(periodoIds) {
  if (!periodoIds.length) return [];
  const { data, error } = await sb.from("penalizacion")
    .select("*").in("periodo_id", periodoIds);
  fallar(error, "Cargar sanciones del informe");
  return data ?? [];
}

export async function penalizaciones(periodoId) {
  const { data, error } = await sb.from("penalizacion")
    .select("*").eq("periodo_id", periodoId);
  fallar(error, "Cargar sanciones");
  return data ?? [];
}

export async function guardarPenalizacion(periodoId, bomberoId, { tipo, puntos, motivo }) {
  const { error } = await sb.from("penalizacion").insert({
    periodo_id: periodoId, bombero_id: bomberoId,
    tipo, puntos, motivo, aplicada_por: sesion.user.id
  });
  fallar(error, "Guardar sanción");
}

export async function borrarPenalizacion(id) {
  const { error } = await sb.from("penalizacion").delete().eq("id", id);
  fallar(error, "Borrar sanción");
}
