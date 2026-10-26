# ESP32-CAM Firmware Memory

Status: active firmware service; hardware validation pending.

The project lives at `apps/esp32-camera/` and targets the AI Thinker ESP32-CAM
through PlatformIO. It initializes the camera and performs one local JPEG
capture at boot, connects to Wi-Fi, sends its device name and current IP through
the Telegram gateway v1 internal-message contract, and enables
password-protected ArduinoOTA. Credentials come from a local `.env`; generated
secrets are not canonical context. Camera images are not exposed over HTTP.