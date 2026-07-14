# Wildfire Backend

Node.js API for the Wildfire LoRa project.

The backend stores node status and sensor history in MongoDB and exposes API endpoints for the dashboard.

There are two supported uplink modes:

- Field mode: Gateway posts LoRa packets over Wi-Fi or cellular to `POST /api/packets`.
- Prototype mode: Gateway prints LoRa packets over USB serial and this backend reads that serial port.

For the real forest deployment, use field mode. USB serial is only a bench-test bridge.

## Requirements

- Node.js 20+
- MongoDB running locally or in the cloud
- Gateway with Wi-Fi/cellular access to this backend, or USB serial for bench testing only

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
SERIAL_PORT=
SERIAL_BAUD=115200
OFFLINE_TIMEOUT_MS=60000
```

Leave `SERIAL_PORT` empty for field mode. Set it only for prototype mode, for example `SERIAL_PORT=COM3` on Windows.

## Run

```bash
npm run dev
```

Expected logs:

```text
connected MongoDB: wildfire_lora
API running: http://localhost:4000
serial disabled: SERIAL_PORT is not set
```

or, in prototype mode:

```text
serial bridge started: COM3 @ 115200
```

## API

- `GET /api/health`
- `GET /api/nodes`
- `GET /api/nodes/:node_id`
- `GET /api/readings/latest`
- `GET /api/readings/:node_id?limit=100`
- `GET /api/alerts`
- `GET /api/alerts/active`
- `POST /api/packets`

## Test Without Gateway

```bash
curl -X POST http://localhost:4000/api/packets ^
  -H "Content-Type: application/json" ^
  -d "{\"t\":\"s\",\"id\":\"NODE01\",\"q\":12,\"st\":\"NORMAL\",\"c\":20,\"at\":31.2,\"h\":55.4,\"sm\":120,\"sd\":20,\"sr\":80,\"ar\":1.2,\"hr\":-3.1,\"sh\":\"OK\"}"
```

GPS test:

```bash
curl -X POST http://localhost:4000/api/packets ^
  -H "Content-Type: application/json" ^
  -d "{\"t\":\"gps\",\"id\":\"NODE01\",\"q\":5,\"la\":13.123456,\"ln\":100.123456,\"sat\":7,\"hd\":1.2,\"gf\":1}"
```

## Serial Line Handling

The serial bridge accepts direct JSON lines:

```json
{"t":"s","id":"NODE01","q":12,"st":"NORMAL"}
```

It also accepts gateway debug lines that contain `payload=`:

```text
RAW LoRa bytes=173 payload={"t":"s","id":"NODE01","q":12,"st":"NORMAL"}
```

Non-JSON serial lines are ignored and will not crash the server.
