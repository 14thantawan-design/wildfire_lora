#pragma once

// Starts WiFiManager and opens its setup portal when no credentials are saved.
void beginWifiProvisioning();

// Services the non-blocking portal, connection state, and setup button.
void serviceWifiProvisioning();
