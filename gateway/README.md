# Gateway

The sensor nodes use LoRa to reach the gateway.

## Code structure

`gateway.ino` keeps `setup()` and `loop()` visible. The remaining code is split
by responsibility, and every function has a short explanation above it:

- `gateway_state.h` - GPS command state
- `gateway_helpers.h` - small general helpers
- `backend_http.h` - Wi-Fi/HTTPS requests to the Backend
- `lora_radio.h` - LoRa initialization
- `gateway_commands.h` - pending command queue and node downlinks
- `network_task.h` - background GPS command work
- `packet_processing.h` - GPS commands and direct packet forwarding
- `wifi_provisioning.h/.cpp` - WiFiManager setup portal and reconnection

LoRa is only the local radio link:

```text
Sensor Node --LoRa--> Gateway
```

The gateway still needs one more uplink to reach the backend and dashboard:

```text
Gateway --Wi-Fi/cellular--> Backend --API--> Dashboard
```

## Backend and Wi-Fi

Copy `gateway/secrets.example.h` to `gateway/secrets.h`, then set the backend values there:

```cpp
#define BACKEND_API_BASE_URL "http://your-backend-host:4000/api"
#define GATEWAY_API_KEY "same-long-random-key-as-backend-env"
```

Keep `WIFI_HTTP_ENABLED 1` in `gateway/config.h`. The real `secrets.h` is ignored by Git so the API key is not committed.

Wi-Fi credentials are configured from a phone and saved in the ESP32 NVS instead
of being compiled into the firmware. The Gateway uses the `WiFiManager` library
in non-blocking mode so the setup page does not replace the LoRa receive loop:

1. Power on the Gateway.
2. On first boot, connect a phone to the Wi-Fi network whose name starts with
   `Wildfire-Gateway-`. This temporary setup network is open and has no password.
3. The setup page should open automatically. If it does not, browse to
   `http://192.168.4.1`.
4. Select the site Wi-Fi, enter its password, and press **Save**.
5. The setup network closes, the Gateway connects, and the saved Wi-Fi is used
   automatically after restarts or brief outages.

To change the Wi-Fi later, wait until the Gateway has booted and then hold the
TTGO **BOOT** button for 5 seconds. The setup network will open again. If the
saved Wi-Fi remains unavailable for 2 minutes, the Gateway also opens the setup
network for 10 minutes. It then retries the saved Wi-Fi before reopening the
setup network if the outage continues. On first boot, the setup network stays
open until Wi-Fi has been configured.

The setup AP name, button pin, and timeouts can be changed in `gateway/config.h`.
GPIO 0 is used because it is the TTGO BOOT button; do not
hold it while powering on or resetting the board, because that selects the ESP32
firmware-download mode.

Remove any old `WIFI_SSID` and `WIFI_PASSWORD` definitions from `secrets.h`.
They are not used by WiFiManager and should not remain in the
installation's source configuration.

Install WiFiManager version 2.0.17 or newer from Arduino Library Manager before
compiling the Gateway.

The Gateway does not keep a fixed-size node table. It posts every received node
packet directly to `POST /api/packets` using the private gateway key.
Backend and MongoDB store each sensor packet as a reading and manage current
node status and offline detection. Repeated packets create repeated readings.
No computer or COM port is needed at the gateway site.

## GPS Re-acquire Command

The dashboard button `ค้นหา GPS ใหม่` queues a command for the selected node.
The gateway checks pending commands every 30 seconds and sends one immediately after that node's
next LoRa uplink, while the node is awake and listening. After receiving it, the
node clears its saved install location, starts a fresh GPS acquisition, and sends
an acknowledgement. The backend keeps the command in MongoDB until that acknowledgement
arrives, including across backend or gateway restarts.

Upload the updated sketches to both the gateway and every sensor node before using
the button. Commands travel between the Gateway and Backend over Wi-Fi/HTTP.
