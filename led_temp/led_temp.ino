#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_NeoPixel.h>
#include "config.h"

#define ONE_WIRE_BUS 4

#define LED_PIN 5
#define LED_COUNT 20

#define TEMP_MIN 15.0
#define TEMP_MAX 35.0

#define SENSOR_OFFSET_C 0.0

#define LED_BRIGHTNESS 80
#define WIFI_STARTUP_TIMEOUT_MS 15000

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

unsigned long lastUploadMs = 0;
bool startupUploadTried = false;

uint32_t gradientColorForLed(int index, float brightnessScale) {
  float pos = (float)index / (LED_COUNT - 1);

  int r = 0;
  int g = 0;
  int b = 0;

  if (pos <= 0.5) {
    float k = pos / 0.5;

    r = 0;
    g = 255 * k;
    b = 255 * (1.0 - k);
  } else {
    float k = (pos - 0.5) / 0.5;

    r = 255 * k;
    g = 255 * (1.0 - k);
    b = 0;
  }

  r *= brightnessScale;
  g *= brightnessScale;
  b *= brightnessScale;

  return strip.gamma32(strip.Color(r, g, b));
}

bool connectWiFiOnce(unsigned long timeoutMs) {
  Serial.println("WiFi: startujem pripojenie");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startMs = millis();
  Serial.print("WiFi: cakam");

  while (WiFi.status() != WL_CONNECTED && millis() - startMs < timeoutMs) {
    Serial.print(".");
    delay(500);
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi: OK, IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.print("WiFi: nepripojene, status: ");
  Serial.println(WiFi.status());
  return false;
}

void printDiagnostics() {
  Serial.println();
  Serial.println("=== LED TEMP DIAGNOSTIKA ===");
  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);
  Serial.print("WiFi SSID nastavene: ");
  Serial.println(strlen(WIFI_SSID) > 0 && String(WIFI_SSID) != "YOUR_WIFI_NAME" ? "ANO" : "NIE");
  Serial.print("Supabase URL: ");
  Serial.println(SUPABASE_URL);
  Serial.print("Upload interval ms: ");
  Serial.println(UPLOAD_INTERVAL_MS);
  Serial.println("============================");
  Serial.println();
}

bool uploadTemperature(float tempC) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Supabase: upload preskoceny, WiFi nie je pripojena");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/temperature_readings";

  if (!http.begin(client, url)) {
    Serial.println("Supabase: HTTP start zlyhal");
    return false;
  }

  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  String payload = "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"temperature_c\":" + String(tempC, 2) + "}";

  Serial.print("Supabase payload: ");
  Serial.println(payload);

  int statusCode = http.POST(payload);
  String responseBody = http.getString();

  Serial.print("Supabase upload status: ");
  Serial.println(statusCode);

  if (statusCode == 401) {
    Serial.println("Supabase: 401 Unauthorized - skontroluj SUPABASE_KEY");
  } else if (statusCode == 404) {
    Serial.println("Supabase: 404 Not Found - skontroluj SUPABASE_URL alebo nazov tabulky");
  }

  if (statusCode < 200 || statusCode >= 300) {
    Serial.print("Supabase odpoved: ");
    Serial.println(responseBody);
  } else {
    Serial.println("Supabase: upload OK");
  }

  http.end();
  return statusCode >= 200 && statusCode < 300;
}

void showTemperatureOnStrip(float tempC) {
  float ledValue = ((tempC - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * LED_COUNT;
  ledValue = constrain(ledValue, 0.0, (float)LED_COUNT);

  int fullLeds = floor(ledValue);
  float partial = ledValue - fullLeds;

  strip.clear();

  for (int i = 0; i < fullLeds; i++) {
    strip.setPixelColor(i, gradientColorForLed(i, 1.0));
  }

  if (fullLeds < LED_COUNT && partial > 0.0) {
    strip.setPixelColor(fullLeds, gradientColorForLed(fullLeds, partial));
  }

  strip.show();
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  printDiagnostics();

  sensors.begin();

  strip.begin();
  strip.setBrightness(LED_BRIGHTNESS);
  strip.clear();
  strip.show();

  Serial.println("DS18B20 + WS2812B start");
  connectWiFiOnce(WIFI_STARTUP_TIMEOUT_MS);
}

void loop() {
  sensors.requestTemperatures();

  float rawTempC = sensors.getTempCByIndex(0);

  if (rawTempC == DEVICE_DISCONNECTED_C) {
    Serial.println("Senzor nenajdeny");

    strip.clear();
    strip.show();

    delay(1000);
    return;
  }

  float tempC = rawTempC + SENSOR_OFFSET_C;

  Serial.print("Teplota raw: ");
  Serial.print(rawTempC);
  Serial.print(" C | offset: ");
  Serial.print(SENSOR_OFFSET_C);
  Serial.print(" C | final: ");
  Serial.print(tempC);
  Serial.println(" C");

  showTemperatureOnStrip(tempC);

  if (!startupUploadTried) {
    Serial.println("Supabase: startup test upload");
    uploadTemperature(tempC);
    startupUploadTried = true;
    lastUploadMs = millis();
  }

  if (millis() - lastUploadMs >= UPLOAD_INTERVAL_MS || lastUploadMs == 0) {
    uploadTemperature(tempC);
    lastUploadMs = millis();
  }

  delay(1000);
}
