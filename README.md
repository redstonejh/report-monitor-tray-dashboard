# Report Monitor — Tray + Dashboard

A desktop monitoring system for a data pipeline / reporting workflow. A lightweight
**system-tray app** shows an at-a-glance green / yellow / red health status; clicking
through opens a full **liquid-glass dashboard** for detailed visualization. Both are
driven by the same backend — a Node **status API** that runs health checks and
publishes status over **MQTT**.

> Status at a glance in the tray, depth on demand in the dashboard — one backend, one status stream.

## What it does

- A backend service periodically checks whether a source system's data is current
  (database freshness, plus raw-data / report-output / log activity) and derives a
  single **green / yellow / red** status with a human-readable reason.
- It publishes that status as a **retained MQTT message** and serves a small **REST
  API** (current status, recent history, server info).
- A cross-platform **Electron tray client** subscribes to the status and shows it as a
  minimal, Apple-style liquid-glass popover. From there you open an embedded
  **dashboard** — a draggable / resizable widget builder (charts, tables, maps, stats)
  — that populates from the same live status and check history.

## Architecture

```
 Source machine
  ┌─────────────────────────────────────────────┐
  │  status-monitor-api  (Node)                  │
  │   • health checks (DB / files / reports)     │
  │   • SQLite check history                      │
  │   • REST API  :3847  (/api/status|history)    │
  │   • publishes a retained status  ──┐          │
  └────────────────────────────────────┼─────────┘
                                        ▼
                                MQTT broker (1883)
                                        ▲
  ┌─────────────────────────────────────┼────────┐
  │  status-monitor-client (Electron)    │        │
  │   • tray popover  ──── subscribes ───┘        │
  │   • embedded dashboard (shares the same       │
  │     MQTT + REST data via the main process)    │
  └───────────────────────────────────────────────┘
 Client machine(s)
```

The tray popover and the dashboard run in the **same Electron process** and share one
MQTT subscription and one REST proxy (in the main process) — the dashboard never opens
its own connection.

## Repository layout

```
status-monitor-api/      Node service: checker + MQTT publisher + REST API + SQLite history
status-monitor-client/   Electron app: system-tray popover (React) + embedded dashboard
  electron/              main process; tray, dashboard, and persistence preload bridges
  src/                   tray popover UI (React, liquid-glass)
  dashboard/             embedded dashboard builder (HTML/CSS/JS) + vendored libraries
.env.example             API configuration template
```

## The tray popover

- Minimal, white-on-glass design: the **status condition is centered** (a colored ring
  + one-word state), with a single supporting line and a timestamp — no repeated labels
  or chrome.
- **Peek on hover**, expand on click; interacting pins it open.
- Inherits the dashboard's **WebGL liquid-glass** material and chosen background.
- Connect by pasting a **share code** (printed by the API on startup), or enter the
  broker host / topic IDs manually.

## The dashboard

- A full dashboard builder embedded as the "details" view, opened from the popover's
  top bar.
- Draggable / resizable panels and widgets, grid snapping, collision reflow, per-object
  recolor / pin / rename, layout save / load, and undo.
- Live status data is fed in automatically: a **top-right glass status indicator**
  (hover for full detail), stat counters (checks / healthy / warnings / errors), and a
  status-timeline chart. Any data widget you add sees the check history as its default
  source.
- One always-on liquid-glass material refracts the chosen photo / tone background.

## Status logic

| Status | Meaning |
|---|---|
| 🟢 Green | Source is current — the latest record is within the freshness threshold. |
| 🟡 Yellow | A pipeline stage needs attention — raw data or report output is recent, but the database was not updated. |
| 🔴 Red | Source is stale or missing — no recent data, report output, or log activity detected. |

## Setup

### 1. MQTT broker

Install an MQTT broker (e.g. Mosquitto) on the machine that runs the API, with a TCP
listener on `1883` (and a websocket listener on `9001` if web clients are needed).
`allow_anonymous true` is fine for a simple deployment.

### 2. API

```bash
cd status-monitor-api
npm install
cp ../.env.example ../.env     # set DB_PATH, source folders, thresholds, MQTT host
npm start
```

On first run it generates topic IDs and prints a **share code** to paste into the client.

### 3. Client

```bash
cd status-monitor-client
npm install
npm start
```

Open the tray popover → **Settings** → paste the share code. The tray turns green /
yellow / red, and the up-arrow at the top of the popover opens the dashboard. Build a
distributable with `npm run make` (Electron Forge).

## How the integration works

`dashboard/app/static/status-feed.js` bridges the tray's live monitor data into the
dashboard: it subscribes to the same `mqtt:status` / `mqtt:connection` pushes, fetches
check history through the main-process REST proxy, drives the top-right status
indicator, and ingests rows into the dashboard's widget data runtime so the counters,
chart, and any user-added data widget populate from real data. See
`status-monitor-client/README.md` for the full contract.

## Security

The dashboard window loads over `file://` **and** exposes a `node:fs` persistence
bridge, so it must never execute remote code. All visualization libraries (ECharts,
Leaflet, TanStack Table, FullCalendar, flatpickr, Monaco) are **vendored locally** under
`dashboard/app/static/vendor/`, and a **Content-Security-Policy** forbids remote script
— only local `self` / `file:` / `blob:` sources are allowed. Remote *data* that cannot
execute (OpenStreetMap tiles, YouTube / Vimeo embeds) stays permitted. Details in
`status-monitor-client/README.md`.

## REST API

Served on `http://<api-host>:3847`:

| Endpoint | Description |
|---|---|
| `GET /ping` | Health check. |
| `GET /api/status` | Current check result + MQTT connection state. |
| `GET /api/history?limit=N` | Recent check history (max 500). |
| `GET /api/info` | Server info and the client share code. |

## License

See [`LICENSE.md`](./LICENSE.md).
