<p align="center">
  <img src="docs/cyberpunk-banner.svg" alt="Boring IoT cyberpunk banner" width="100%" />
</p>

# Boring IoT

A small ESP32-C3 temperature monitor with a completely unreasonable cyberpunk dashboard.

The hardware reads temperature from a DS18B20 sensor, drives a WS2812B LED strip locally, uploads readings to Supabase, and visualizes the latest value plus history in a React/Vite dashboard.

## Stack

- ESP32-C3
- DS18B20 temperature sensor
- WS2812B / NeoPixel LED strip
- Supabase Postgres + REST API
- React + Vite
- GitHub Pages

## Architecture

```text
DS18B20 sensor
  -> ESP32-C3 firmware
  -> Supabase temperature_readings table
  -> React dashboard on GitHub Pages
```

The LED strip reacts locally, so it still works if WiFi or Supabase is temporarily unavailable.

## Branches

- `main`: stable public GitHub Pages placeholder
- `dev`: active dashboard + firmware development

## Web Dashboard

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build:

```bash
npm run build
```

The deployed project site is expected at:

```text
https://Majo0101.github.io/boring_iot/
```

## ESP32 Setup

Copy the example config:

```text
led_temp/config.example.h -> led_temp/config.h
```

Fill in:

```cpp
#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

#define SUPABASE_URL "https://your-project.supabase.co"
#define SUPABASE_KEY "YOUR_SUPABASE_PUBLISHABLE_KEY"

#define DEVICE_ID "esp32-led-temp-01"
#define DEVICE_TOKEN "YOUR_DEVICE_TOKEN"
#define UPLOAD_INTERVAL_MS 30000
```

Arduino IDE settings used during development:

- Board: `ESP32C3 Dev Module`
- USB CDC On Boot: `Enabled`
- Serial Monitor: `115200`
- WiFi: `2.4 GHz` network only

Required Arduino libraries:

- `OneWire`
- `DallasTemperature`
- `Adafruit NeoPixel`

## Supabase Schema

The app uses a public read policy and token-protected device inserts.

```sql
create table if not exists temperature_readings (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  device_id text not null,
  temperature_c numeric not null
);

alter table temperature_readings enable row level security;

drop policy if exists "Public can read temperature readings" on temperature_readings;
drop policy if exists "Allow device inserts" on temperature_readings;
drop policy if exists "Device can insert with token" on temperature_readings;

create policy "Public can read temperature readings"
on temperature_readings
for select
to anon
using (true);

create table if not exists device_tokens (
  device_id text primary key,
  token text not null
);

alter table device_tokens enable row level security;

revoke all on device_tokens from anon;
revoke all on device_tokens from authenticated;

insert into device_tokens (device_id, token)
values ('esp32-led-temp-01', 'CHANGE_THIS_TO_LONG_RANDOM_SECRET')
on conflict (device_id)
do update set token = excluded.token;

create or replace function is_valid_device_token(
  input_device_id text,
  input_token text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from device_tokens
    where device_id = input_device_id
      and token = input_token
  );
$$;

revoke all on function is_valid_device_token(text, text) from public;
grant execute on function is_valid_device_token(text, text) to anon;

create policy "Device can insert with token"
on temperature_readings
for insert
to anon
with check (
  is_valid_device_token(
    device_id,
    current_setting('request.headers', true)::json ->> 'x-device-token'
  )
);
```

## Security Notes

- `led_temp/config.h` is ignored by git and must not be committed.
- The frontend uses a Supabase publishable key, which is expected for browser clients.
- Public visitors can read temperature data.
- Inserts require `x-device-token`, which is sent only by the ESP32 firmware.
- For a production-grade setup, move writes behind a Supabase Edge Function and keep direct table inserts disabled for `anon`.

## Troubleshooting

`WiFi status: 6`

ESP32 is disconnected. Check SSID/password and make sure the network is 2.4 GHz.

`Supabase upload status: 201`

Insert succeeded.

`Supabase upload status: 401`

Check the Supabase publishable key.

`Supabase upload status: 403`

Check `DEVICE_TOKEN` and the Supabase token stored in `device_tokens`.

`Supabase upload status: 404`

Check Supabase URL and table name.

No Serial output:

- Board should be `ESP32C3 Dev Module`
- `USB CDC On Boot` should be enabled
- Serial Monitor should be `115200`
