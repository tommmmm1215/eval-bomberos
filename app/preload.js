// Puente entre el proceso principal y la interfaz.
//
// El renderer corre con contextIsolation y sandbox activados: no tiene acceso
// a Node ni a Electron. Este archivo expone una superficie mínima y explícita
// —cuatro eventos de actualización y dos acciones— en lugar de abrir el
// proceso entero. Es la diferencia entre una app con datos personales que se
// puede auditar y una que hay que confiar.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("actualizador", {
  // El main avisa en qué estado está la actualización.
  alCambiar(callback) {
    const handler = (_ev, estado) => callback(estado);
    ipcRenderer.on("actualizacion:estado", handler);
    return () => ipcRenderer.removeListener("actualizacion:estado", handler);
  },

  // Reinicia y aplica la versión ya descargada.
  instalarAhora() {
    ipcRenderer.send("actualizacion:instalar");
  },

  // Busca actualizaciones a pedido (botón "Buscar actualización" en
  // Configuración). Devuelve el resultado —incluido el error— en lugar de
  // limitarse a disparar el chequeo: el botón sirve justamente para ver qué
  // está pasando cuando la actualización automática no aparece.
  buscar() {
    return ipcRenderer.invoke("actualizacion:buscar");
  },

  // La interfaz informa si hay trabajo sin guardar. El main lo usa para
  // decidir si puede reiniciar solo o tiene que preguntar.
  avisarCambiosSinGuardar(hay) {
    ipcRenderer.send("actualizacion:cambios-sin-guardar", !!hay);
  },

  version: () => ipcRenderer.invoke("app:version")
});
