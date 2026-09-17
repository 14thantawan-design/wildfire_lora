# Wildfire Backend

Node.js API for the Wildfire LoRa project.

The backend receives packets from the Gateway over Wi-Fi/HTTP, stores node status
and sensor history in MongoDB, and exposes API endpoints for the dashboard.

Risk is calculated only by sensor firmware. For current risk model 8, the backend
copies packet `st` into `state`. It validates packet version `rv: 8` but does not
recalculate the thresholds or store duplicated reason fields. Sensor packets from
any other model version are rejected. The dashboard uses current online node states, while
alert records keep the peak state of an event.

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

- A new `WATCH`, `WARNING`, or `SENSOR_FAULT` alert sends one message.
- An active alert sends another message only when its level increases.
- Repeated readings at the same level do not send duplicate messages.
- If Telegram is temporarily unreachable, the next reading retries the unsent alert.
- A firmware-confirmed `NORMAL` closes the alert and sends one resolved message.
  Firmware already waits for three clean measurement cycles; the backend does not wait again.
- `NORMAL` without an active alert does not send a message.

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

The Node list keeps known Nodes visible and marks each one online or offline from its heartbeat. The backend accepts the whole-second report interval sent by firmware instead of assigning one by risk state. A Node is offline after no data arrives for two expected report intervals. When a Node sends again, it returns online automatically without configuration changes or deleting history.

## Test Without Gateway

```bash
curl -X POST http://localhost:4000/api/packets ^
  -H "Content-Type: application/json" ^
  -H "X-Gateway-Key: replace-with-your-gateway-key" ^
  -d "{\"t\":\"s\",\"id\":\"NODE01\",\"q\":12,\"sid\":1234,\"ri\":300,\"st\":\"NORMAL\",\"rv\":8,\"at\":31.2,\"h\":55.4,\"pm\":20,\"sh\":\"OK\"}"
```

GPS test:

```bash
curl -X POST http://localhost:4000/api/packets ^
  -H "Content-Type: application/json" ^
  -H "X-Gateway-Key: replace-with-your-gateway-key" ^
  -d "{\"t\":\"gps\",\"id\":\"NODE01\",\"q\":5,\"sid\":1234,\"la\":13.123456,\"ln\":100.123456,\"gf\":1}"
```
