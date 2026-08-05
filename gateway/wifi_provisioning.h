#pragma once

// Starts the saved-Wi-Fi connection manager and, when no credentials exist,
// opens the captive setup portal immediately.
void beginWifiProvisioning();

// Must be called frequently from loop(). It services the captive portal,
// reconnects Wi-Fi without blocking LoRa reception, and watches the setup button.
void serviceWifiProvisioning();

