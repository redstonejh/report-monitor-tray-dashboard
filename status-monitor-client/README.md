# Status Monitor Client

## Tray Popover Behavior

The tray popover has two visual modes:

- `peek`: shown on tray hover on macOS and Windows with `BrowserWindow.showInactive()`, so it does not steal focus. It contains only the status indicator, state label, and relative timestamp.
- `expanded`: triggered when the pointer enters the peek card, or directly by tray click. It contains the full panel, including Settings and the expanded-dashboard up-arrow.

Clicking or otherwise interacting inside the panel promotes the window to a separate pinned state. While pinned, hover auto-hide is disabled and content/view changes resize in place without re-anchoring to the tray. Blur/click-outside hides the pinned panel. Clicking the tray pins the expanded popover with focus; clicking the tray again hides it. Hover dismissal has a short grace delay so the pointer can move from the tray icon into the popover. The popover is positioned flush to the taskbar work area edge to avoid a dead handoff gap. Linux falls back to click-only expanded behavior because Electron tray hover events are not available there. On Windows, hover events may be unreliable when the tray icon is inside the overflow flyout instead of pinned to the visible taskbar.

The native OS tray tooltip is intentionally disabled. The peek card is the hover affordance.

The popover `BrowserWindow` is created once at app startup, kept hidden, and reused for all hover/click interactions. It is not lazily created on hover. The first visible frame is gated on `ready-to-show` plus a renderer first-paint signal, and main sets deterministic mode heights before showing:

```text
peek: 96px
expanded: 288px minimum, content-fit up to 600px
```

Runtime height changes set the Electron window to its final bounds once, then the renderer reveals the frosted `.panel` with CSS `clip-path`, opacity, and translate animations over about 160ms. Hover windows keep the tray-anchored edge fixed for that one bounds update; pinned windows keep their current on-screen edge fixed and do not consult tray bounds. Reveal state clears on `animationend` and a timeout fallback so interrupted animations cannot block later hovers.

The renderer measures `.panel` with `ResizeObserver` and reports content size through:

```text
window:resize-content
```

The main process compares each display's `bounds` and `workArea` to infer bottom, top, left, or right taskbar placement. It clamps expanded height to the active display work area, applies the fixed compact popover width, sets final window bounds once, and repositions hover windows against `tray.getBounds()` after each resize. The popover is centered on the tray icon center for top/bottom taskbars and clamped to the current display work area so it does not run off screen; side taskbars use the corresponding work-area edge. If Windows reports unusable tray bounds, main falls back to `screen.getCursorScreenPoint()` and anchors near the cursor. Renderer pointer entry and exit are reported through `window:pointer-enter` and `window:pointer-leave` so the hover peek expands and does not disappear while moving into the popover. The panel body is content-fit instead of internally scrolled, so Settings drives the expanded window height when it is the tallest view.

## Expanded Dashboard

The expanded dashboard is the skeletonized-dashboard builder (plain HTML/CSS/JS, no bundler) embedded under `dashboard/`. It is loaded by the existing Electron main process in a frameless `BrowserWindow` — it does not start a second Electron app or connect to MQTT directly. The popover's horizontal top bar (up-arrow) opens it via `window.electron.openDashboard()`.

Live monitor data flows in through `dashboard/app/static/status-feed.js`, which:

- registers a `status` widget type (colored dot + state label + detail + check timestamps) before the layout hydrates,
- fetches the initial snapshot and check history, then subscribes to `mqtt:status` / `mqtt:connection` pushes,
- ingests rows into `window.dashboardWidgetDataRuntime` so the default widgets populate: **Current Status** (status widget), and **Checks / Healthy / Warnings / Errors** stat counters keyed `widget-checks`, `widget-ok`, `widget-warn`, `widget-error`. Any user-added data widget sees the check history rows as its default data source.

Dashboard layouts persist to `~/.status-monitor/dashboard-layout-store.json` through the `window.dashboardPersistence` bridge (the dashboard window is created with `sandbox: false` so the preload can use `node:fs` synchronously). The dashboard's own frameless window chrome (minimize/close/reload glass controls) maps to the `dashboard-window:*` IPC channels.

### Vendored libraries & CSP

Because the dashboard window loads over `file://` **and** exposes a `node:fs` bridge, it must never execute remote script. The visualization libraries (ECharts, Leaflet, TanStack Table, FullCalendar, flatpickr, Monaco) are therefore vendored locally under `dashboard/app/static/vendor/` instead of loaded from a CDN, and `widget-registry.js` resolves them against its own module URL (`VENDOR_BASE`). A `Content-Security-Policy` meta tag in `dashboard/index.html` enforces this: `script-src` allows only `self`/`file:`/`blob:` (plus `'unsafe-inline'`/`'unsafe-eval'` for local code) — **no https host** — so a compromised CDN can no longer inject code into the privileged renderer. Remote *data* that cannot execute stays allowed where a widget needs it: OpenStreetMap tiles via `img-src https:` and YouTube/Vimeo embeds via `frame-src`. Monaco runs with its worker stubbed to an empty blob (`worker-src blob:`), so the document widget needs no worker files.

To re-vendor (e.g. version bump), `npm install --no-save` the package, copy its dist file(s) into `app/static/vendor/`, then `npm prune`.

### Drop-in Path

During development, the dashboard entry is:

```text
status-monitor-client/dashboard/index.html
```

Packaged builds copy that folder as an Electron extra resource and load:

```text
<resources>/dashboard/index.html
```

### Browser Globals

The dashboard runs in a `BrowserWindow` with `contextIsolation: true` and `nodeIntegration: false`. It receives these preload bridges (`window.dashboard`, `window.dashboardPersistence`, `window.dashboardWindowControls`); the status bridge is:

```js
window.dashboard.getStatus()
window.dashboard.onStatus(callback)
window.dashboard.onConnection(callback)
window.dashboard.getHistory(limit)
window.dashboard.getSettings()
window.dashboard.saveSettings(settings)
window.dashboard.openExternal(url)
window.dashboard.closeDashboard()
window.dashboard.minimize()
```

### IPC Channels

The bridge maps to these main-process channels:

| Bridge API | IPC channel |
|---|---|
| `getStatus()` | `status:get` |
| `onStatus(cb)` | `mqtt:status` |
| `onConnection(cb)` | `mqtt:connection` |
| `getHistory(limit)` | `history:get` |
| `getSettings()` | `settings:get` |
| `saveSettings(settings)` | `settings:save` |
| `openExternal(url)` | `shell:openExternal` |
| `closeDashboard()` | `dashboard:close` |
| `minimize()` | `dashboard:minimize` |

The popover opens the dashboard through `window.electron.openDashboard()`, which invokes `dashboard:open`.

### Status Payloads

`getStatus()` resolves to:

```js
{
  status: null || {
    status: 'green' | 'yellow' | 'red',
    stage: null | 'process' | 'load' | 'scrape',
    detail: string,
    lastSuccess: string, // ISO timestamp
    checkedAt: string    // ISO timestamp
  },
  connectionState: 'grey' | 'live' | 'black'
}
```

`onStatus(cb)` receives the inner status payload live whenever MQTT publishes an update. `onConnection(cb)` receives `'grey'`, `'live'`, or `'black'`.

### History Payload

`getHistory(limit)` proxies the REST API from the main process using the current settings. Dashboard code does not need the MQTT/API host or port.

The request is:

```text
GET http://<mqttHost>:3847/api/history?limit=N
```

`limit` is clamped to `1..500`. The returned value preserves the API envelope:

```js
{
  ok: true,
  results: [
    {
      status: 'green' | 'yellow' | 'red',
      stage: null | 'process' | 'load' | 'scrape',
      detail: string,
      lastSuccess: string,
      checkedAt: string
    }
  ]
}
```

On fetch failure, `getHistory(limit)` resolves to:

```js
{ ok: false, error: string }
```
