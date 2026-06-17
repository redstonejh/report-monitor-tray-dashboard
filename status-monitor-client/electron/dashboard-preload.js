'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ─── Live status bridge (same backend as the tray popover) ───────────────────

contextBridge.exposeInMainWorld('dashboard', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  onStatus: (cb) => ipcRenderer.on('mqtt:status', (_e, payload) => cb(payload)),
  onConnection: (cb) => ipcRenderer.on('mqtt:connection', (_e, state) => cb(state)),
  getHistory: (limit) => ipcRenderer.invoke('history:get', limit),
  // Multi-company tabs: the company list, one company's ping history, and live
  // per-company pings as they arrive.
  getCompanies: () => ipcRenderer.invoke('companies:get'),
  getCompanyHistory: (companyId, limit) => ipcRenderer.invoke('company:history', { companyId, limit }),
  // Source IP per monitoring viewer (each location is itself a tracked circuit).
  getViewerIps: () => ipcRenderer.invoke('viewers:ips'),
  onCheck: (cb) => ipcRenderer.on('mqtt:check', (_e, payload) => cb(payload)),
  // Tray pie click-through: a pending company focus pulled at boot, plus live
  // pushes when the window is already open.
  consumeCompanyFocus: () => ipcRenderer.invoke('company:focus:consume'),
  onSetCompany: (cb) => ipcRenderer.on('dashboard:set-company', (_e, payload) => cb(payload)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  closeDashboard: () => ipcRenderer.invoke('dashboard:close'),
  minimize: () => ipcRenderer.invoke('dashboard:minimize'),
});

// ─── Layout persistence bridge (dashboard builder save/load) ──────────────────
// The dashboard renderer's layout-persistence.js requires synchronous storage,
// so the JSON store lives here in the preload (window is created with
// sandbox: false to allow node:fs access).

// Layout/tabs/save-state are namespaced per signed-in account, resolved once at
// load. After a sign-in the renderer reloads, so this re-resolves to the new
// user's store. New accounts therefore start blank.
const sessionUser = (() => {
  try { return String(ipcRenderer.sendSync('auth:current-username') || ''); } catch { return ''; }
})();
const storeUserKey = sessionUser.replace(/[^a-z0-9_-]/gi, '_') || '_anon';
const storePath = path.join(os.homedir(), '.status-monitor', `dashboard-layout-store--${storeUserKey}.json`);

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
}

contextBridge.exposeInMainWorld('dashboardPersistence', {
  getItem(key) {
    const store = readStore();
    return Object.prototype.hasOwnProperty.call(store, key) ? String(store[key]) : null;
  },
  setItem(key, value) {
    const store = readStore();
    store[key] = String(value);
    writeStore(store);
  },
  removeItem(key) {
    const store = readStore();
    delete store[key];
    writeStore(store);
  },
  keys() {
    return Object.keys(readStore());
  },
  clear() {
    writeStore({});
  },
});

// ─── Window controls for the dashboard's frameless chrome ─────────────────────

contextBridge.exposeInMainWorld('dashboardWindowControls', {
  reload() {
    return ipcRenderer.invoke('dashboard-window:reload');
  },
  minimize() {
    return ipcRenderer.invoke('dashboard-window:minimize');
  },
  close() {
    return ipcRenderer.invoke('dashboard-window:close');
  },
});

contextBridge.exposeInMainWorld('auth', {
  session: () => ipcRenderer.invoke('auth:session'),
  login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),
  register: (username, password) => ipcRenderer.invoke('auth:register', { username, password }),
  setPassword: (password) => ipcRenderer.invoke('auth:set-password', { password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
  listUsers: () => ipcRenderer.invoke('auth:list-users'),
  createUser: (payload) => ipcRenderer.invoke('auth:create-user', payload),
  updateUser: (username, data) => ipcRenderer.invoke('auth:update-user', { username, ...data }),
  deleteUser: (username) => ipcRenderer.invoke('auth:delete-user', { username }),
  onChanged: (cb) => ipcRenderer.on('auth:changed', (_e, s) => cb(s)),
});
