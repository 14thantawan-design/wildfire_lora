# Gateway Uplink Modes

The sensor nodes use LoRa to reach the gateway.

LoRa is only the local radio link:

```text
Sensor Node --LoRa--> Gateway
```

The gateway still needs one more uplink to reach the backend and dashboard:

```text
Gateway --Wi-Fi/cellular--> Backend --API--> Dashboard
```

## Field Mode

Use this for the real forest deployment.

Copy `gateway/secrets.example.h` to `gateway/secrets.h`, then set the private values there:

```cpp
#define WIFI_SSID "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"
#define BACKEND_API_BASE_URL "http://your-backend-host:4000/api"
#define GATEWAY_API_KEY "same-long-random-key-as-backend-env"
```

Keep `WIFI_HTTP_ENABLED 1` in `gateway/config.h`. The real `secrets.h` is ignored by Git so the Wi-Fi password and API key are not committed again.

In `wildfire-backend/.env` leave serial disabled:

```env
SERIAL_PORT=
```

The gateway receives LoRa packets and posts them directly to `POST /api/packets` using the private gateway key.
No computer or COM port is needed at the gateway site.

## GPS Re-acquire Command

The dashboard button `ค้นหา GPS ใหม่` queues a command for the selected node.
The gateway downloads pending commands and sends one immediately after that node's
next LoRa uplink, while the node is awake and listening. After receiving it, the
node clears its saved install location, starts a fresh GPS acquisition, and sends
an acknowledgement. The backend keeps the command in MongoDB until that acknowledgement
arrives, including across backend or gateway restarts.

Upload the updated sketches to both the gateway and every sensor node before using
the button. In prototype mode, the same command travels over the existing USB serial
connection instead of Wi-Fi.

## Prototype Mode

Use this only for bench testing on your laptop.

In `gateway/config.h`:

```cpp
#define WIFI_HTTP_ENABLED 0
```

In `wildfire-backend/.env`:

```env
SERIAL_PORT=COM3
```

The gateway prints LoRa packets over USB serial and the backend reads that serial port.
