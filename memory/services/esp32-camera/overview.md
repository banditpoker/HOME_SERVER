# ESP32-CAM Firmware Memory

Status: active scaffold.

The project lives at `apps/esp32-camera/` and targets the AI Thinker ESP32-CAM
through PlatformIO. It initializes the camera and performs one local JPEG
capture at boot, connects to Wi-Fi, and enables password-protected ArduinoOTA.
Credentials come from a local `.env`; generated secrets are not canonical
context. Camera images are not currently exposed over HTTP or sent to another
service.