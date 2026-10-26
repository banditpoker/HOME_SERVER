#include <Arduino.h>
#include <ArduinoOTA.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <esp_camera.h>
#include <esp_system.h>

#include "secrets.h"

namespace {
constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 10000;
constexpr uint32_t TELEGRAM_RETRY_INTERVAL_MS = 10000;
constexpr uint32_t HTTP_TIMEOUT_MS = 5000;

uint32_t lastWiFiAttemptAt = 0;
uint32_t lastTelegramAttemptAt = 0;
uint32_t wifiConnectionSequence = 0;
bool wifiAttempted = false;
bool wifiConnectionActive = false;
bool telegramNotifiedForConnection = false;
bool otaStarted = false;

String notificationIdempotencyKey;

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
  cameraConfig.pin_sccb_sda = 26;
  cameraConfig.pin_sccb_scl = 27;
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

String jsonEscape(const String& value) {
  String escaped;
  escaped.reserve(value.length() + 8);
  for (size_t index = 0; index < value.length(); ++index) {
    switch (value[index]) {
      case '\\':
        escaped += "\\\\";
        break;
      case '"':
        escaped += "\\\"";
        break;
      case '\n':
        escaped += "\\n";
        break;
      case '\r':
        escaped += "\\r";
        break;
      case '\t':
        escaped += "\\t";
        break;
      default:
        escaped += value[index];
        break;
    }
  }
  return escaped;
}

String makeIdempotencyKey() {
  char key[64];
  const uint64_t macAddress = ESP.getEfuseMac() & 0xFFFFFFFFFFFFULL;
  snprintf(key, sizeof(key), "esp32cam-%012llx-%08lx-%lu",
           static_cast<unsigned long long>(macAddress),
           static_cast<unsigned long>(esp_random()),
           static_cast<unsigned long>(wifiConnectionSequence));
  return String(key);
}

bool notifyTelegram() {
  WiFiClient client;
  HTTPClient http;
  const String endpoint =
      String(TELEGRAM_GATEWAY_URL) + "/internal/messages/v1";
  if (!http.begin(client, endpoint)) {
    Serial.println("[Telegram] failed to initialize HTTP client");
    return false;
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + INTERNAL_API_TOKEN);

  const String text = String("ESP online\nDevice: ") + DEVICE_NAME +
                      "\nIP: " + WiFi.localIP().toString();
  const String payload = String("{\"idempotencyKey\":\"") +
                         jsonEscape(notificationIdempotencyKey) +
                         "\",\"chatId\":\"" + jsonEscape(TELEGRAM_CHAT_ID) +
                         "\",\"text\":\"" + jsonEscape(text) +
                         "\",\"parseMode\":\"plain\"}";

  const int statusCode = http.POST(payload);
  http.end();
  if (statusCode == HTTP_CODE_ACCEPTED || statusCode == HTTP_CODE_OK) {
    Serial.println("[Telegram] device status queued");
    return true;
  }

  Serial.printf("[Telegram] notification failed, status=%d\n", statusCode);
  return false;
}

void notifyTelegramWhenConnected() {
  if (telegramNotifiedForConnection ||
      (lastTelegramAttemptAt != 0 &&
       millis() - lastTelegramAttemptAt < TELEGRAM_RETRY_INTERVAL_MS)) {
    return;
  }

  lastTelegramAttemptAt = millis();
  if (notifyTelegram()) {
    telegramNotifiedForConnection = true;
  }
}

void startOta() {
  if (otaStarted) {
    return;
  }

  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.onStart([]() { Serial.println("[OTA] update started"); });
  ArduinoOTA.onEnd([]() { Serial.println("[OTA] update finished"); });
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[OTA] error[%u]\n", static_cast<unsigned int>(error));
  });
  ArduinoOTA.begin();
  otaStarted = true;
  Serial.printf("[OTA] ready at %s.local\n", OTA_HOSTNAME);
}

void startWiFiConnection() {
  wifiAttempted = true;
  lastWiFiAttemptAt = millis();
  Serial.println("[WiFi] connecting...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void maintainWiFi() {
  const uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (wifiConnectionActive) {
      wifiConnectionActive = false;
      telegramNotifiedForConnection = false;
      notificationIdempotencyKey = "";
      if (otaStarted) {
        ArduinoOTA.end();
        otaStarted = false;
      }
      Serial.println("[WiFi] disconnected");
    }

    if (!wifiAttempted || now - lastWiFiAttemptAt >= WIFI_RETRY_INTERVAL_MS) {
      startWiFiConnection();
    }
    return;
  }

  if (!wifiConnectionActive) {
    wifiConnectionActive = true;
    ++wifiConnectionSequence;
    lastTelegramAttemptAt = 0;
    telegramNotifiedForConnection = false;
    notificationIdempotencyKey = makeIdempotencyKey();
    Serial.printf("[WiFi] connected, ip=%s\n",
                  WiFi.localIP().toString().c_str());
    startOta();
  }

  ArduinoOTA.handle();
  notifyTelegramWhenConnected();
}
}  // namespace

void loop() {
  maintainWiFi();
  delay(10);
}

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.printf("[BOOT] %s starting\n", DEVICE_NAME);
  initializeCamera();
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  startWiFiConnection();
}
