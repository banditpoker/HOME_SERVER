# ESP8266 Firmware Memory

Status: active

The firmware lives at `apps/Esp32/`; the directory name is retained for
compatibility, but the configured board is NodeMCU ESP8266 (`nodemcuv2`).
PlatformIO builds the Arduino firmware and loads Wi-Fi and OTA credentials from
the local `.env` through `scripts/load_env.py`. Secrets are not part of
canonical context.

The current firmware connects to Wi-Fi, reconnects after disconnection,
accepts ArduinoOTA uploads on UDP port 8266, and blinks the built-in LED every
500 ms outside an OTA update. It has no application-data endpoint, persistence,
or service dependency.

The operational feature map is
[`apps/Esp32/ESP_FEATURE_MAP.md`](../../../apps/Esp32/ESP_FEATURE_MAP.md).
