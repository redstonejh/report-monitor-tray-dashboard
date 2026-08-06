// Browser bridge for the containerized dashboard. Electron defines these APIs
// in its preload before this script runs, so the desktop build remains unchanged.
(() => {
  if (window.dashboard) return;

  document.documentElement.classList.add("web-runtime");
  const style = document.createElement("style");
  style.textContent = `
    .web-runtime .window-minimize-control,
    .web-runtime .window-close-control,
    .web-runtime .app-window-drag-region { display: none !important; }
  `;
  document.head.appendChild(style);

  const listeners = {
    status: new Set(),
    connection: new Set(),
    check: new Set(),
    company: new Set(),
  };
  let lastConnection = "grey";

  const getJson = async (url) => {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  const events = new EventSource("/api/events");
  events.addEventListener("connection", (event) => {
    lastConnection = JSON.parse(event.data);
    listeners.connection.forEach((callback) => callback(lastConnection));
  });
  events.addEventListener("status", (event) => {
    const payload = JSON.parse(event.data);
    listeners.status.forEach((callback) => callback(payload));
  });
  events.addEventListener("check", (event) => {
    const payload = JSON.parse(event.data);
    listeners.check.forEach((callback) => callback(payload));
  });
  events.onerror = () => {
    lastConnection = "grey";
    listeners.connection.forEach((callback) => callback(lastConnection));
  };

  window.dashboard = {
    getStatus: () => getJson("/api/status"),
    onStatus(callback) { listeners.status.add(callback); },
    onConnection(callback) {
      listeners.connection.add(callback);
      callback(lastConnection);
    },
    getHistory: (limit = 20) => getJson(`/api/history?limit=${encodeURIComponent(limit)}`),
    getCompanies: () => getJson("/api/companies"),
    getCompanyHistory: (companyId, limit = 20000) =>
      getJson(`/api/companies/${encodeURIComponent(companyId)}/history?limit=${encodeURIComponent(limit)}`),
    getViewerIps: () => getJson("/api/viewer-ips"),
    onCheck(callback) { listeners.check.add(callback); },
    consumeCompanyFocus: async () => null,
    onSetCompany(callback) { listeners.company.add(callback); },
    getSettings: async () => ({}),
    saveSettings: async () => ({
      ok: false,
      error: "Configure MQTT with container environment variables.",
    }),
    openExternal(url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return Promise.resolve({ ok: true });
    },
    closeDashboard: async () => ({ ok: true }),
    minimize: async () => ({ ok: true }),
  };

  window.dashboardWindowControls = {
    reload: () => window.location.reload(),
    minimize: () => undefined,
    close: () => undefined,
  };
})();
