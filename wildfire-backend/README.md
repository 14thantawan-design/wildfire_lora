# Wildfire Backend

Node.js API and serial bridge for the Wildfire LoRa project.

The TTGO Gateway prints LoRa packets over USB serial. This backend reads those packets, stores node status and sensor history in MongoDB, and exposes API endpoints for the future dashboard.

## Requirements

- Node.js 20+
- MongoDB running locally or in the cloud
- Gateway board connected over USB serial, optional

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
SERIAL_PORT=COM3
SERIAL_BAUD=115200
OFFLINE_TIMEOUT_MS=60000
```

If `SERIAL_PORT` is empty, the API still runs and the serial bridge is disabled.

## Run

```bash
npm run dev
```

Expected logs:

```text
connected MongoDB: wildfire_lora
API running: http://localhost:4000
serial bridge started: COM3 @ 115200
```

or, when serial is disabled:

```text
serial disabled: SERIAL_PORT is not set
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
