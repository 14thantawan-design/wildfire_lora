# Wildfire Backend

Node.js API for the Wildfire LoRa project.

The backend receives packets from the Gateway over Wi-Fi/HTTP, stores node status
and sensor history in MongoDB, and exposes API endpoints for the dashboard.

Risk is calculated only by sensor firmware. The backend copies packet `st` and
`c` into `state` and `risk_score`; `risk_source: "node"` and
`risk_model_version` identify the origin and packet `rv` (absent means version 1).
There is no backend risk engine or sensor-history scoring query.
Old records are read through `nodeRisk.js`, preferring their original node
decision; no history is rewritten or deleted. Old server fields remain in the
schema for reading existing data but are neither generated nor returned as
current risk fields. The dashboard uses current online node states, while alert
records keep the historical peak of an event.

## Requirements

- Node.js 20+
- MongoDB running locally or in the cloud
- Gateway with Wi-Fi access to this backend

## Install

```bash
cd wildfire-backend
npm install
copy .env.example .env
```

Edit `.env`:

```bash
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/wildfire_lora
OFFLINE_TIMEOUT_MS=60000
GATEWAY_OFFLINE_TIMEOUT_MS=30000
GATEWAY_API_KEY=replace-with-a-long-random-key
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
ADMIN_HOSTNAME=admin.example.com
CF_ACCESS_TEAM_DOMAIN=https://your-team-name.cloudflareaccess.com
CF_ACCESS_AUD=replace-with-the-application-audience-tag
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_DASHBOARD_URL=https://wildfire.nattaphat.me
TELEGRAM_TIMEZONE=Asia/Bangkok
```

`GATEWAY_API_KEY` must be the same value as `GATEWAY_API_KEY` in `gateway/secrets.h`. Keep both files private. Administrative routes accept local development requests or a valid Cloudflare Access JWT for `ADMIN_HOSTNAME`. Set the team domain and the application's Audience (AUD) tag above, and manage administrator email addresses only in the Cloudflare Access policy.

## Telegram Channel Notifications

Telegram notifications follow the states already confirmed by the firmware:

- A new `WATCH`, `WARNING`, `CRITICAL`, or `SENSOR_FAULT` alert sends one message.
- An active alert sends another message only when its level increases.
- Repeated readings at the same level do not send duplicate messages.
- If Telegram is temporarily unreachable, the next reading retries the unsent alert.
- A firmware-confirmed `NORMAL` closes the alert and sends one resolved message.
  Firmware already waits for three clean measurement cycles; the backend does not wait again.
  Only legacy records without a node decision use the old distinct-reading fallback.
- `CALIBRATING` and `NORMAL` without an active alert do not send messages.

Setup:

1. Open `@BotFather` in Telegram, run `/newbot`, and securely copy the bot token.
2. Create a public Telegram Channel and choose a public username, for example `@WildfireLoraAlerts`.
3. Add the bot to the Channel as an administrator and allow it to post messages.
4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID=@YourChannelUsername` in `.env`.
5. Send a harmless connection test:

```bash
npm run telegram:test
```

Restart the backend after changing `.env`. The health endpoint exposes only `telegram_configured: true` or `false`; it never exposes the bot token. Keep `.env` private and never commit or paste the bot token into source code.

## Run

```bash
npm run dev
```

Expected logs:

```text
connected MongoDB: wildfire_lora
API running: http://localhost:4000
```

## API

- `GET /api/health`
- `GET /api/nodes`
- `GET /api/nodes/:node_id`
- `GET /api/readings/latest`
- `GET /api/readings/:node_id?limit=100`
- `GET /api/alerts`
- `GET /api/alerts/active`
- `POST /api/packets` (requires `X-Gateway-Key`)
- `GET /api/commands/pending` (requires `X-Gateway-Key`)
- `POST /api/commands/:command_id/sent` (requires `X-Gateway-Key`)
- `POST /api/commands/:command_id/ack` (requires `X-Gateway-Key`)

GPS commands are stored in MongoDB until the Sensor Node acknowledges them, so restarting the backend or Gateway does not silently lose a pending command.

Saving a manual location also queues `gps_manual`. On its next uplink, the Node
turns off GPS and persists manual-location mode. `gps_reacquire` clears that mode
and starts the physical GPS again. GPS acquisition never shortens the sensor's
normal measurement/report interval.

The Node list keeps known Nodes visible and marks each one online or offline from its heartbeat. The default timeout is 2.5 report intervals plus 30 seconds, so one missed report is tolerated. When a Node sends again, it returns online automatically without configuration changes or deleting history.

## Test Without Gateway

```bash
curl -X POST http://localhost:4000/api/packets ^
  -H "Content-Type: application/json" ^
  -H "X-Gateway-Key: replace-with-your-gateway-key" ^
  -d "{\"t\":\"s\",\"id\":\"NODE01\",\"q\":12,\"st\":\"NORMAL\",\"c\":20,\"at\":31.2,\"h\":55.4,\"sm\":120,\"sd\":20,\"sr\":80,\"ar\":1.2,\"hr\":-3.1,\"sh\":\"OK\"}"
```

GPS test:

```bash
curl -X POST http://localhost:4000/api/packets ^
  -H "Content-Type: application/json" ^
  -H "X-Gateway-Key: replace-with-your-gateway-key" ^
  -d "{\"t\":\"gps\",\"id\":\"NODE01\",\"q\":5,\"la\":13.123456,\"ln\":100.123456,\"sat\":7,\"hd\":1.2,\"gf\":1}"
```
