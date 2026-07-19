#pragma once

// Copy this file to secrets.h and fill in values for this installation.
#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define BACKEND_API_BASE_URL "https://wildfire.nattaphat.me/api"

// Paste the PEM root CA that signs the Cloudflare edge certificate.
// Keep this empty while BACKEND_API_BASE_URL still uses local HTTP.
// Never use setInsecure() for field deployment.
#define BACKEND_ROOT_CA ""
#define GATEWAY_API_KEY "PASTE_THE_SAME_KEY_AS_BACKEND_ENV"

