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

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

unsigned long lastUploadMs = 0;

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

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.print("Pripajam WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startMs < 15000) {
    Serial.print(".");
    delay(500);
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\nWiFi OK, IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi sa nepodarilo pripojit");
  }
}

void uploadTemperature(float tempC) {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Upload preskoceny: WiFi offline");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/temperature_readings";

  if (!http.begin(client, url)) {
    Serial.println("Supabase HTTP start zlyhal");
    return;
  }

  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  String payload = "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"temperature_c\":" + String(tempC, 2) + "}";
  int statusCode = http.POST(payload);

  Serial.print("Supabase upload status: ");
  Serial.println(statusCode);

  if (statusCode < 200 || statusCode >= 300) {
    Serial.print("Supabase odpoved: ");
    Serial.println(http.getString());
  }

  http.end();
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

  sensors.begin();

  strip.begin();
  strip.setBrightness(LED_BRIGHTNESS);
  strip.clear();
  strip.show();

  Serial.println("DS18B20 + WS2812B start");
  connectWiFi();
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

  if (millis() - lastUploadMs >= UPLOAD_INTERVAL_MS || lastUploadMs == 0) {
    uploadTemperature(tempC);
    lastUploadMs = millis();
  }

  delay(1000);
}
