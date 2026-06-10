'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
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
