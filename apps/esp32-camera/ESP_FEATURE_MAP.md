# ESP32-CAM Feature Map

Firmware scaffold for an AI Thinker ESP32-CAM using PlatformIO and Arduino.

## Current features

| Feature | Status | Notes |
|---|---|---|
| Camera initialization | Implemented | AI Thinker pin map; QVGA JPEG |
| Camera smoke test | Implemented | Captures one frame at boot, logs its size, then releases it |
| Wi-Fi station | Implemented | Credentials loaded from local `.env`; retries after disconnect |
| ArduinoOTA | Implemented | Starts after Wi-Fi connects; password loaded from local `.env` |
| HTTP image endpoint or stream | Not enabled | No camera image is exposed over the network |
| Telegram or application data | Not implemented | This device currently has no HOME_SERVER application contract |

## Local setup

1. Copy `.env.example` to `.env` and set Wi-Fi and OTA credentials.
2. Connect the ESP32-CAM to a USB-to-serial adapter and select the correct boot
   mode for flashing.
3. Run `pio run` to build and `pio run --target upload` for the initial serial
   upload.
4. Open the monitor with `pio device monitor --baud 115200` and check for
   `[CAMERA] ready` and `[OTA] ready`.
5. After confirming the device is reachable on the local network, use
   `pio run -e esp32cam-ota --target upload` for password-protected OTA.

Do not commit `.env` or generated `include/.env.secrets.h`. The default upload
protocol is serial. The separate OTA environment uses `OTA_HOSTNAME` from the
local `.env` and passes `OTA_PASSWORD` only to the OTA uploader.