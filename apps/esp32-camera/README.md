# ESP32-CAM Firmware

Independent PlatformIO firmware for the AI Thinker ESP32-CAM. It initializes
the camera, validates one JPEG capture at boot, connects to Wi-Fi, and enables
password-protected ArduinoOTA after connecting.

See [ESP_FEATURE_MAP.md](ESP_FEATURE_MAP.md) for the current scope and local
setup steps. Camera images are not served over HTTP or sent to another service.