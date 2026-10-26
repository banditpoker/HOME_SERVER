"""Load local .env values into the PlatformIO build and OTA uploader."""

import json
from pathlib import Path

Import("env")


def load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        raise RuntimeError(
            f"Missing {path}. Copy .env.example to .env and set local credentials."
        )

    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        if "=" not in line:
            raise RuntimeError(f"Invalid .env entry at line {line_number}: {raw_line}")

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value

    return values


project_dir = Path(env.subst("$PROJECT_DIR"))
values = load_dotenv(project_dir / ".env")
required_keys = (
    "WIFI_SSID",
    "WIFI_PASSWORD",
    "OTA_PASSWORD",
    "DEVICE_NAME",
    "OTA_HOSTNAME",
    "TELEGRAM_GATEWAY_URL",
    "TELEGRAM_CHAT_ID",
    "INTERNAL_API_TOKEN",
)
missing_keys = [key for key in required_keys if not values.get(key)]
if missing_keys:
    missing = ", ".join(missing_keys)
    raise RuntimeError(f"Missing required .env values: {missing}")

env.Append(CPPPATH=[str(project_dir / "include")])
secrets_header = project_dir / "include" / ".env.secrets.h"
secrets_header.write_text(
    "\n".join(
        [
            "#pragma once",
            "",
            f"constexpr char WIFI_SSID[] = {json.dumps(values['WIFI_SSID'])};",
            f"constexpr char WIFI_PASSWORD[] = {json.dumps(values['WIFI_PASSWORD'])};",
            f"constexpr char OTA_PASSWORD[] = {json.dumps(values['OTA_PASSWORD'])};",
            f"constexpr char DEVICE_NAME[] = {json.dumps(values['DEVICE_NAME'])};",
            f"constexpr char OTA_HOSTNAME[] = {json.dumps(values['OTA_HOSTNAME'])};",
            f"constexpr char TELEGRAM_GATEWAY_URL[] = {json.dumps(values['TELEGRAM_GATEWAY_URL'].rstrip('/'))};",
            f"constexpr char TELEGRAM_CHAT_ID[] = {json.dumps(values['TELEGRAM_CHAT_ID'])};",
            f"constexpr char INTERNAL_API_TOKEN[] = {json.dumps(values['INTERNAL_API_TOKEN'])};",
            "",
        ]
    ),
    encoding="utf-8",
)

if env["PIOENV"] == "esp32cam-ota":
    env.Replace(UPLOAD_PORT=f"{values['OTA_HOSTNAME']}.local")
    env.Append(UPLOAD_FLAGS=[f"--auth={values['OTA_PASSWORD']}"])