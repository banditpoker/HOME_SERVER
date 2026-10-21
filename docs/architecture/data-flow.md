# Initial Data Flow

```text
Telegram
  -> Traefik (HTTPS/TLS ingress)
  -> telegram-gateway (verify, normalize, authorize)
  -> PostgreSQL (event and delivery state)

IoT water-quality service
  -> telegram-gateway internal message contract
  -> Telegram

NodeMCU ESP8266 firmware
  -> Wi-Fi station network
  -> ArduinoOTA (UDP 8266) for firmware upload
  -> built-in LED for local activity indication
```

The gateway is the boundary between external Telegram updates and internal
application services. Future services must use its documented adapter contract
instead of calling Telegram directly.

The ESP8266 firmware is a standalone LAN device. It does not currently send
application data to HOME_SERVER services or persist data locally.
