# ESP32-CAM Feature Map

Firmware for the AI Thinker ESP32-CAM using PlatformIO and Arduino.

## Current features

| Feature | Status | Notes |
|---|---|---|
| Camera initialization | In code; hardware check pending | AI Thinker pin map, QVGA JPEG |
| Camera smoke test | In code; hardware check pending | Captures one frame at boot, logs its size, then releases it |
| Wi-Fi station | In code; hardware check pending | Retries connection and reports the current IP |
| Telegram status message | In code; gateway check pending | Sends device name and IP through `/internal/messages/v1` |
| ArduinoOTA | In code; hardware check pending | Password-protected, starts after Wi-Fi connects |
| HTTP image endpoint or stream | Not enabled | Camera images are not exposed over the network |

## Local setup

1. Copy `.env.example` to `.env` and set the Wi-Fi, OTA, and Telegram Gateway
   values. Do not commit `.env` or generated `include/.env.secrets.h`.
2. Connect the ESP32-CAM to a USB-to-serial adapter and use the correct boot
   mode for the initial upload.
3. Build with `pio run -e esp32cam` and upload over USB with
   `pio run -e esp32cam --target upload`.
4. Open `pio device monitor -e esp32cam` and check the camera, Wi-Fi, IP,
   Telegram, and OTA status logs.
5. After USB upload and Wi-Fi setup, use
   `pio run -e esp32cam-ota --target upload` for OTA. The device must be
   reachable by `OTA_HOSTNAME.local` and its OTA password must match `.env`.

The serial profile uses `COM7` for the current Windows setup. Change the
PlatformIO port if using a different computer or adapter.