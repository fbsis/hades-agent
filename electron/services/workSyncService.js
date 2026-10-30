const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  session,
  screen,
  shell,
  globalShortcut,
  ipcMain,
  dialog,
} = require("electron");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const state = require("./workspaceWindowState");
const store = require("../store/jsonStore");
const { createProvisioner } = require("./workspaceProvisioning");
const { protectWindow, bindContentProtection } = require("../windows/contentProtection");
const { createQuickMeeting, workspaceForEvent } = require("./quickMeeting");
const { randomUUID } = require("node:crypto");
const windows = new Map();
let tray;
let panel;
let initialized = false;
let lastKey;
const shortcuts = new Set();
const panelPath = path.resolve(__dirname, "../work/work-panel.html");
function config() {
  const raw = store.getSettings().workSync || {};
  return {
    baseURL: "https://work.home.fbsis.com",
    workspaces: [],
    windows: {},
    ...raw,
  };
}
function persist(change) {
  store.saveSettings({
    ...store.getSettings(),
    workSync: { ...config(), ...change },
  });
}
function publicConfig() {
  const cfg = config();
  return {
    ...cfg,
    workspaces: cfg.workspaces.map(({ token, ...w }) => w),
    connection: provisioner.snapshot(),
  };
}
async function request(apiPath, options = {}, workspace) {
  const cfg = config(),
    base = state.endpoint(cfg.baseURL);
  const connection = cfg.workspaces.find((w) => w.id === workspace);
  if (workspace !== undefined && workspace !== null && !connection?.token)
    throw new Error('O acesso desta empresa ainda não está preparado. Atualize a integração.');
  const response = await fetch(base + apiPath, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(connection ? { Authorization: "Bearer " + connection.token } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (text.length > 2_000_000) throw new Error("Resposta acima do limite");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("O servidor não retornou JSON. Confira a URL.");
  }
  if (!response.ok)
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : "Falha ao consultar o Metis",
    );
  return body.data;
}
const provisioner = createProvisioner({ getConfig: config, persist, request });
const quickMeeting = createQuickMeeting({
  getSettings: () => store.getSettings(), getSessions: () => store.getInterviewSessions(),
  show: () => require("../windows/windowManager").showCommandPanel("transcription"),
  notify: pending => require("../windows/windowManager").get("command")?.webContents.send("quick-meeting-request", pending),
});
async function refreshWorkspaces() {
  try {
    await provisioner.refresh();
  } finally {
    const ids = new Set(config().workspaces.map((w) => w.id));
    for (const [k, w] of windows)
      if (!ids.has(k.split(":")[0])) {
        rememberWindow(k, w);
        w.destroy();
      }
    rebuildTray();
  }
  return publicConfig();
}
function rememberWindow(k, win) {
  if (win.isDestroyed()) return;
  const cfg = config();
  persist({
    windows: {
      ...cfg.windows,
      [k]: {
        ...cfg.windows[k],
        bounds: win.getBounds(),
        url: win.webContents.getURL(),
        visible: win.isVisible(),
      },
    },
  });
}
function applyPreferences(k, win) {
  const p = config().windows[k] || {};
  win.setAlwaysOnTop(!!p.pinned, "floating");
  if (process.platform === "darwin")
    win.setVisibleOnAllWorkspaces(!!p.allSpaces, {
      visibleOnFullScreen: !!p.allSpaces,
    });
  protectWindow(win);
}
function contextMenu(k, win, params = {}) {
  const p = config().windows[k] || {};
  const text = require('./textContextMenu').textItems(params, win);
  return Menu.buildFromTemplate([
    ...text,
    ...(text.length ? [{ type: 'separator' }] : []),
    { role: 'copy' }, { role: 'paste', enabled: !!params.isEditable },
    {
      label: "Sempre por cima",
      type: "checkbox",
      checked: !!p.pinned,
      click: (item) => preferences(k, { pinned: item.checked }),
    },
    {
      label: "Mostrar em todas as Mesas",
      type: "checkbox",
      checked: !!p.allSpaces,
      enabled: process.platform === "darwin",
      click: (item) => preferences(k, { allSpaces: item.checked }),
    },
    {
      label: "Ocultar ao perder foco",
      type: "checkbox",
      checked: !!p.autoHide,
      click: (item) => preferences(k, { autoHide: item.checked }),
    },
    { type: "separator" },
    { label: "Ocultar esta janela", click: () => win.hide() },
    { label: "Ocultar todas as centrais", click: hideAll },
    { label: "Preferências / conexões", click: openPanel },
  ]);
}
function open(workspace, mode = "notes", toggle = false, instance = "") {
  const cfg = config(),
    connection = cfg.workspaces.find((w) => w.id === workspace);
  if (!connection?.token)
    throw new Error(
      "O acesso desta empresa ainda não está pronto. Atualize a integração na central.",
    );
  const k = state.key(workspace, mode) + (instance ? ":" + instance : "");
  lastKey = k;
  persist({ lastWorkspace: workspace });
  const existing = windows.get(k);
  if (existing && !existing.isDestroyed()) {
    protectWindow(existing);
    if (toggle && existing.isVisible()) existing.hide();
    else {
      existing.show();
      existing.focus();
    }
    return;
  }
  const prefs = cfg.windows[k] || {};
  const area = screen.getDisplayMatching(
    prefs.bounds || screen.getPrimaryDisplay().workArea,
  ).workArea;
  const isolated = session.fromPartition(state.partition(workspace));
  isolated.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  // Remote content has no Node/core IPC. Its dedicated preload exposes only two
  // owner-scoped actions; recording requires native confirmation. Capabilities
  // are injected only for this exact origin and never appear in the URL.
  isolated.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders };
    if (new URL(details.url).origin === cfg.baseURL)
      headers.Authorization =
        "Bearer " +
        (config().workspaces.find((w) => w.id === workspace)?.token || "");
    else {
      delete headers.Authorization;
      delete headers.authorization;
    }
    callback({ requestHeaders: headers });
  });
  const win = new BrowserWindow({
    ...state.bounds(prefs.bounds, area, mode),
    title: `Metis — ${connection.name} — ${mode === "notes" ? "Notas" : "Completo"}`,
    show: false,
    autoHideMenuBar: true,
    skipTaskbar: process.platform === "darwin",
    webPreferences: {
      preload: path.join(__dirname, "../work/notes-preload.js"),
      partition: state.partition(workspace),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  bindContentProtection(win);
  windows.set(k, win);
  applyPreferences(k, win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== cfg.baseURL) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  win.webContents.on("context-menu", (_event, params) =>
    contextMenu(k, win, params).popup({ window: win }),
  );
  let timer;
  const remember = () => {
    clearTimeout(timer);
    timer = setTimeout(() => rememberWindow(k, win), 300);
    timer.unref?.();
  };
  win.on("move", remember);
  win.on("resize", remember);
  win.webContents.on("did-navigate-in-page", remember);
  win.on("focus", () => {
    lastKey = k;
    persist({ lastWorkspace: workspace });
  });
  win.on("show", remember);
  win.on("hide", remember);
  win.on("blur", () => {
    if (config().windows[k]?.autoHide)
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isFocused() && !panel?.isFocused())
          win.hide();
      }, 200);
  });
  win.on("close", (event) => {
    rememberWindow(k, win);
    if (!app.isQuitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    clearTimeout(timer);
    windows.delete(k);
  });
  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
  void win.loadURL(state.windowURL(cfg.baseURL, workspace, mode, prefs.url));
  rebuildTray();
}
function hideAll() {
  for (const win of windows.values()) if (!win.isDestroyed()) win.hide();
}
function preferences(k, change) {
  const [workspace, mode] = k.split(":");
  state.key(workspace, mode);
  const cfg = config();
  const allowed = {};
  for (const key of ["pinned", "allSpaces", "autoHide"])
    if (key in change) allowed[key] = !!change[key];
  if ("spaceLabel" in change)
    allowed.spaceLabel = String(change.spaceLabel).slice(0, 100);
  if ("hotkey" in change) allowed.hotkey = String(change.hotkey).slice(0, 100);
  persist({
    windows: { ...cfg.windows, [k]: { ...cfg.windows[k], ...allowed } },
  });
  const win = windows.get(k);
  if (win) applyPreferences(k, win);
  registerShortcuts();
  rebuildTray();
  return publicConfig();
}
function registerShortcuts() {
  for (const shortcut of shortcuts) globalShortcut.unregister(shortcut);
  shortcuts.clear();
  const register = (shortcut, callback) => {
    if (!shortcut) return;
    if (globalShortcut.isRegistered(shortcut))
      throw new Error("Atalho já registrado: " + shortcut);
    if (!globalShortcut.register(shortcut, callback))
      throw new Error("Não foi possível registrar o atalho");
    shortcuts.add(shortcut);
  };
  for (const [k, p] of Object.entries(config().windows)) {
    if (p.hotkey) {
      const [workspace, mode, instance] = k.split(":");
      register(p.hotkey, () => open(workspace, mode, true, instance));
    }
  }
  // Preserve existing Metis shortcuts; defaults are opt-in to avoid conflicts.
}
function rebuildTray() {
  if (!tray) return;
  const cfg = config();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir Metis desktop", click: () => require("../windows/windowManager").showCommandPanel("command") },
      { label: "Configurações da integração web", click: openPanel },
      ...cfg.workspaces.map((w) => ({
        label: w.name,
        submenu: [
          { label: "Notas flutuantes", click: () => open(w.id, "notes", true) },
          { label: "Aplicação web", click: () => open(w.id, "full", true) },
        ],
      })),
      { type: "separator" },
      {
        label: "Mostrar última central",
        enabled: !!lastKey,
        click: () => {
          if (lastKey) {
            const [w, m, instance] = lastKey.split(":");
            open(w, m, false, instance);
          }
        },
      },
      { label: "Ocultar centrais", click: hideAll },
    ]),
  );
}
function openPanel() {
  if (panel && !panel.isDestroyed()) {
    protectWindow(panel);
    panel.show();
    panel.focus();
    return;
  }
  panel = new BrowserWindow({
    width: 780,
    height: 800,
    title: "Metis — Configurações da integração web",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../work/work-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  bindContentProtection(panel);
  panel.once("ready-to-show", () => {
    panel.show();
    panel.focus();
  });
  panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  panel.webContents.on("will-navigate", (event) => event.preventDefault());
  void panel.loadFile(panelPath);
}
function openNotesMenu(parent) {
  const companies = config().workspaces.filter(w => !w.archived && w.token);
  if (companies.length === 1) { open(companies[0].id, "notes", false, randomUUID()); return; }
  Menu.buildFromTemplate(companies.length ? companies.map(w => ({ label: w.name, click: () => open(w.id, "notes", false, randomUUID()) })) : [{ label: "Configurar integração web", click: openPanel }]).popup({ window: parent });
}
function trustedCore(event) {
  const command = require("../windows/windowManager").get("command");
  if (!command || event.sender !== command.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error("Janela principal necessária.");
}
function trusted(event) {
  if (event.senderFrame !== event.sender.mainFrame)
    throw new Error("Frame não permitido");
  let url;
  try {
    url = new URL(event.senderFrame.url);
  } catch {
    throw new Error("Origem inválida");
  }
  if (
    url.protocol !== "file:" ||
    path.resolve(fileURLToPath(url)) !== panelPath
  )
    throw new Error("Origem não autorizada");
}
function init() {
  if (initialized) return;
  initialized = true;
  ipcMain.handle("metis-quick:pending", event => { trustedCore(event); return quickMeeting.peek(); });
  ipcMain.handle("metis-quick:ack", (event, identifier) => { trustedCore(event); quickMeeting.acknowledge(identifier); });
  ipcMain.handle("metis-notes:action", async (event, action) => {
    const workspace = workspaceForEvent(event, windows, config().baseURL);
    if (action === "new-window") { open(workspace, "notes", false, randomUUID()); return { opened: true }; }
    if (action !== "quick-meeting") throw new Error("Ação não permitida.");
    const company = config().workspaces.find(w => w.id === workspace);
    const owner = [...windows.values()].find(win => win.webContents === event.sender);
    const answer = await dialog.showMessageBox(owner, {
      type: "question", buttons: ["Iniciar gravação", "Cancelar"], defaultId: 1, cancelId: 1,
      message: `Reunião rápida — ${company.name}`,
      detail: "Capturar áudio do sistema e microfone? Avise os participantes. Gravação e transcrição ficam neste computador. Só após encerrar, o resumo vira aprendizado desta empresa e é sincronizado com o Metis web; o áudio nunca é enviado. A publicação no OpenViking não é automática.",
    });
    if (answer.response !== 0) return { cancelled: true };
    workspaceForEvent(event, windows, config().baseURL);
    return quickMeeting.request(workspace);
  });
  ipcMain.handle("metis-work:command", async (event, command, args = {}) => {
    trusted(event);
    if (command === "config") return publicConfig();
    if (command === "desktop") {
      const target = args.panel || "command";
      if (!["command", "chat", "settings"].includes(target)) throw new Error("Tela não permitida");
      require("../windows/windowManager").showCommandPanel(target);
      panel?.hide();
      return { opened: target };
    }
    if (command === "endpoint") {
      const baseURL = state.endpoint(args.url),
        cfg = config();
      if (baseURL !== cfg.baseURL) {
        if (cfg.workspaces.length && args.confirmSwitch !== true)
          throw new Error(
            "Confirme a troca de servidor para não misturar empresas.",
          );
        for (const win of windows.values()) win.destroy();
        persist({
          baseURL,
          workspaces: [],
          windows: {},
          lastWorkspace: undefined,
        });
        provisioner.reset();
        lastKey = undefined;
      }
      return refreshWorkspaces();
    }
    if (command === "list") return request("/api/v1/workspaces");
    if (command === "refresh" || command === "connect")
      return refreshWorkspaces();
    if (command === "reconnect") {
      await provisioner.reconnect(String(args.workspace));
      rebuildTray();
      return publicConfig();
    }
    if (command === "disconnect") {
      const cfg = config();
      for (const [k, w] of windows) {
        if (k.startsWith(args.workspace + ":")) {
          rememberWindow(k, w);
          w.destroy();
        }
      }
      persist({
        workspaces: cfg.workspaces.filter((w) => w.id !== args.workspace),
      });
      rebuildTray();
      return publicConfig();
    }
    if (command === "open") {
      open(String(args.workspace), String(args.mode));
      return publicConfig();
    }
    if (command === "preferences")
      return preferences(String(args.key), args.change || {});
    if (command === "hide") {
      hideAll();
      return publicConfig();
    }
    if (command === "sync") {
      return require("./workMeetingSync").syncPending();
    }
    if (command === "sessions") {
      return store
        .getInterviewSessions()
        .filter((s) => s.config?.workspaceId)
        .map((s) => ({
          id: s.id,
          title: s.title,
          workspace: s.config.workspaceId,
          status: s.workSync?.status || "pending",
          error: s.workSync?.error,
        }));
    }
    throw new Error("Comando não permitido");
  });
  // macOS stays discreet: no status/menu-bar icon. Entry points live in the app.
  if (process.platform !== "darwin") {
    const image = nativeImage
      .createFromPath(path.join(__dirname, "../../public/icon/metis-symbol.png"))
      .resize({ width: 20, height: 20 });
    tray = new Tray(image);
    tray.setToolTip("Metis — Central de trabalho");
    rebuildTray();
  }
  try {
    registerShortcuts();
  } catch (error) {
    require("./logger").warn("WORK_SYNC", error.message);
  }
  const update = () =>
    refreshWorkspaces().catch((error) =>
      require("./logger").warn("WORK_SYNC", error.message),
    );
  void update();
  const syncTimer = setInterval(() => {
    void update();
    require("./workMeetingSync")
      .syncPending(false)
      .catch(() => {});
  }, 60000);
  syncTimer.unref?.();
  const initial = setTimeout(
    () =>
      require("./workMeetingSync")
        .syncPending(false)
        .catch(() => {}),
    5000,
  );
  initial.unref?.();
  app.on("before-quit", () => {
    for (const [k, w] of windows) rememberWindow(k, w);
  });
}
module.exports = {
  init,
  open,
  openPanel,
  openNotesMenu,
  hideAll,
  preferences,
  config,
  publicConfig,
  request,
  refreshWorkspaces,
};
