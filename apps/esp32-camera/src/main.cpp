#include <Arduino.h>
#include <ArduinoOTA.h>
#include <WiFi.h>
#include <esp_camera.h>

#include "secrets.h"

namespace {
constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 10000;
uint32_t lastWiFiAttemptAt = 0;
bool firstWiFiAttempt = true;
bool otaStarted = false;

bool initializeCamera() {
  camera_config_t cameraConfig{};
  cameraConfig.ledc_channel = LEDC_CHANNEL_0;
  cameraConfig.ledc_timer = LEDC_TIMER_0;
  cameraConfig.pin_d0 = 5;
  cameraConfig.pin_d1 = 18;
  cameraConfig.pin_d2 = 19;
  cameraConfig.pin_d3 = 21;
  cameraConfig.pin_d4 = 36;
  cameraConfig.pin_d5 = 39;
  cameraConfig.pin_d6 = 34;
  cameraConfig.pin_d7 = 35;
  cameraConfig.pin_xclk = 0;
  cameraConfig.pin_pclk = 22;
  cameraConfig.pin_vsync = 25;
  cameraConfig.pin_href = 23;
  cameraConfig.pin_sscb_sda = 26;
  cameraConfig.pin_sscb_scl = 27;
  cameraConfig.pin_pwdn = 32;
  cameraConfig.pin_reset = -1;
  cameraConfig.xclk_freq_hz = 20000000;
  cameraConfig.pixel_format = PIXFORMAT_JPEG;
  cameraConfig.frame_size = FRAMESIZE_QVGA;
  cameraConfig.jpeg_quality = 12;
  cameraConfig.fb_count = 1;

  const esp_err_t result = esp_camera_init(&cameraConfig);
  if (result != ESP_OK) {
    Serial.printf("[CAMERA] initialization failed: 0x%x\n", result);
    return false;
  }

  camera_fb_t* frame = esp_camera_fb_get();
  if (frame == nullptr) {
    Serial.println("[CAMERA] initial capture failed");
    return false;
  }

  Serial.printf("[CAMERA] ready, initial JPEG size=%u bytes\n",
                static_cast<unsigned int>(frame->len));
  esp_camera_fb_return(frame);
  return true;
}

void startWiFi() {
  if (!firstWiFiAttempt && millis() - lastWiFiAttemptAt < WIFI_RETRY_INTERVAL_MS) {
    return;
  }

  firstWiFiAttempt = false;
  lastWiFiAttemptAt = millis();
  Serial.println("[WiFi] connecting...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void startOta() {
  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.begin();
  otaStarted = true;
  Serial.printf("[OTA] ready at %s.local\n", OTA_HOSTNAME);
}
}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.printf("\n[BOOT] %s\n", DEVICE_NAME);
  initializeCamera();
  startWiFi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (otaStarted) {
      ArduinoOTA.end();
      otaStarted = false;
    }
    startWiFi();
    delay(10);
    return;
  }

  if (!otaStarted) {
    Serial.printf("[WiFi] connected, ip=%s\n", WiFi.localIP().toString().c_str());
    startOta();
  }
  ArduinoOTA.handle();
  delay(10);
}