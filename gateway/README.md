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

In `gateway/config.h` set:

```cpp
#define WIFI_HTTP_ENABLED 1
#define WIFI_SSID "your-wifi-name"
#define WIFI_PASSWORD "your-wifi-password"
#define BACKEND_PACKETS_URL "http://your-backend-host:4000/api/packets"
```

In `wildfire-backend/.env` leave serial disabled:

```env
SERIAL_PORT=
```

The gateway receives LoRa packets and posts them directly to `POST /api/packets`.
No computer or COM port is needed at the gateway site.

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
