import { create } from 'zustand';

export const useStatusStore = create((set) => ({
  status: null,           // 'green' | 'yellow' | 'red' | null
  stage: null,            // null | 'process' | 'load' | 'scrape'
  detail: '',
  lastSuccess: null,      // ISO string
  checkedAt: null,        // ISO string
  connectionState: 'grey', // 'grey' | 'live' | 'black'
  popoverMode: 'peek',     // 'peek' | 'expanded'

  setStatus: (payload) => set({
    status:      payload.status,
    stage:       payload.stage      ?? null,
    detail:      payload.detail     ?? '',
    lastSuccess: payload.lastSuccess ?? null,
    checkedAt:   payload.checkedAt  ?? null,
  }),

  setConnectionState: (connectionState) => set({ connectionState }),
  setPopoverMode: (popoverMode) => set({ popoverMode }),
}));

export const useAuthStore = create((set) => ({
  user: null,      // { username, isAdmin, permissions } or null
  loaded: false,
  setUser: (user) => set({ user: user || null, loaded: true }),
}));

export const useSettingsStore = create((set) => ({
  mqttHost:  '',
  mqttPort:  1883,
  projectId: '',
  systemId:  '',
  apiPort:   3847,

  setSettings: (s) => set({
    mqttHost:  s.mqttHost  || '',
    mqttPort:  s.mqttPort  || 1883,
    projectId: s.projectId || '',
    systemId:  s.systemId  || '',
    apiPort:   s.apiPort   || 3847,
  }),
}));
