#include <Arduino.h>
#include <ArduinoOTA.h>
#include <ESP8266WiFi.h>

#include "secrets.h"

namespace {
constexpr char OTA_HOSTNAME[] = "nodemcu-01";
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 25000;
constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 10000;
constexpr uint32_t BLINK_INTERVAL_MS = 500;

uint32_t lastWiFiAttemptAt = 0;
uint32_t lastBlinkAt = 0;
bool otaStarted = false;
bool otaInProgress = false;
bool ledState = false;

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

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);

  if (connectWiFi()) {
    setupOta();
  }
}

void loop() {
  const uint32_t now = millis();

  if (WiFi.status() == WL_CONNECTED) {
    setupOta();
    ArduinoOTA.handle();
  } else if (now - lastWiFiAttemptAt >= WIFI_RETRY_INTERVAL_MS) {
    lastWiFiAttemptAt = now;
    Serial.println("[WiFi] disconnected, reconnecting...");
    connectWiFi();
  }

  updateBlink();
  yield();
}
