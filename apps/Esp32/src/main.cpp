#include <Arduino.h>
#include <ArduinoOTA.h>
#include <EEPROM.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WiFi.h>

#include "secrets.h"

namespace {
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 25000;
constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 10000;
constexpr uint32_t BLINK_INTERVAL_MS = 500;
constexpr uint32_t TELEGRAM_RETRY_INTERVAL_MS = 10000;
constexpr uint8_t EEPROM_SIZE = 8;
constexpr int EEPROM_BOOT_COUNTER_ADDRESS = 0;

uint32_t lastWiFiAttemptAt = 0;
uint32_t lastBlinkAt = 0;
uint32_t bootSequence = 0;
uint32_t lastTelegramAttemptAt = 0;
uint32_t wifiConnectionSequence = 0;
bool otaStarted = false;
bool otaInProgress = false;
bool wifiConnectionActive = false;
bool telegramNotifiedForConnection = false;
bool ledState = false;

void initializeBootSequence() {
  EEPROM.begin(EEPROM_SIZE);
  EEPROM.get(EEPROM_BOOT_COUNTER_ADDRESS, bootSequence);
  if (bootSequence == UINT32_MAX) {
    bootSequence = 0;
  }
  ++bootSequence;
  EEPROM.put(EEPROM_BOOT_COUNTER_ADDRESS, bootSequence);
  EEPROM.commit();
  Serial.printf("[BOOT] sequence=%lu, chip_id=%06X\n",
                static_cast<unsigned long>(bootSequence), ESP.getChipId());
}

void setupOta() {
  if (otaStarted) {
    return;
  }

  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);

  ArduinoOTA.onStart([]() {
    otaInProgress = true;
    Serial.println("[OTA] update started");
  });
  ArduinoOTA.onEnd([]() {
    Serial.println("\n[OTA] update finished");
  });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("[OTA] progress: %u%%\r", (progress * 100U) / total);
  });
  ArduinoOTA.onError([](ota_error_t error) {
    otaInProgress = false;
    Serial.printf("\n[OTA] error[%u]\n", error);
  });

  ArduinoOTA.begin();
  otaStarted = true;
  Serial.print("[OTA] ready at ");
  Serial.print(OTA_HOSTNAME);
  Serial.println(".local");
}

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED &&
      WiFi.localIP() != IPAddress(0, 0, 0, 0)) {
    return true;
  }

  Serial.println("[WiFi] connecting...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    yield();
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] connection timeout");
    return false;
  }

  Serial.print("[WiFi] connected, ip=");
  Serial.println(WiFi.localIP());
  return true;
}

String jsonEscape(const String& value) {
  String escaped;
  escaped.reserve(value.length() + 8);

  for (size_t index = 0; index < value.length(); ++index) {
    const char character = value[index];
    switch (character) {
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
        escaped += character;
        break;
    }
  }

  return escaped;
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

  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + INTERNAL_API_TOKEN);
  const String idempotencyKey =
      String("esp-") + String(ESP.getChipId(), HEX) + "-boot-" +
      String(bootSequence) + "-wifi-" + String(wifiConnectionSequence);
  const String text = String("ESP online\nDevice: ") + DEVICE_NAME +
                      "\nIP: " + WiFi.localIP().toString();
  const String payload = String("{\"idempotencyKey\":\"") +
                         jsonEscape(idempotencyKey) +
                         "\",\"chatId\":\"" + jsonEscape(TELEGRAM_CHAT_ID) +
                         "\",\"text\":\"" + jsonEscape(text) +
                         "\",\"parseMode\":\"plain\"}";

  const int statusCode = http.POST(payload);
  const String responseBody = http.getString();
  http.end();

  if (statusCode == HTTP_CODE_ACCEPTED || statusCode == HTTP_CODE_OK) {
    Serial.println("[Telegram] device status queued");
    return true;
  }

  Serial.printf("[Telegram] notification failed, status=%d, response=%s\n",
                statusCode, responseBody.c_str());
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

void updateBlink() {
  if (otaInProgress || millis() - lastBlinkAt < BLINK_INTERVAL_MS) {
    return;
  }

  lastBlinkAt = millis();
  ledState = !ledState;
  digitalWrite(LED_BUILTIN, ledState ? LOW : HIGH);
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println("[BOOT] OTA and blinking firmware starting");
  initializeBootSequence();

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);

  if (connectWiFi()) {
    setupOta();
  }
}

void loop() {
  const uint32_t now = millis();

  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiConnectionActive) {
      ++wifiConnectionSequence;
      wifiConnectionActive = true;
      telegramNotifiedForConnection = false;
    }
    setupOta();
    notifyTelegramWhenConnected();
    ArduinoOTA.handle();
  } else if (now - lastWiFiAttemptAt >= WIFI_RETRY_INTERVAL_MS) {
    lastWiFiAttemptAt = now;
    wifiConnectionActive = false;
    telegramNotifiedForConnection = false;
    Serial.println("[WiFi] disconnected, reconnecting...");
    connectWiFi();
  }

  updateBlink();
  yield();
}
