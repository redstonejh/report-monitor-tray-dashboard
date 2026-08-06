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

### 1. Build the image in Portainer

1. Push this changed repository to a Git URL that the Portainer host can read.
2. In Portainer, open **Images** and choose **Build a new image**.
3. Name it `report-monitor-web:latest`.
4. For a public Git repository, choose the URL/upload build method, enter the
   repository URL, and set the Dockerfile path to `Dockerfile`.
5. Select the same Docker node that will run the stack and build the image.

For a private repository or a multi-node/remote environment, build the image in
CI or on another Docker machine, push it to a registry, and change the `image:`
line in `portainer-stack.yml` to that registry path.

### 2. Deploy the stack

1. Open **Stacks** and choose **Add stack**.
2. Select **Repository** and enter the changed repository's Git URL and branch.
3. Set the compose path to `portainer-stack.yml`.
4. Edit `MQTT_URL` in the stack environment, then deploy.
5. Open `http://PORTAINER-HOST:8080`.

The default compose file uses:

```yaml
MQTT_URL: mqtt://24.121.212.206:1883
```

Change that value if the broker has another address. If Mosquitto runs in the
same Docker network, use its service name, for example
`mqtt://mosquitto:1883`. Do not use `localhost` unless the broker is inside this
same container.

## Environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `8080` | Web server port inside the container |
| `MQTT_URL` | `mqtt://24.121.212.206:1883` | MQTT broker URL |
| `MQTT_USERNAME` | empty | Optional MQTT username |
| `MQTT_PASSWORD` | empty | Optional MQTT password |
| `MQTT_CLIENT_ID` | generated | Optional fixed MQTT client ID |
| `MQTT_CHECKS_TOPIC` | `+/+/checks/+` | Check subscription |
| `MQTT_CONNECTIONS_TOPIC` | `connections/#` | Connection subscription |
| `MQTT_HEARTBEATS_TOPIC` | `+/+/heartbeat` | Heartbeat subscription |
| `WEB_USERNAME` | empty | Optional HTTP Basic Auth username |
| `WEB_PASSWORD` | empty | Optional HTTP Basic Auth password |
| `ONLINE_WINDOW_MS` | `300000` | Time before a monitor is shown offline |
| `HISTORY_RETENTION_MS` | `604800000` | Raw history retention (7 days) |
| `MAX_PINGS_PER_COMPANY` | `50000` | Per-company history safety cap |

Set both `WEB_USERNAME` and `WEB_PASSWORD` before exposing the dashboard to an
untrusted network. For public HTTPS, place it behind a reverse proxy such as
Nginx Proxy Manager, Traefik, or Caddy.

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
