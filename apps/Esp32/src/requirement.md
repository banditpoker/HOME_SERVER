# Requirement cũ: NodeMCU ESP8266 gửi dữ liệu định kỳ tới HTTP server

> **Đã được thay thế:** Firmware hiện tại chỉ hỗ trợ kết nối Wi-Fi, OTA qua
> Wi-Fi và nhấp nháy `LED_BUILTIN` để kiểm tra thiết bị. Các phần HTTP POST,
> NTP, LittleFS và offline queue bên dưới là yêu cầu lịch sử, không còn được
> triển khai trong `src/main.cpp`.

## Phạm vi firmware hiện tại

- Kết nối Wi-Fi ở chế độ station.
- Reconnect khi mất Wi-Fi.
- Upload firmware qua `ArduinoOTA`.
- Nhấp nháy LED tích hợp mỗi 500 ms.
- Tạm dừng nhấp nháy trong lúc OTA.

Xem [ESP_FEATURE_MAP.md](../ESP_FEATURE_MAP.md) để biết hướng dẫn vận hành
hiện tại.

## 1. Mục tiêu

Viết firmware cho NodeMCU v2 (ESP8266) bằng PlatformIO để:

1. Kết nối Wi-Fi.
2. Đồng bộ thời gian qua NTP.
3. Tạo và gửi JSON bằng HTTP `POST` mỗi giây.
4. Gửi dữ liệu tới Python server.
5. Tự động reconnect khi mất Wi-Fi hoặc server.
6. Lưu packet offline vào LittleFS khi không gửi được.
7. Gửi lại packet offline theo thứ tự FIFO.
8. In log trạng thái qua Serial để debug.

## 2. Nền tảng và cấu hình cố định

### PlatformIO

```ini
[env:nodemcuv2]
platform = espressif8266
board = nodemcuv2
framework = arduino
monitor_port = COM5
monitor_speed = 115200
```

### Thư viện

Sử dụng thư viện phù hợp với ESP8266:

- `ESP8266WiFi.h`
- `ESP8266HTTPClient.h`
- `LittleFS.h`
- `time.h` hoặc API NTP tương đương

Không dùng API hoặc thư viện riêng của ESP32 như `WiFi.h`.

### Mạng và server

```text
Wi-Fi SSID: Bandit House
Wi-Fi password: cấu hình riêng, không commit
Server IP: 192.168.10.135
Server port: 8866
Data endpoint: /data
Health endpoint: /health
Data URL: http://192.168.10.135:8866/data
Health URL: http://192.168.10.135:8866/health
Authentication: không có, chỉ sử dụng trong LAN
```

Python server phải chạy trên port `8866`, ví dụ:

```bash
LISTEN_PORT=8866 python3 app.py
```

Không dùng `localhost`, `127.0.0.1` hoặc `0.0.0.0` làm địa chỉ server trong firmware.

SSID và password phải được đọc từ file cấu hình local hoặc biến môi trường của môi trường build; không ghi password thật vào repository.

## 3. Cấu hình ứng dụng

Tạo một khu vực cấu hình duy nhất:

```cpp
const char* WIFI_SSID = "Bandit House";
const char* WIFI_PASSWORD = "CONFIGURE_LOCALLY";
const char* SERVER_URL = "http://192.168.10.135:8866/data";
const char* HEALTH_URL = "http://192.168.10.135:8866/health";
const char* DEVICE_ID = "nodemcu-01";

const uint32_t SEND_INTERVAL_MS = 1000;
const uint32_t HTTP_TIMEOUT_MS = 5000;
const uint8_t MAX_RETRIES = 3;
const size_t MAX_QUEUE_PACKETS = 1000;
```

Không hard-code các giá trị này rải rác trong source.

## 4. Kết nối Wi-Fi

Implement `connectWiFi()` với các yêu cầu:

- Dùng station mode.
- Có timeout kết nối khoảng 20–30 giây.
- Retry có kiểm soát, không block vô hạn.
- Tự reconnect khi Wi-Fi bị ngắt.
- Không reset thiết bị chỉ vì lỗi mạng tạm thời.
- In IP hiện tại sau khi kết nối thành công.
- Nếu DHCP cấp IP mới, packet kế tiếp phải dùng IP mới.

Ví dụ log:

```text
[WiFi] connecting...
[WiFi] connected, ip=192.168.10.150
[WiFi] disconnected, reconnecting...
```

## 5. Đồng bộ NTP

```text
NTP server: pool.ntp.org
Timezone: Asia/Ho_Chi_Minh
Date format: ISO 8601
```

Yêu cầu:

- Chờ đồng bộ NTP thành công trước khi gửi packet đầu tiên.
- Không gửi packet có timestamp chưa hợp lệ.
- Nếu mất Wi-Fi, sau khi reconnect phải xác nhận thời gian vẫn hợp lệ trước khi gửi.
- Timestamp phải có timezone, ví dụ:

```text
2026-10-16T01:00:00+07:00
```

## 6. Payload JSON

Không có sensor trong phiên bản này. Payload chỉ gồm các field:

```json
{
  "device_id": "nodemcu-01",
  "device_ip": "192.168.10.150",
  "sequence": 123,
  "timestamp": "2026-10-16T01:00:00+07:00",
  "uptime_ms": 123456
}
```

Các field bắt buộc:

| Field | Kiểu | Yêu cầu |
|---|---|---|
| `device_id` | string | Luôn là `nodemcu-01` |
| `device_ip` | string | IP hiện tại, lấy từ `WiFi.localIP()` |
| `sequence` | unsigned integer | Tăng dần cho mỗi packet được tạo |
| `timestamp` | string | ISO 8601 theo `Asia/Ho_Chi_Minh` |
| `uptime_ms` | unsigned integer | Thời gian chạy từ khi boot |

Yêu cầu về `device_ip`:

- Dùng tên field `device_ip`, không dùng `esp32_ip`.
- Lấy lại giá trị từ `WiFi.localIP().toString()` khi tạo mỗi packet.
- Không dùng IP server làm giá trị này.
- Nếu chưa có Wi-Fi hoặc chưa có IP hợp lệ thì không tạo/gửi packet.

Server hiện tại lưu raw JSON, không validate schema. Firmware vẫn phải tạo JSON hợp lệ và không gửi body rỗng.

## 7. Chu kỳ gửi và phát hiện mất tín hiệu

Firmware gửi packet realtime mỗi:

```text
1000 ms
```

Dùng `millis()`, không dùng `delay()` dài trong loop chính.

Python server được cấu hình:

```text
EXPECTED_INTERVAL=1
LOSS_THRESHOLD=3
```

Khoảng trống lớn hơn:

```text
1 × 3 = 3 giây
```

được server ghi nhận là một lần mất tín hiệu.

## 8. HTTP POST

## 9. Nạp firmware qua mạng LAN (OTA)

Firmware hỗ trợ cập nhật qua Wi-Fi bằng `ArduinoOTA`. Đây là dự án
NodeMCU ESP8266 (`board = nodemcuv2`), không phải ESP32.

### Cấu hình lần đầu

1. Copy `.env.example` thành `.env` trong thư mục `apps/Esp32`.
2. Điền `WIFI_SSID`, `WIFI_PASSWORD` và `OTA_PASSWORD` trong `.env`.
3. PlatformIO sẽ tự nạp các giá trị này khi build; không sửa `include/secrets.h`
   hoặc thêm password vào `platformio.ini`.
4. Nạp firmware lần đầu bằng USB.
5. Mở Serial Monitor và chờ log:

   ```text
   [OTA] ready at nodemcu-01.local
   ```

### Các lần nạp tiếp theo

Đảm bảo máy tính và NodeMCU cùng mạng LAN, sau đó chạy:

```bash
pio run --target upload
```

PlatformIO sẽ tìm thiết bị tại `nodemcu-01.local`. Nếu mDNS không hoạt động
trên mạng, thay `upload_port` trong `platformio.ini` bằng địa chỉ IP hiện tại
của NodeMCU, ví dụ `192.168.10.150`.

Trong lúc OTA, thiết bị tạm dừng gửi dữ liệu để tránh làm gián đoạn firmware.
Không ngắt nguồn trong quá trình cập nhật. Nếu OTA không khả dụng, có thể đổi
`upload_protocol` về `serial` và nạp lại qua USB.

Implement `sendPacket(payload)`:

1. Kiểm tra Wi-Fi.
2. Gửi tới `http://192.168.10.135:8866/data`.
3. Dùng method `POST`.
4. Gửi header `Content-Type: application/json`.
5. Đặt timeout `5000 ms`.
6. Chỉ coi là thành công khi HTTP status là `200`.
7. Đọc/log response nếu cần.
8. Luôn giải phóng HTTP client bằng `http.end()`.

Response thành công:

```text
HTTP 200
ok
```

Các status `400`, `404`, `500` và lỗi mạng phải được log rõ ràng.

Health check `GET /health` chỉ dùng khi khởi động hoặc sau nhiều lần gửi thất bại, không gọi trước mỗi packet.

## 9. Offline queue bằng LittleFS

Offline queue được bật với cấu hình:

```text
Storage: LittleFS
Maximum: 1000 packet
Replay: FIFO
When full: bỏ packet cũ nhất
```

### Quy tắc hoạt động

1. Tạo packet mới với đầy đủ `device_id`, `device_ip`, `sequence`, `timestamp`, `uptime_ms`.
2. Nếu gửi thành công (`HTTP 200`), không đưa packet vào queue.
3. Nếu Wi-Fi/server lỗi hoặc HTTP status khác `200`, lưu packet vào LittleFS.
4. Khi kết nối hoạt động lại, gửi packet cũ nhất trước.
5. Chỉ xóa packet khỏi queue sau khi nhận HTTP `200`.
6. Nếu gửi lại thất bại, giữ nguyên packet và dừng replay trong chu kỳ đó.
7. Khi queue rỗng, tiếp tục gửi packet realtime.
8. Nếu queue đạt 1000 packet, xóa packet cũ nhất trước khi thêm packet mới.

Queue phải giữ nguyên dữ liệu gốc của packet, bao gồm sequence, IP, timestamp và uptime. Không được tự sửa timestamp hoặc sequence khi replay.

Với chu kỳ 1 packet/giây, 1000 packet tương đương khoảng 16 phút 40 giây dữ liệu. Khi mất server lâu hơn thời gian này, packet cũ nhất sẽ bị loại bỏ.

### Yêu cầu an toàn LittleFS

- Mount LittleFS khi boot và log lỗi nếu mount thất bại.
- Xử lý file đầy, lỗi đọc/ghi và dữ liệu queue hỏng bằng log rõ ràng.
- Không xóa packet nếu chưa nhận HTTP `200`.
- Dùng format record có thể đọc lại sau reboot, ví dụ một JSON packet trên mỗi dòng hoặc file record tuần tự.
- Giới hạn kích thước packet.
- Tránh ghi thừa không cần thiết để hạn chế hao mòn flash.

## 10. Retry và lỗi

```text
HTTP timeout: 5000 ms
Max retries per attempt: 3
```

- Retry tối đa 3 lần với delay hợp lý giữa các lần thử.
- Không retry vô hạn.
- Packet thất bại phải được lưu queue sau khi hết retry.
- Không làm mất chương trình chính khi server tắt.
- Không tăng sequence lại khi replay packet cũ.
- Có thể dùng sequence kế tiếp cho packet mới; chính sách phải nhất quán.

## 11. Serial logging

Baud rate:

```text
115200
```

Log tối thiểu:

- Boot.
- LittleFS mount.
- Wi-Fi connect/reconnect.
- IP NodeMCU hiện tại.
- NTP sync.
- Sequence và `device_ip` của packet.
- HTTP status.
- Retry count.
- Queue size.
- Packet được enqueue/dequeue.
- Lỗi server hoặc filesystem.

Ví dụ:

```text
[BOOT] NodeMCU data sender starting
[FS] LittleFS mounted
[WiFi] connected, ip=192.168.10.150
[NTP] time synchronized
[HTTP] sequence=1, device_ip=192.168.10.150, status=200
[QUEUE] pending=0
```

Không log Wi-Fi password.

## 12. Tiêu chí kiểm thử

### Kết nối và NTP

- NodeMCU kết nối đúng Wi-Fi.
- Serial in đúng IP NodeMCU.
- Firmware chờ NTP trước packet đầu tiên.
- Firmware không treo vô hạn khi SSID/password sai.

### HTTP và payload

- Gửi đúng:

  ```text
  http://192.168.10.135:8866/data
  ```

- Nhận HTTP `200`.
- Payload là JSON hợp lệ.
- Payload chứa đúng 5 field bắt buộc.
- `device_ip` trùng IP in trên Serial.
- `timestamp` là ISO 8601 với `+07:00`.
- Dữ liệu xuất hiện trong daily log của Python server.

### Offline queue

- Tắt Python server.
- Firmware không crash và lưu packet vào LittleFS.
- Queue tăng theo số packet thất bại.
- Khởi động lại server.
- Firmware replay theo FIFO.
- Chỉ xóa packet sau HTTP `200`.
- Sau khi queue rỗng, packet realtime tiếp tục được gửi.
- Kiểm tra chính sách bỏ packet cũ nhất khi vượt 1000 packet.
- Reboot NodeMCU trong lúc queue có dữ liệu và xác nhận queue vẫn đọc lại được.

### Reconnect và mất tín hiệu

- Ngắt Wi-Fi rồi khôi phục.
- Firmware tự reconnect.
- Packet sau reconnect dùng IP hiện tại.
- Dừng gửi trên 3 giây.
- Python server ghi nhận interruption trong summary.

### Độ ổn định

- `sequence` tăng nhất quán.
- `uptime_ms` tăng.
- Không có reset bất thường.
- Không block vô hạn.
- Có thể chạy liên tục nhiều ngày.
- Không commit credential thật.

## Acceptance criteria

Firmware hoàn thành khi:

- Build được bằng PlatformIO cho `nodemcuv2`.
- Kết nối Wi-Fi và tự reconnect.
- Chờ NTP sync trước khi gửi.
- Gửi JSON `POST /data` mỗi 1 giây tới port `8866`.
- Payload chứa `device_id`, `device_ip`, `sequence`, `timestamp`, `uptime_ms`.
- Có offline queue LittleFS tối đa 1000 packet.
- Replay FIFO và bỏ packet cũ nhất khi queue đầy.
- Chỉ xóa queue sau HTTP `200`.
- Xử lý server unavailable mà không crash.
- Dữ liệu được ghi vào daily log của Python server.
- Có Serial log đủ để chẩn đoán.
