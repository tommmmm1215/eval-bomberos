// Proceso principal de Electron.
//
// Dos responsabilidades: servir la interfaz y mantener la app actualizada.
//
// El renderer se sirve por un esquema propio `app://` en lugar de file://.
// No es capricho: los módulos ES están bloqueados por CORS sobre file://, y
// localStorage —donde supabase-js guarda la sesión— no persiste de forma
// confiable. Registrar el esquema como privilegiado resuelve las dos cosas
// sin tener que desactivar webSecurity.

const { app, BrowserWindow, protocol, net, shell, Menu, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const url = require("node:url");

const RENDERER = path.join(__dirname, "renderer");

let ventana = null;
let hayCambiosSinGuardar = false;

protocol.registerSchemesAsPrivileged([{
  scheme: "app",
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

// ---------------------------------------------------------------- ventana

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#f5f3ef",
    title: "Evaluación de Personal — Bomberos de Espartillar",
    icon: path.join(__dirname, "build", "icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  ventana.once("ready-to-show", () => ventana.show());
  ventana.loadURL("app://local/index.html");

  // Cualquier enlace externo se abre en el navegador del sistema, nunca
  // dentro de la app.
  ventana.webContents.setWindowOpenHandler(({ url: destino }) => {
    if (/^https?:/.test(destino)) shell.openExternal(destino);
    return { action: "deny" };
  });

  ventana.on("closed", () => { ventana = null; });
  return ventana;
}

// ----------------------------------------------------------- actualización

function avisar(estado) {
  if (ventana && !ventana.isDestroyed()) {
    ventana.webContents.send("actualizacion:estado", estado);
  }
}

function configurarActualizador() {
  // Se descarga sola en segundo plano; el reinicio se decide aparte.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => avisar({ fase: "buscando" }));

  autoUpdater.on("update-not-available", info =>
    avisar({ fase: "al-dia", version: info?.version }));

  autoUpdater.on("update-available", info =>
    avisar({ fase: "descargando", version: info?.version, progreso: 0 }));

  autoUpdater.on("download-progress", p =>
    avisar({ fase: "descargando", progreso: Math.round(p.percent) }));

  autoUpdater.on("update-downloaded", info => {
    // El pedido original era reiniciar de forma transparente. Se cumple, pero
    // sólo cuando no hay nada sin guardar: reiniciar en medio de la carga
    // semanal le haría perder al jefe las 17 filas que venía tipeando. Si hay
    // trabajo pendiente, se le avisa y decide él.
    if (hayCambiosSinGuardar) {
      avisar({ fase: "lista-esperando", version: info?.version });
    } else {
      avisar({ fase: "lista-reiniciando", version: info?.version });
      setTimeout(() => instalar(), 2500);
    }
  });

  autoUpdater.on("error", err => {
    // Sin internet o sin releases publicados no es un error que deba
    // interrumpir a nadie: la app funciona igual.
    avisar({ fase: "error", mensaje: String(err?.message ?? err) });
  });

  ipcMain.on("actualizacion:instalar", () => instalar());
  ipcMain.on("actualizacion:cambios-sin-guardar", (_ev, hay) => { hayCambiosSinGuardar = hay; });
  ipcMain.handle("app:version", () => app.getVersion());

  // Búsqueda a pedido, con resultado visible.
  //
  // El chequeo automático falla en silencio a propósito: un problema de red no
  // debería interrumpir a nadie. Pero eso deja sin forma de diagnosticar
  // cuando algo no anda, así que este handler devuelve el error tal cual, para
  // que la pantalla de Configuración lo muestre. Sin esto, "no me actualiza"
  // se responde adivinando.
  ipcMain.handle("actualizacion:buscar", async () => {
    const actual = app.getVersion();

    if (!app.isPackaged) {
      return { ok: false, actual, error: "En modo desarrollo el actualizador está desactivado." };
    }

    try {
      const r = await autoUpdater.checkForUpdates();
      if (!r || !r.updateInfo) {
        return { ok: true, hay: false, actual, mensaje: "No se obtuvo respuesta del servidor." };
      }
      return { ok: true, hay: r.updateInfo.version !== actual, version: r.updateInfo.version, actual };
    } catch (e) {
      return { ok: false, actual, error: String(e?.message ?? e) };
    }
  });
}

// quitAndInstall(silencioso, reabrirDespués)
//
// El primer parámetro es el que importa: en false relanza el asistente de
// instalación completo —carpeta de destino incluida—, como si fuera una
// instalación nueva, y el jefe se encuentra con un instalador que no pidió.
// En true corre el instalador con /S: reemplaza los archivos, no pregunta
// nada y vuelve a abrir la app. Que es lo que uno espera de una actualización.
function instalar() {
  autoUpdater.quitAndInstall(true, true);
}

// ------------------------------------------------------------------- menú

function menu() {
  return Menu.buildFromTemplate([
    { label: "Archivo", submenu: [{ role: "quit", label: "Salir" }] },
    {
      label: "Edición",
      submenu: [
        { role: "undo", label: "Deshacer" },
        { role: "redo", label: "Rehacer" },
        { type: "separator" },
        { role: "cut", label: "Cortar" },
        { role: "copy", label: "Copiar" },
        { role: "paste", label: "Pegar" },
        { role: "selectAll", label: "Seleccionar todo" }
      ]
    },
    {
      label: "Ver",
      submenu: [
        { role: "reload", label: "Recargar" },
        { role: "resetZoom", label: "Zoom normal" },
        { role: "zoomIn", label: "Acercar" },
        { role: "zoomOut", label: "Alejar" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Pantalla completa" },
        { role: "toggleDevTools", label: "Herramientas de desarrollo" }
      ]
    },
    {
      label: "Ayuda",
      submenu: [
        {
          label: "Buscar actualizaciones",
          click: () => autoUpdater.checkForUpdates()
            .catch(e => avisar({ fase: "error", mensaje: String(e?.message ?? e) }))
        },
        { type: "separator" },
        { label: `Versión ${app.getVersion()}`, enabled: false }
      ]
    }
  ]);
}

// --------------------------------------------------------------- arranque

// Una sola instancia: dos ventanas abiertas contra la misma base es pedir
// que se pisen los datos, y el actualizador no puede reemplazar archivos
// que otro proceso tiene abiertos.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); }
  });

  app.whenReady().then(() => {
    protocol.handle("app", (req) => {
      const { pathname } = new URL(req.url);
      // Normaliza y bloquea cualquier intento de salir de renderer/
      const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
      const destino = path.join(RENDERER, rel);
      if (!destino.startsWith(RENDERER)) {
        return new Response("Forbidden", { status: 403 });
      }
      return net.fetch(url.pathToFileURL(destino).toString());
    });

    Menu.setApplicationMenu(menu());
    configurarActualizador();
    crearVentana();

    // Se espera a que la ventana esté visible para no competir con la carga
    // inicial por el ancho de banda.
    if (app.isPackaged) {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => { /* sin conexión: se ignora */ });
      }, 4000);
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) crearVentana();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
