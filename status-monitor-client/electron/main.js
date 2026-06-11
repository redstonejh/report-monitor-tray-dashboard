import { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import mqtt from 'mqtt';
import squirrelStartup from 'electron-squirrel-startup';
import { icons } from './icons';
import auth from './auth.js';

// Handle Squirrel.Windows install/update/uninstall events — must quit immediately.
if (squirrelStartup) app.quit();

// Kill the default application menu (File/Edit/View/Window/Help) for a chrome-free
// tray popover. Must be called before any window is created.
Menu.setApplicationMenu(null);

// ─── Settings persistence ─────────────────────────────────────────────────────

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  mqttHost: '127.0.0.1',
  mqttPort: 1883,
  projectId: '',
  systemId: '',
  apiPort: 3847, // REST API port for history (mirrors DEFAULT_API_PORT below)
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ─── App state ────────────────────────────────────────────────────────────────

let tray = null;
let mainWindow = null;
let dashboardWindow = null;
let mqttClient = null;
let currentStatus = null;        // most recent status payload
let currentConnectionState = 'grey'; // 'grey' | 'live' | 'black'
let lastCheckedAt = null;        // payload.checkedAt from most recent message
let settings = loadSettings();
let isQuitting = false;
let popoverMode = 'peek';        // 'peek' | 'expanded'
let popoverPinned = false;
let pointerInPopover = false;
let pointerInTray = false;
let hideTimer = null;
let popoverReady = false;
let pendingPopover = null;
let lastAnchorEdge = 'bottom';   // 'top' means grow down; 'bottom' means grow up
let capturedAnchorPoint = null;

const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_API_PORT = 3847;
const POPOVER_WIDTH = 256;
const POPOVER_PEEK_HEIGHT = 96;
const POPOVER_EXPANDED_HEIGHT = 210;
const POPOVER_INITIAL_HEIGHT = POPOVER_PEEK_HEIGHT;
const POPOVER_MIN_HEIGHT = 80;
const POPOVER_HIDE_GRACE_MS = 250;
const POPOVER_ANCHOR_GAP = 6;
const SUPPORTS_TRAY_HOVER = process.platform !== 'linux';

// ─── MQTT ──────────────────────────────────────────────────────────────────────

function mqttTopic(s) {
  if (!s.projectId || !s.systemId) return null;
  return `${s.projectId}/${s.systemId}/status`;
}

function setConnectionState(state) {
  currentConnectionState = state;
  broadcastConnectionState(state);
  if (state === 'black') updateTray('black');
}

function statusSnapshot() {
  return {
    status: currentStatus,
    connectionState: currentConnectionState,
  };
}

function connectMqtt() {
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }

  // Reset to grey when (re)connecting
  currentConnectionState = 'grey';
  broadcastConnectionState('grey');
  updateTray('grey');

  const topic = mqttTopic(settings);
  if (!topic) {
    console.log('[MQTT] No topic configured — open Settings to enter your share code.');
    return;
  }

  const url = `mqtt://${settings.mqttHost}:${settings.mqttPort}`;
  console.log(`[MQTT] Connecting to ${url}`);

  mqttClient = mqtt.connect(url, { clean: true, reconnectPeriod: 15_000 });

  mqttClient.on('connect', () => {
    console.log(`[MQTT] Connected — subscribing to topic`);
    mqttClient.subscribe(topic, { qos: 1 });
    // Stay grey until the retained message arrives
  });

  mqttClient.on('message', (_topic, message) => {
    let payload;
    try {
      payload = JSON.parse(message.toString());
    } catch {
      return;
    }

    lastCheckedAt = payload.checkedAt;
    const age = lastCheckedAt
      ? Date.now() - new Date(lastCheckedAt).getTime()
      : Infinity;

    const prev = currentStatus;
    currentStatus = payload;
    broadcastToRenderer(payload);

    if (age > STALE_MS) {
      // Broker has a retained message but the API stopped publishing long ago
      setConnectionState('black');
    } else {
      const wasBlackOrGrey = currentConnectionState !== 'live';
      setConnectionState('live');
      updateTray(payload.status);
      if (prev && prev.status !== payload.status && !wasBlackOrGrey) {
        sendNotification(payload);
      }
    }
  });

  mqttClient.on('error', (err) => {
    console.error('[MQTT] Error:', err.message);
    setConnectionState('black');
  });

  // Tray shows grey while reconnecting, but panel keeps last known status
  mqttClient.on('close', () => {
    if (currentConnectionState === 'live') {
      updateTray('grey');
    }
  });
}

// ─── Staleness interval ───────────────────────────────────────────────────────

// Runs every minute to catch the case where MQTT is connected but the API
// stopped publishing (no new messages for 24h).
function startStalenessCheck() {
  setInterval(() => {
    if (currentConnectionState === 'black') return;
    if (!lastCheckedAt) return;
    const age = Date.now() - new Date(lastCheckedAt).getTime();
    if (age > STALE_MS) {
      console.log('[STALENESS] No update in 24h — going black');
      setConnectionState('black');
    }
  }, 60_000);
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function statusLabel(s) {
  const labels = {
    green: 'All good', yellow: 'Needs attention',
    red: 'Source issue', grey: 'Connecting…', black: 'No updates',
  };
  return labels[s] || 'Unknown';
}

function buildContextMenu(status) {
  return Menu.buildFromTemplate([
    { label: 'Status Monitor', enabled: false },
    { label: `Status: ${statusLabel(status)}`, enabled: false },
    { type: 'separator' },
    { label: 'Open Details', click: () => showExpandedWindow(true) },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

let lastTrayStatus = 'grey';
function updateTray(status) {
  if (!tray) return;
  lastTrayStatus = status;
  // No status is revealed until someone is signed in — the tray icon stays
  // neutral grey while signed out.
  const effective = auth.currentUser() ? status : 'grey';
  tray.setImage(icons[effective] || icons.grey);
  tray.setToolTip('');
  // Context menu is popped up manually on right-click (see tray 'right-click'
  // handler) so that LEFT click is reserved for the popover toggle.
}

// ─── Main window ──────────────────────────────────────────────────────────────

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  // Base options shared across platforms.
  const opts = {
    width: POPOVER_WIDTH,
    height: POPOVER_INITIAL_HEIGHT,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    frame: false,            // frameless — no OS title bar / chrome
    transparent: true,       // per-pixel transparency — only the CSS .panel paints
    backgroundColor: '#00000000', // fully transparent base (no opaque window fill)
    roundedCorners: true,    // honored on macOS; Win11 rounds frameless windows automatically
    // hasShadow MUST be false on a transparent frameless window: on Windows the DWM
    // shadow is drawn around the window's full RECTANGLE (it ignores the CSS
    // border-radius), which shows up as the grey rectangle behind the rounded panel.
    hasShadow: false,
    thickFrame: false,       // no native resize/frame surface that could paint a rect
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  };

  if (process.platform === 'darwin') {
    // macOS native vibrancy. macOS clips vibrancy to the window's rounded shape,
    // so no rectangular backdrop leaks out behind the corners.
    opts.vibrancy = 'under-window';
    opts.visualEffectState = 'active';
  } else if (process.platform === 'win32') {
    // Windows (10 & 11): stay per-pixel transparent (transparent:true above) so
    // the CSS-rounded .panel defines the real visible shape. We deliberately do
    // NOT set backgroundMaterial:'acrylic' or any opaque backgroundColor — both
    // fill the full window *rectangle*, which shows as a grey rectangle behind
    // the panel's rounded corners. On Win10 there is no OS blur, so the .panel's
    // own rgba(24,26,32,0.82) frosted fill is the legible surface (CSS only —
    // never a window/body fill).
  } else {
    // Linux / other: stay transparent too. An opaque window backgroundColor
    // ('#141414') was the grey rectangle here — the .panel's CSS rgba fill is
    // the only surface. Compositing-less WMs degrade to the panel rgba, which is
    // still acceptable; no window-level opaque rectangle is ever drawn.
  }

  mainWindow = new BrowserWindow(opts);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.setContentSize(POPOVER_WIDTH, POPOVER_PEEK_HEIGHT);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }

  mainWindow.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    hidePopover();
  });

  mainWindow.on('blur', () => {
    if (mainWindow.webContents.isDevToolsOpened()) return;
    if (popoverPinned) {
      hidePopover();
      return;
    }
    if (!popoverPinned && !pointerInPopover && !pointerInTray) schedulePeekHide();
  });

  mainWindow.on('hide', () => {
    resetToHoverBaseline();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    sendPopoverMode();
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.setContentSize(POPOVER_WIDTH, POPOVER_PEEK_HEIGHT);
    positionWindow();
  });

  return mainWindow;
}

function cancelHideTimer() {
  if (!hideTimer) return;
  clearTimeout(hideTimer);
  hideTimer = null;
}

function resetToHoverBaseline() {
  cancelHideTimer();
  popoverPinned = false;
  pointerInPopover = false;
  pointerInTray = false;
  pendingPopover = null;
  capturedAnchorPoint = null;
  popoverMode = 'peek';
  lastAnchorEdge = 'bottom';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(false);
    applyPopoverBounds(POPOVER_PEEK_HEIGHT, false);
    sendAnchorEdge();
    sendPopoverMode();
  }
}

function hidePopover() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  resetToHoverBaseline();
}

function schedulePeekHide() {
  cancelHideTimer();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (isCursorInPopover()) return;
    if (popoverPinned || pointerInPopover || pointerInTray) return;
    hidePopover();
  }, POPOVER_HIDE_GRACE_MS);
}

function sendPopoverMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:mode', popoverMode);
}

function sendAnchorEdge() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:anchor-edge', lastAnchorEdge);
}

function targetHeightForMode(mode) {
  return mode === 'expanded' ? POPOVER_EXPANDED_HEIGHT : POPOVER_PEEK_HEIGHT;
}

function boundsForHeight(height, pinned = popoverPinned) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const current = mainWindow.getBounds();
  const width = POPOVER_WIDTH;

  if (pinned) {
    const display = screen.getDisplayMatching(current);
    const workArea = display.workArea;
    const x = Math.round(Math.min(
      Math.max(current.x, workArea.x),
      workArea.x + workArea.width - width
    ));
    const y = lastAnchorEdge === 'bottom'
      ? current.y + current.height - height
      : current.y;
    const clampedY = Math.round(Math.min(
      Math.max(y, workArea.y),
      workArea.y + workArea.height - height
    ));
    return { x, y: clampedY, width, height };
  }

  return boundsForTrayAnchor(height);
}

function applyPopoverBounds(targetHeight, pinned = popoverPinned) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = boundsForHeight(targetHeight, pinned);
  if (bounds) mainWindow.setBounds(bounds);
}

function applyPopoverSize(mode) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  applyPopoverBounds(targetHeightForMode(mode));
}

function setPopoverMode(mode) {
  popoverMode = mode;
  applyPopoverSize(mode);
  sendAnchorEdge();
  sendPopoverMode();
}

function pinPopover() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  cancelHideTimer();
  pendingPopover = null;
  pointerInPopover = true;
  popoverPinned = true;
  mainWindow.setIgnoreMouseEvents(false);
  if (popoverMode === 'peek') setPopoverMode('expanded');
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function trayBoundsAreUsable(trayBounds, cursorPoint) {
  if (!trayBounds || trayBounds.width <= 2 || trayBounds.height <= 2) return false;
  const trayCenter = {
    x: trayBounds.x + trayBounds.width / 2,
    y: trayBounds.y + trayBounds.height / 2,
  };
  const distance = Math.hypot(trayCenter.x - cursorPoint.x, trayCenter.y - cursorPoint.y);
  return distance <= 180;
}

function capturePopoverAnchor() {
  const trayBounds = tray.getBounds();
  const cursorPoint = screen.getCursorScreenPoint();
  const hasUsableTrayBounds = trayBoundsAreUsable(trayBounds, cursorPoint);
  capturedAnchorPoint = hasUsableTrayBounds
    ? {
        x: trayBounds.x + trayBounds.width / 2,
        y: trayBounds.y,
      }
    : cursorPoint;
  return capturedAnchorPoint;
}

function popoverAnchor() {
  const anchorPoint = capturedAnchorPoint || capturePopoverAnchor();
  const display = screen.getDisplayNearestPoint(anchorPoint);
  return { anchorPoint, display };
}

function isCursorInPopover(padding = 8) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const cursor = screen.getCursorScreenPoint();
  const bounds = mainWindow.getBounds();
  return cursor.x >= bounds.x - padding
    && cursor.x <= bounds.x + bounds.width + padding
    && cursor.y >= bounds.y - padding
    && cursor.y <= bounds.y + bounds.height + padding;
}

function maxPopoverHeight() {
  const { display } = popoverAnchor();
  return Math.max(POPOVER_MIN_HEIGHT, display.workArea.height - 4);
}

function boundsForTrayAnchor(height = null) {
  if (!tray || !mainWindow || mainWindow.isDestroyed()) return;

  const windowBounds = mainWindow.getBounds();
  const { anchorPoint, display } = popoverAnchor();
  const workArea = display.workArea;
  const width = POPOVER_WIDTH;
  const targetHeight = height ?? windowBounds.height;
  let x = anchorPoint.x - width / 2;
  let y = anchorPoint.y - targetHeight - POPOVER_ANCHOR_GAP;
  const anchorNearTop = anchorPoint.y < workArea.y + workArea.height / 2;

  if (anchorNearTop) {
    lastAnchorEdge = 'top';
    y = anchorPoint.y + POPOVER_ANCHOR_GAP;
  } else {
    lastAnchorEdge = 'bottom';
  }

  x = Math.round(Math.min(Math.max(x, workArea.x), workArea.x + workArea.width - width));
  y = Math.round(Math.min(Math.max(y, workArea.y), workArea.y + workArea.height - targetHeight));

  return { x, y, width, height: targetHeight };
}

function positionWindow() {
  const bounds = boundsForTrayAnchor();
  if (bounds) mainWindow.setBounds(bounds);
}

function showPopover(mode, focus, pinned = false) {
  if (!mainWindow) createWindow();

  cancelHideTimer();
  if (!mainWindow.isVisible() && !pinned) {
    popoverPinned = false;
    pointerInPopover = false;
    pendingPopover = null;
    capturePopoverAnchor();
  }
  const wasVisible = mainWindow.isVisible();
  popoverPinned = pinned && wasVisible;
  setPopoverMode(mode);
  popoverPinned = pinned;
  positionWindow();

  if (!popoverReady) {
    pendingPopover = { mode, focus, pinned };
    return;
  }

  if (focus) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
  } else {
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.showInactive();
    mainWindow.moveTop();
  }
}

function flushPendingPopover() {
  if (!pendingPopover || !mainWindow || mainWindow.isDestroyed()) return;
  const { mode, focus, pinned } = pendingPopover;
  pendingPopover = null;
  popoverPinned = pinned;
  setPopoverMode(mode);
  positionWindow();
  if (focus) {
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
  } else {
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.showInactive();
    mainWindow.moveTop();
  }
}

function showPeekWindow() {
  pointerInPopover = false;
  popoverPinned = false;
  capturePopoverAnchor();
  showPopover('peek', false, false);
}

function showExpandedWindow(pinned = false) {
  pointerInPopover = false;
  showPopover('expanded', pinned, pinned);
}

// ─── Dashboard window ───────────────────────────────────────────────────────

function dashboardIndexPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'dashboard', 'index.html');
  }

  const candidates = [
    path.join(app.getAppPath(), 'dashboard', 'index.html'),
    path.join(process.cwd(), 'dashboard', 'index.html'),
    path.join(__dirname, '..', '..', 'dashboard', 'index.html'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

// Seed a brand-new account's layout store with the shipped default layout
// (dashboard/default-layout.json) so every signed-in user lands on it. Existing
// accounts keep their own saved layout (the store file already exists).
function seedDefaultLayoutForUser(username) {
  try {
    if (!username) return;
    const key = String(username).replace(/[^a-z0-9_-]/gi, '_') || '_anon';
    const storePath = path.join(os.homedir(), '.status-monitor', `dashboard-layout-store--${key}.json`);
    if (fs.existsSync(storePath)) return;
    const defaultPath = path.join(path.dirname(dashboardIndexPath()), 'default-layout.json');
    if (!fs.existsSync(defaultPath)) return;
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.copyFileSync(defaultPath, storePath);
  } catch {}
}

function createDashboardWindow() {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    return dashboardWindow;
  }

  // The dashboard renderer draws its own window chrome (drag region +
  // minimize/close/reload glass controls), so the window is frameless.
  // sandbox:false lets dashboard-preload.js use node:fs for the synchronous
  // layout persistence bridge the dashboard builder requires.
  dashboardWindow = new BrowserWindow({
    width: 1440,
    height: 1000,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#f7f8fb',
    webPreferences: {
      preload: path.join(__dirname, 'dashboard-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  seedDefaultLayoutForUser(auth.currentUser());
  dashboardWindow.loadFile(dashboardIndexPath());

  dashboardWindow.once('ready-to-show', () => {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
    dashboardWindow.show();
    dashboardWindow.focus();
  });

  dashboardWindow.webContents.once('did-finish-load', () => {
    if (!dashboardWindow || dashboardWindow.isDestroyed()) return;
    dashboardWindow.webContents.send('mqtt:connection', currentConnectionState);
    if (currentStatus) dashboardWindow.webContents.send('mqtt:status', currentStatus);
  });

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });

  return dashboardWindow;
}

function openDashboardWindow() {
  const window = createDashboardWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function openRendererWindows() {
  return [mainWindow, dashboardWindow].filter((win) => win && !win.isDestroyed());
}

function broadcastToRenderer(payload) {
  openRendererWindows().forEach((win) => win.webContents.send('mqtt:status', payload));
}

function broadcastConnectionState(state) {
  openRendererWindows().forEach((win) => win.webContents.send('mqtt:connection', state));
}

// ─── Notifications ────────────────────────────────────────────────────────────

function sendNotification(payload) {
  if (!Notification.isSupported()) return;
  const titles = { green: 'Status OK', yellow: 'Status Warning', red: 'Status Error' };
  new Notification({
    title: titles[payload.status] || 'Status Changed',
    body: payload.detail || '',
    urgency: payload.status === 'red' ? 'critical' : 'normal',
  }).show();
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (app.dock) app.dock.hide();

  auth.init();

  tray = new Tray(icons.grey);
  updateTray('grey');
  createWindow();

  // The dashboard is the primary surface: open it on launch so users sign in
  // and land on it by default (the tray popover remains available).
  openDashboardWindow();

  // LEFT click toggles the popover near the tray icon.
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible() && popoverPinned) {
      hidePopover();
    } else {
      showExpandedWindow(true);
    }
  });

  if (SUPPORTS_TRAY_HOVER) {
    // macOS and Windows expose tray hover. Windows can be unreliable when the
    // icon lives in the overflow flyout instead of the visible taskbar.
    tray.on('mouse-enter', () => {
      pointerInTray = true;
      if (!mainWindow || !mainWindow.isVisible() || !popoverPinned) {
        showPeekWindow();
      }
    });

    tray.on('mouse-leave', () => {
      pointerInTray = false;
      if (!popoverPinned && !pointerInPopover) schedulePeekHide();
    });
  }

  // RIGHT click shows the show/quit context menu.
  tray.on('right-click', () => {
    const label = currentConnectionState === 'live' && currentStatus
      ? currentStatus.status
      : currentConnectionState;
    tray.popUpContextMenu(buildContextMenu(label));
  });

  startStalenessCheck();
  connectMqtt();
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {});

app.on('will-quit', () => {
  if (mqttClient) mqttClient.end(true); // force-close, don't wait for handshake
});

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('status:get', () => statusSnapshot());

ipcMain.handle('settings:get', () => settings);

ipcMain.handle('settings:save', (_e, newSettings) => {
  if (newSettings.shareCode) {
    try {
      const decoded = JSON.parse(Buffer.from(newSettings.shareCode, 'base64').toString('utf8'));
      newSettings.mqttHost  = decoded.mqttHost  || newSettings.mqttHost;
      newSettings.mqttPort  = decoded.mqttPort  || decoded.mqttWsPort || newSettings.mqttPort;
      newSettings.projectId = decoded.projectId  || newSettings.projectId;
      newSettings.systemId  = decoded.systemId   || newSettings.systemId;
      newSettings.apiPort   = decoded.apiPort    || newSettings.apiPort;
    } catch {
      return { ok: false, error: 'Invalid share code' };
    }
  }
  delete newSettings.shareCode;
  settings = { ...settings, ...newSettings };
  saveSettings(settings);
  connectMqtt();
  return { ok: true };
});

ipcMain.handle('shell:openExternal', (_e, url) => {
  // Only hand http(s) URLs to the OS — never file:, javascript:, or other
  // schemes a malformed/unexpected value could carry.
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return shell.openExternal(parsed.href);
    }
  } catch {}
  return undefined;
});

ipcMain.handle('window:resize-content', (e, size = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  if (e.sender !== mainWindow.webContents) return { ok: false };

  const parsedHeight = Number.parseInt(size.height, 10);
  const measuredHeight = Number.isFinite(parsedHeight)
    ? parsedHeight
    : targetHeightForMode(popoverMode);
  const targetHeight = targetHeightForMode(popoverMode);
  const height = popoverMode === 'peek'
    ? POPOVER_PEEK_HEIGHT
    : Math.min(Math.max(measuredHeight, targetHeight, POPOVER_MIN_HEIGHT), maxPopoverHeight());

  applyPopoverBounds(height, popoverPinned);
  return { ok: true, width: POPOVER_WIDTH, height };
});

ipcMain.handle('window:renderer-ready', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  popoverReady = true;
  applyPopoverSize(popoverMode);
  flushPendingPopover();
  return { ok: true };
});

ipcMain.handle('window:pin', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  pinPopover();
  return { ok: true };
});

ipcMain.handle('window:refresh-status', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  connectMqtt();
  if (currentStatus) mainWindow.webContents.send('mqtt:status', currentStatus);
  mainWindow.webContents.send('mqtt:connection', currentConnectionState);
  return { ok: true, ...statusSnapshot() };
});

ipcMain.handle('window:hide-popover', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  hidePopover();
  return { ok: true };
});

ipcMain.handle('window:pointer-enter', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  pointerInPopover = true;
  cancelHideTimer();
  mainWindow.setIgnoreMouseEvents(false);
  if (!popoverPinned && popoverMode === 'peek') {
    setPopoverMode('expanded');
  }
  return { ok: true };
});

ipcMain.handle('window:pointer-leave', (e) => {
  if (!mainWindow || mainWindow.isDestroyed() || e.sender !== mainWindow.webContents) {
    return { ok: false };
  }
  pointerInPopover = false;
  if (!popoverPinned && !pointerInTray) schedulePeekHide();
  return { ok: true };
});

// ─── Dashboard background environment (for the popover's WebGL glass) ────────
// Tone presets and photo sources mirror dashboard/app/static (index.html boot
// script and modules/background-controller.js). The dashboard mirrors its
// localStorage background choice into the shared layout store
// (~/.status-monitor/dashboard-layout-store.json) so it is readable here.

const BACKGROUND_TONE_PRESETS = {
  'tone-light-grey': '#d1d5db',
  'tone-grey': '#6b7280',
  'tone-dark-grey': '#1f2937',
  'tone-black': '#000000',
};

const BACKGROUND_PHOTO_SOURCES = {
  'photo-bark': 'app/static/backgrounds/nature/bark.webp',
  'photo-cloud': 'app/static/backgrounds/nature/cloud.webp',
  'photo-jungle': 'app/static/backgrounds/nature/jungle.webp',
  'photo-moss': 'app/static/backgrounds/nature/moss.webp',
  'photo-sand': 'app/static/backgrounds/nature/sand.webp',
  'photo-shore': 'app/static/backgrounds/nature/shore.webp',
  'photo-turf': 'app/static/backgrounds/nature/turf.webp',
  'photo-water': 'app/static/backgrounds/nature/water.webp',
  'photo-water2': 'app/static/backgrounds/nature/water2.webp',
  'photo-denim': 'app/static/backgrounds/textures/denim.webp',
  'photo-marble': 'app/static/backgrounds/textures/marble.webp',
  'photo-leather': 'app/static/backgrounds/textures/leather.webp',
  'photo-texture': 'app/static/backgrounds/textures/texture.webp',
  'photo-paint': 'app/static/backgrounds/abstract/paint.webp',
  'photo-paintspill': 'app/static/backgrounds/abstract/paintspill.webp',
  'photo-city': 'app/static/backgrounds/urban/city.webp',
  'photo-modern': 'app/static/backgrounds/urban/modern.webp',
  'photo-mercury': 'app/static/backgrounds/space/mercury.webp',
  'photo-venus': 'app/static/backgrounds/space/venus.webp',
  'photo-earth': 'app/static/backgrounds/space/earth.webp',
  'photo-mars': 'app/static/backgrounds/space/mars.webp',
  'photo-jupiter': 'app/static/backgrounds/space/jupiter.webp',
  'photo-saturn': 'app/static/backgrounds/space/saturn.webp',
  'photo-uranus': 'app/static/backgrounds/space/uranus.webp',
  'photo-neptune': 'app/static/backgrounds/space/neptune.webp',
  'photo-pluto': 'app/static/backgrounds/space/pluto.webp',
};

const DASHBOARD_LAYOUT_STORE = path.join(os.homedir(), '.status-monitor', 'dashboard-layout-store.json');

// Photo backgrounds are read once and memoized — the popover re-requests the
// backdrop on every show, and the bundled photos never change at runtime.
const photoDataUrlCache = new Map();

function savedDashboardBackground() {
  try {
    const store = JSON.parse(fs.readFileSync(DASHBOARD_LAYOUT_STORE, 'utf8'));
    const value = store['dashboard-background'];
    return typeof value === 'string' && value.trim() ? value.trim() : 'tone-dark-grey';
  } catch {
    return 'tone-dark-grey';
  }
}

ipcMain.handle('dashboard:background', () => {
  const key = savedDashboardBackground();
  const fallbackTone = BACKGROUND_TONE_PRESETS['tone-dark-grey'];
  const result = { key, bgStart: fallbackTone, bgEnd: fallbackTone, photoDataUrl: '' };

  if (BACKGROUND_TONE_PRESETS[key]) {
    result.bgStart = result.bgEnd = BACKGROUND_TONE_PRESETS[key];
    return result;
  }
  if (/^#[0-9a-f]{6}$/i.test(key)) {
    // Derived custom-color backgrounds serialize as a bare hex tone.
    result.bgStart = result.bgEnd = key;
    return result;
  }
  const photoSource = BACKGROUND_PHOTO_SOURCES[key];
  if (photoSource) {
    if (photoDataUrlCache.has(key)) {
      result.photoDataUrl = photoDataUrlCache.get(key);
    } else {
      try {
        const photoPath = path.join(path.dirname(dashboardIndexPath()), photoSource);
        const dataUrl = `data:image/webp;base64,${fs.readFileSync(photoPath).toString('base64')}`;
        photoDataUrlCache.set(key, dataUrl);
        result.photoDataUrl = dataUrl;
      } catch (err) {
        console.warn('[dashboard:background] photo read failed:', err.message);
      }
    }
  }
  // solar-system / unknown keys keep the dark tone (with no photo).
  return result;
});

ipcMain.handle('dashboard:open', () => {
  openDashboardWindow();
  return { ok: true };
});

ipcMain.handle('dashboard:close', () => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.close();
  return { ok: true };
});

ipcMain.handle('dashboard:minimize', () => {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) dashboardWindow.minimize();
  return { ok: true };
});

// Window-control IPC used by the dashboard renderer's own frameless chrome
// (window-control-cluster buttons → dashboardWindowControls bridge).

function isDashboardSender(e) {
  return dashboardWindow
    && !dashboardWindow.isDestroyed()
    && e.sender === dashboardWindow.webContents;
}

ipcMain.handle('dashboard-window:reload', (e) => {
  if (!isDashboardSender(e)) return { ok: false };
  dashboardWindow.webContents.reload();
  return { ok: true };
});

ipcMain.handle('dashboard-window:minimize', (e) => {
  if (!isDashboardSender(e)) return { ok: false };
  dashboardWindow.minimize();
  return { ok: true };
});

ipcMain.handle('dashboard-window:close', (e) => {
  if (!isDashboardSender(e)) return { ok: false };
  dashboardWindow.close();
  return { ok: true };
});

// ─── Accounts / auth ─────────────────────────────────────────────────────────

function broadcastAuth() {
  const payload = auth.session();
  BrowserWindow.getAllWindows().forEach((w) => {
    if (w && !w.isDestroyed()) w.webContents.send('auth:changed', payload);
  });
}

function canManageUsers() {
  const s = auth.session();
  return !!(s.user && (s.user.isAdmin || s.user.permissions.canManageUsers));
}

ipcMain.handle('auth:session', () => auth.session());

ipcMain.handle('auth:login', (_e, { username, password } = {}) => {
  const result = auth.login(username, password);
  if (result.ok) { seedDefaultLayoutForUser(auth.currentUser()); broadcastAuth(); updateTray(lastTrayStatus); }
  return result;
});

ipcMain.handle('auth:logout', () => {
  const result = auth.logout();
  broadcastAuth();
  updateTray(lastTrayStatus);
  return result;
});

ipcMain.handle('auth:register', (_e, payload) => {
  const result = auth.register(payload || {});
  if (result.ok) { seedDefaultLayoutForUser(auth.currentUser()); broadcastAuth(); updateTray(lastTrayStatus); }
  return result;
});

ipcMain.handle('auth:set-password', (_e, { password } = {}) => {
  const result = auth.setOwnPassword(password);
  if (result.ok) broadcastAuth();
  return result;
});

ipcMain.handle('auth:list-users', () => (
  canManageUsers() ? { ok: true, users: auth.listUsers() } : { ok: false, error: 'Not allowed' }
));

ipcMain.handle('auth:create-user', (_e, payload) => (
  canManageUsers() ? auth.createUser(payload || {}) : { ok: false, error: 'Not allowed' }
));

ipcMain.handle('auth:update-user', (_e, { username, ...rest } = {}) => (
  canManageUsers() ? auth.updateUser(username, rest) : { ok: false, error: 'Not allowed' }
));

ipcMain.handle('auth:delete-user', (_e, { username } = {}) => (
  canManageUsers() ? auth.deleteUser(username) : { ok: false, error: 'Not allowed' }
));

// Synchronous lookup so a preload can pick the signed-in user's layout store.
ipcMain.on('auth:current-username', (e) => { e.returnValue = auth.currentUser() || ''; });

ipcMain.handle('history:get', async (_e, limit = 20) => {
  const parsedLimit = Number.parseInt(limit, 10);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), 500)
    : 20;
  const apiPort = Number.parseInt(settings.apiPort || DEFAULT_API_PORT, 10);
  const url = `http://${settings.mqttHost}:${apiPort}/api/history?limit=${safeLimit}`;

  try {
    const response = await fetch(url);
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, response: body };
    }
    return body;
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
