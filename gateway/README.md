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

Copy `gateway/secrets.example.h` to `gateway/secrets.h`, then set the backend values there:

```cpp
#define BACKEND_API_BASE_URL "http://your-backend-host:4000/api"
#define GATEWAY_API_KEY "same-long-random-key-as-backend-env"
```

Keep `WIFI_HTTP_ENABLED 1` in `gateway/config.h`. The real `secrets.h` is ignored by Git so the API key is not committed.

Wi-Fi credentials are configured from a phone and saved in the ESP32 NVS instead
of being compiled into the firmware:

1. Power on the Gateway.
2. On first boot, connect a phone to the Wi-Fi network whose name starts with
   `Wildfire-Gateway-`. The default setup password is `wildfire-setup`.
3. The setup page should open automatically. If it does not, browse to
   `http://192.168.4.1`.
4. Select the site Wi-Fi, enter its password, and press **บันทึกและเชื่อมต่อ**.
5. After a successful connection, the setup network closes and the Gateway
   reconnects to the saved Wi-Fi automatically after restarts or brief outages.

To change the Wi-Fi later, wait until the Gateway has booted and then hold the
TTGO **BOOT** button for 5 seconds. The setup network will open again. If the
saved Wi-Fi remains unavailable for 2 minutes, the Gateway also opens the setup
network automatically for 10 minutes while continuing reconnection attempts.

The setup AP password, button pin, and timeouts can be changed in
`gateway/config.h`. GPIO 0 is used because it is the TTGO BOOT button; do not
hold it while powering on or resetting the board, because that selects the ESP32
firmware-download mode.

Remove any old `WIFI_SSID` and `WIFI_PASSWORD` definitions from `secrets.h`.
They are not used by the new connection manager and should not remain in the
installation's source configuration.

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
the button. Commands travel between the Gateway and Backend over Wi-Fi/HTTP.
