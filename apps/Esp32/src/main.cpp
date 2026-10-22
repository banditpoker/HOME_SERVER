#include <Arduino.h>
#include <ArduinoOTA.h>
#include <EEPROM.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>

#include "secrets.h"

namespace {
constexpr uint32_t WIFI_CONNECT_TIMEOUT_MS = 25000;
constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 10000;
constexpr uint32_t BLINK_INTERVAL_MS = 500;
constexpr uint32_t TELEGRAM_RETRY_INTERVAL_MS = 10000;
constexpr uint8_t EEPROM_SIZE = 80;
constexpr int EEPROM_BOOT_COUNTER_ADDRESS = 0;
constexpr int EEPROM_CONFIG_ADDRESS = 8;
constexpr uint32_t DEVICE_CONFIG_MAGIC = 0x45535031;
constexpr size_t DEVICE_NAME_LENGTH = 32;
constexpr size_t OTA_HOSTNAME_LENGTH = 32;

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
bool webServerStarted = false;
ESP8266WebServer webServer(80);

struct DeviceConfig {
  uint32_t magic;
  char deviceName[DEVICE_NAME_LENGTH];
  char otaHostname[OTA_HOSTNAME_LENGTH];
};

DeviceConfig deviceConfig{};

void setupOta();

String htmlEscape(const String& value) {
  String escaped;
  escaped.reserve(value.length() + 16);
  for (size_t index = 0; index < value.length(); ++index) {
    switch (value[index]) {
      case '&':
        escaped += "&amp;";
        break;
      case '<':
        escaped += "&lt;";
        break;
      case '>':
        escaped += "&gt;";
        break;
      case '"':
        escaped += "&quot;";
        break;
      case '\'':
        escaped += "&#39;";
        break;
      default:
        escaped += value[index];
        break;
    }
  }
  return escaped;
}

String normalizeHostname(const String& value) {
  String hostname;
  hostname.reserve(OTA_HOSTNAME_LENGTH - 1);
  for (size_t index = 0; index < value.length() &&
                          hostname.length() < OTA_HOSTNAME_LENGTH - 1;
       ++index) {
    const char character = value[index];
    const unsigned char unsignedCharacter =
        static_cast<unsigned char>(character);
    if (isalnum(unsignedCharacter)) {
      hostname += static_cast<char>(tolower(unsignedCharacter));
    } else if ((character == '-' || character == '_' || character == ' ') &&
               hostname.length() > 0 && hostname[hostname.length() - 1] != '-') {
      hostname += '-';
    }
  }
  while (hostname.endsWith("-")) {
    hostname.remove(hostname.length() - 1);
  }
  return hostname;
}

void copyConfigValue(char* destination, size_t destinationSize,
                     const String& value) {
  value.substring(0, destinationSize - 1).toCharArray(destination,
                                                        destinationSize);
}

void loadDeviceConfig() {
  EEPROM.get(EEPROM_CONFIG_ADDRESS, deviceConfig);
  if (deviceConfig.magic == DEVICE_CONFIG_MAGIC &&
      deviceConfig.deviceName[0] != '\0' &&
      deviceConfig.otaHostname[0] != '\0') {
    return;
  }

  deviceConfig.magic = DEVICE_CONFIG_MAGIC;
  copyConfigValue(deviceConfig.deviceName, DEVICE_NAME_LENGTH, DEVICE_NAME);
  copyConfigValue(deviceConfig.otaHostname, OTA_HOSTNAME_LENGTH, OTA_HOSTNAME);
  EEPROM.put(EEPROM_CONFIG_ADDRESS, deviceConfig);
  EEPROM.commit();
}

void saveDeviceConfig(const String& deviceName) {
  const String hostname = normalizeHostname(deviceName);
  copyConfigValue(deviceConfig.deviceName, DEVICE_NAME_LENGTH, deviceName);
  copyConfigValue(deviceConfig.otaHostname, OTA_HOSTNAME_LENGTH, hostname);
  EEPROM.put(EEPROM_CONFIG_ADDRESS, deviceConfig);
  EEPROM.commit();
}

void handleConfigPage() {
  const String name = htmlEscape(deviceConfig.deviceName);
  const String hostname = htmlEscape(deviceConfig.otaHostname);
  const String page =
      "<!doctype html><html><meta charset='utf-8'><title>ESP config</title>"
      "<style>body{font:16px sans-serif;max-width:520px;margin:40px auto;padding:0 16px}"
      "input,button{font:inherit;padding:8px}input{width:100%;box-sizing:border-box}"
      "button{margin-top:12px}</style><h1>ESP configuration</h1>"
      "<p>IP: " +
      WiFi.localIP().toString() +
      "</p><form method='post' action='/config'>"
      "<label for='name'>Device name</label><br><input id='name' name='name' "
      "maxlength='31' required value='" +
      name +
      "'><br><button type='submit'>Save</button></form><p>OTA hostname: " +
      hostname + ".local</p></html>";
  webServer.send(HTTP_CODE_OK, "text/html; charset=utf-8", page);
}

void handleConfigSave() {
  if (!webServer.hasArg("name")) {
    webServer.send(HTTP_CODE_BAD_REQUEST, "text/plain", "Missing name");
    return;
  }

  const String name = webServer.arg("name");
  const String hostname = normalizeHostname(name);
  if (name.length() == 0 || name.length() >= DEVICE_NAME_LENGTH ||
      hostname.length() == 0) {
    webServer.send(HTTP_CODE_BAD_REQUEST, "text/plain",
                   "Name must be 1-31 characters and contain a valid hostname");
    return;
  }

  saveDeviceConfig(name);
  if (otaStarted) {
    ArduinoOTA.end();
    otaStarted = false;
    setupOta();
  }
  telegramNotifiedForConnection = false;
  lastTelegramAttemptAt = 0;
  webServer.send(HTTP_CODE_OK, "text/html; charset=utf-8",
                 "<p>Saved. The new name is active. <a href='/'>Back</a></p>");
  Serial.printf("[CONFIG] name=%s, ota=%s\n", deviceConfig.deviceName,
                deviceConfig.otaHostname);
}

void setupWebServer() {
  if (webServerStarted) {
    return;
  }
  webServer.on("/", HTTP_GET, handleConfigPage);
  webServer.on("/config", HTTP_POST, handleConfigSave);
  webServer.begin();
  webServerStarted = true;
  Serial.println("[HTTP] configuration page ready");
}

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

  ArduinoOTA.setHostname(deviceConfig.otaHostname);
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
  Serial.print(deviceConfig.otaHostname);
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
  const String text = String("ESP online\nDevice: ") + deviceConfig.deviceName +
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
  loadDeviceConfig();

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);

  if (connectWiFi()) {
    setupOta();
    setupWebServer();
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
    setupWebServer();
    webServer.handleClient();
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
