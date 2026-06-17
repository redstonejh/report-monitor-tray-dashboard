'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Host platform — Windows uses a native OS acrylic window, so the renderer
  // squares the panel corners to match DWM's rounding (body.win-acrylic).
  platform: process.platform,

  // Receive live status pushes from main process (MQTT → IPC → renderer)
  onStatus: (cb) => ipcRenderer.on('mqtt:status', (_e, payload) => cb(payload)),

  // Receive connection state changes ('grey' | 'live' | 'black')
  onConnection: (cb) => ipcRenderer.on('mqtt:connection', (_e, state) => cb(state)),

  // One-time fetch of current status + connection state (for initial render)
  getStatus: () => ipcRenderer.invoke('status:get'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Open external links in the default browser
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Open the expanded dashboard window owned by the main process
  openDashboard: () => ipcRenderer.invoke('dashboard:open'),

  // Tray pie: per-company past-24h condition mix, and slice click-through that
  // opens the dashboard on that company's tab.
  getCompaniesPie: (windowMs) => ipcRenderer.invoke('companies:pie', windowMs),
  openCompany: (companyId, chartDepth) => ipcRenderer.invoke('dashboard:open-company', companyId, chartDepth),

  // Current dashboard background environment (tone colors + optional photo)
  // used by the popover's liquid-glass WebGL backdrop.
  getDashboardBackground: () => ipcRenderer.invoke('dashboard:background'),

  resizeContent: (size) => ipcRenderer.invoke('window:resize-content', size),
  pointerEntered: () => ipcRenderer.invoke('window:pointer-enter'),
  pointerLeft: () => ipcRenderer.invoke('window:pointer-leave'),
  rendererReady: () => ipcRenderer.invoke('window:renderer-ready'),
  pinPopover: () => ipcRenderer.invoke('window:pin'),
  refreshStatus: () => ipcRenderer.invoke('window:refresh-status'),
  hidePopover: () => ipcRenderer.invoke('window:hide-popover'),
  onPopoverMode: (cb) => ipcRenderer.on('window:mode', (_e, mode) => cb(mode)),
  onAnchorEdge: (cb) => ipcRenderer.on('window:anchor-edge', (_e, edge) => cb(edge)),
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
