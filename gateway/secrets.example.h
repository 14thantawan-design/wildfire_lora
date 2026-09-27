#pragma once

// Copy this file to secrets.h and fill in values for this installation.
// Wi-Fi is selected from a phone through the Gateway setup portal and is saved
// in ESP32 NVS, so SSID and password do not belong in this file.
// Paste the PEM root CA that signs the Cloudflare edge certificate.
// The Gateway connects to https://wildfire.nattaphat.me.
// Never use setInsecure() for field deployment.
#define BACKEND_ROOT_CA ""
#define GATEWAY_API_KEY "PASTE_THE_SAME_KEY_AS_BACKEND_ENV"

