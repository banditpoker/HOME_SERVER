# ESP8266 Firmware Memory

Status: active

The firmware lives at `apps/Esp32/`; the directory name is retained for
compatibility, but the configured board is NodeMCU ESP8266 (`nodemcuv2`).
PlatformIO builds the Arduino firmware and loads Wi-Fi and OTA credentials from
the local `.env` through `scripts/load_env.py`. Secrets are not part of
canonical context. Device name and OTA hostname are also loaded from `.env`, so
the same firmware can be built for multiple ESP devices with unique identity
settings.

The current firmware connects to Wi-Fi, reconnects after disconnection, and
always includes ArduinoOTA as the default firmware update path. ArduinoOTA is
initialized automatically whenever Wi-Fi is connected and accepts uploads on
UDP port 8266; there is no build flag that disables it. The firmware blinks
the built-in LED every 500 ms outside an OTA update. It has no
application-data endpoint or service-local application persistence. A small
EEPROM boot counter is used only to make Telegram notification idempotency
keys unique across reboots.

The operational feature map is
[`apps/Esp32/ESP_FEATURE_MAP.md`](../../../apps/Esp32/ESP_FEATURE_MAP.md).
