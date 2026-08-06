# Report Monitor web dashboard

This repository now includes a web gateway for the Electron dashboard. The
container connects to MQTT over normal TCP, serves the existing dashboard on
port `8080`, and relays live updates to browsers. Browser layout choices remain
in each browser's local storage; collected MQTT history is stored in `/data`.

## Portainer deployment

Portainer's support for `build:` inside Git-deployed Compose stacks is limited,
especially when Portainer manages a remote Docker environment. The reliable
flow is to build the image first and then deploy `portainer-stack.yml`, which
contains only an `image:` reference.

### 1. Build the two local images in Portainer

1. Push this changed repository to a Git URL that the Portainer host can read.
2. In Portainer, open **Images** and choose **Build a new image**.
3. Name it `report-monitor-web:latest`.
4. For a public Git repository, choose the URL/upload build method, enter the
   repository URL, and set the Dockerfile path to `Dockerfile`.
5. Select the same Docker node that will run the stack and build the image.
6. Repeat the image build with the name `report-monitor-api:latest` and the
   Dockerfile path `status-monitor-api/Dockerfile`.

For a private repository or a multi-node/remote environment, build the image in
CI or on another Docker machine, push it to a registry, and change the `image:`
lines in `portainer-stack.yml` to those registry paths.

### 2. Deploy the stack

1. Open **Stacks** and choose **Add stack**.
2. Select **Repository** and enter the changed repository's Git URL and branch.
3. Set the compose path to `portainer-stack.yml`.
4. Set any site-specific paths, credentials, or topic overrides listed below,
   then deploy. The checked-in defaults already use the internal service URL
   `mqtt://mqtt:1883`.
5. Open `http://PORTAINER-HOST:8080`.

`portainer-stack.yml` is a complete stack with these services:

- `mqtt` — Eclipse Mosquitto on TCP port `1883`
- `report-monitor-api` — the status checker and REST API on port `3847`
- `report-monitor-web` — the browser dashboard on port `8080`

The Portainer Compose file has no `build:` directives. It expects the two local
images from step 1 to exist on the target Docker node.

## Web environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `8080` | Web server port inside the container |
| `DATA_DIR` | `/data` | Persistent dashboard history directory |
| `CLIENTS_CONFIG` | `/data/clients.json` | Optional company-grouping override |
| `MQTT_URL` | `mqtt://mqtt:1883` in Portainer | MQTT broker URL |
| `MQTT_USERNAME` | empty | Optional MQTT username |
| `MQTT_PASSWORD` | empty | Optional MQTT password |
| `MQTT_CLIENT_ID` | generated | Optional fixed MQTT client ID |
| `MQTT_CHECKS_TOPIC` | `+/+/checks/+` | Check subscription |
| `MQTT_CONNECTIONS_TOPIC` | `connections/#` | Connection subscription |
| `MQTT_HEARTBEATS_TOPIC` | `+/+/heartbeat` | Heartbeat subscription |
| `MQTT_STATUS_TOPIC` | `+/+/status` | API status subscription |
| `MQTT_RECONNECT_MS` | `15000` | MQTT reconnect delay |
| `STATUS_API_URL` | empty | Optional REST history source |
| `STATUS_API_SYSTEM` | `api/status-monitor-api` | Identity used for API history |
| `STATUS_API_LABEL` | system identity | Dashboard label for API history |
| `STATUS_API_POLL_MS` | `60000` | REST history refresh interval |
| `WEB_USERNAME` | empty | Optional HTTP Basic Auth username |
| `WEB_PASSWORD` | empty | Optional HTTP Basic Auth password |
| `ONLINE_WINDOW_MS` | `300000` | Time before a monitor is shown offline |
| `LEGACY_STATUS_ONLINE_MS` | `86400000` | Online window for periodic API status |
| `HISTORY_RETENTION_MS` | `604800000` | Raw history retention (7 days) |
| `MAX_PINGS_PER_COMPANY` | `50000` | Per-company history safety cap |

Set both `WEB_USERNAME` and `WEB_PASSWORD` before exposing the dashboard to an
untrusted network. For public HTTPS, place it behind a reverse proxy such as
Nginx Proxy Manager, Traefik, or Caddy.

## API environment variables

The API image reads these names directly from `status-monitor-api/src/config.js`:

| Variable | Portainer default | Purpose |
|---|---:|---|
| `PROJECT_ID` | `report-monitor` | First MQTT topic segment |
| `SYSTEM_ID` | `server` | Second MQTT topic segment |
| `MQTT_BROKER_HOST` | `mqtt` | Broker service name |
| `MQTT_BROKER_PORT` | `1883` | Broker TCP port |
| `MQTT_WS_PORT` | `9001` | Included in legacy share codes |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | empty | Optional broker credentials |
| `API_PORT` | `3847` | REST API port |
| `API_CORS_ORIGIN` | dashboard URL | Allowed browser origin |
| `HISTORY_DB_PATH` | `/data/history.db` | Persistent check-history database |
| `CHECK_CRON` | `*/10 * * * *` | Check schedule |
| `GREEN_THRESHOLD_HOURS` | `26` | Freshness threshold |
| `DB_PATH` | empty | Optional monitored SQLite database |
| `DB_TABLE` | `StatusRecords` | Source table |
| `DB_DATE_COLUMN` | `RecordDate` | Source date column |
| `BASE_PATH` | `/source` | Root of monitored source folders |
| `RAW_DATA_PATH` | `raw` | Raw-data folder under `BASE_PATH` |
| `ARCHIVED_DATA_PATH` | `archive` | Archive folder |
| `REPORT_WORK_PATH` | `reports/work` | Working-report folder |
| `REPORT_SUMMARY_PATH` | `reports/summary` | Summary-report folder |
| `REPORT_FINAL_PATH` | `reports/final` | Final-report folder |
| `SOURCE_LOG_PATH` | `logs` | Source log folder |
| `RAW_DATA_EXTENSIONS` | `.csv,.log,.txt` | Raw file extensions |
| `REPORT_EXTENSIONS` | `.xlsx,.xls,.txt,.pdf` | Report extensions |

## Custom company grouping

The image includes `status-monitor-client/clients.json`. To override it in
Portainer, bind-mount another file to `/data/clients.json`; it is read when the
container starts.

## Local Docker deployment

```bash
docker compose up --build
```

Health endpoint:

```bash
curl http://localhost:8080/healthz
```
