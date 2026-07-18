#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_BME280.h>
#include <Adafruit_BMP280.h>
#include <Adafruit_NeoPixel.h>
#include "config.h"

#define I2C_SDA 12
#define I2C_SCL 13

#define WIFI_STARTUP_TIMEOUT_MS 15000
#define SENSOR_READ_INTERVAL_MS 2000

#ifndef STATUS_LED_PIN
#define STATUS_LED_PIN 21
#endif

#ifndef STATUS_LED_COUNT
#define STATUS_LED_COUNT 1
#endif

#ifndef STATUS_LED_BRIGHTNESS
#define STATUS_LED_BRIGHTNESS 20
#endif

#ifndef TEMPERATURE_OFFSET_C
#define TEMPERATURE_OFFSET_C -2.0
#endif

Adafruit_BME280 bme;
Adafruit_BMP280 bmp;
Adafruit_NeoPixel statusLed(STATUS_LED_COUNT, STATUS_LED_PIN, NEO_RGB + NEO_KHZ800);

bool hasBme = false;
bool hasBmp = false;
uint8_t sensorAddress = 0;
unsigned long lastSensorReadMs = 0;
unsigned long lastUploadMs = 0;
bool startupUploadTried = false;

void setStatusLed(uint8_t red, uint8_t green, uint8_t blue) {
  statusLed.setPixelColor(0, statusLed.Color(red, green, blue));
  statusLed.show();
}

void showWiFiStatusLed() {
  if (WiFi.status() == WL_CONNECTED) {
    setStatusLed(0, 255, 0);
  } else {
    setStatusLed(255, 0, 0);
  }
}

void blinkUploadLed() {
  setStatusLed(255, 180, 0);
  delay(140);
  showWiFiStatusLed();
}

bool connectWiFiOnce(unsigned long timeoutMs) {
  Serial.println("WiFi: startujem pripojenie");
  setStatusLed(255, 0, 0);
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
    showWiFiStatusLed();
    return true;
  }

  Serial.print("WiFi: nepripojene, status: ");
  Serial.println(WiFi.status());
  showWiFiStatusLed();
  return false;
}

void printDiagnostics() {
  Serial.println();
  Serial.println("=== ESP32-S3 BMP280 UPLOADER ===");
  Serial.print("Device ID: ");
  Serial.println(DEVICE_ID);
  Serial.print("I2C SDA: GPIO ");
  Serial.println(I2C_SDA);
  Serial.print("I2C SCL: GPIO ");
  Serial.println(I2C_SCL);
  Serial.print("WiFi SSID nastavene: ");
  Serial.println(strlen(WIFI_SSID) > 0 && String(WIFI_SSID) != "YOUR_WIFI_NAME" ? "ANO" : "NIE");
  Serial.print("Supabase URL: ");
  Serial.println(SUPABASE_URL);
  Serial.print("Device token nastavene: ");
  Serial.println(strlen(DEVICE_TOKEN) > 0 && String(DEVICE_TOKEN) != "YOUR_DEVICE_TOKEN" ? "ANO" : "NIE");
  Serial.print("Upload interval ms: ");
  Serial.println(UPLOAD_INTERVAL_MS);
  Serial.print("Status LED pin: GPIO ");
  Serial.println(STATUS_LED_PIN);
  Serial.print("Status LED brightness: ");
  Serial.println(STATUS_LED_BRIGHTNESS);
  Serial.print("Temperature offset C: ");
  Serial.println(TEMPERATURE_OFFSET_C);
  Serial.println("===============================");
  Serial.println();
}

void scanI2C() {
  Serial.println();
  Serial.println("I2C: scan start");

  int foundCount = 0;
  for (uint8_t address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    uint8_t error = Wire.endTransmission();

    if (error == 0) {
      Serial.print("I2C: najdene zariadenie na 0x");
      if (address < 16) {
        Serial.print("0");
      }
      Serial.println(address, HEX);
      foundCount++;
    }
  }

  if (foundCount == 0) {
    Serial.println("I2C: nic nenajdene");
  }

  Serial.println("I2C: scan koniec");
  Serial.println();
}

bool tryBme(uint8_t address) {
  if (!bme.begin(address, &Wire)) {
    return false;
  }

  hasBme = true;
  sensorAddress = address;
  Serial.print("Senzor: BME280 najdeny na 0x");
  Serial.println(address, HEX);
  return true;
}

bool tryBmp(uint8_t address) {
  if (!bmp.begin(address)) {
    return false;
  }

  hasBmp = true;
  sensorAddress = address;
  Serial.print("Senzor: BMP280 najdeny na 0x");
  Serial.println(address, HEX);
  return true;
}

void detectSensor() {
  hasBme = false;
  hasBmp = false;
  sensorAddress = 0;

  if (tryBme(0x76) || tryBme(0x77)) {
    return;
  }

  if (tryBmp(0x76) || tryBmp(0x77)) {
    return;
  }

  Serial.println("Senzor: BME280/BMP280 nenajdeny na 0x76 ani 0x77");
}

void printBmeValues() {
  float rawTemperatureC = bme.readTemperature();
  float finalTemperatureC = rawTemperatureC + TEMPERATURE_OFFSET_C;

  Serial.print("BME280 0x");
  Serial.print(sensorAddress, HEX);
  Serial.print(" | teplota raw: ");
  Serial.print(rawTemperatureC);
  Serial.print(" C | offset: ");
  Serial.print(TEMPERATURE_OFFSET_C);
  Serial.print(" C | final: ");
  Serial.print(finalTemperatureC);
  Serial.print(" C | vlhkost: ");
  Serial.print(bme.readHumidity());
  Serial.print(" % | tlak: ");
  Serial.print(bme.readPressure() / 100.0F);
  Serial.println(" hPa");
}

void printBmpValues() {
  float rawTemperatureC = bmp.readTemperature();
  float finalTemperatureC = rawTemperatureC + TEMPERATURE_OFFSET_C;

  Serial.print("BMP280 0x");
  Serial.print(sensorAddress, HEX);
  Serial.print(" | teplota raw: ");
  Serial.print(rawTemperatureC);
  Serial.print(" C | offset: ");
  Serial.print(TEMPERATURE_OFFSET_C);
  Serial.print(" C | final: ");
  Serial.print(finalTemperatureC);
  Serial.print(" C | tlak: ");
  Serial.print(bmp.readPressure() / 100.0F);
  Serial.println(" hPa");
}

bool uploadBmpValues(float temperatureC, float pressureHpa) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Supabase: upload preskoceny, WiFi nie je pripojena");
    return false;
  }

  if (!hasBmp) {
    Serial.println("Supabase: upload preskoceny, BMP280 nie je najdeny");
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
  http.addHeader("x-device-token", DEVICE_TOKEN);
  http.addHeader("Prefer", "return=minimal");

  String payload = "{\"device_id\":\"" + String(DEVICE_ID) +
                   "\",\"temperature_c\":" + String(temperatureC, 2) +
                   ",\"pressure_hpa\":" + String(pressureHpa, 2) +
                   ",\"sensor_type\":\"BMP280\"}";

  Serial.print("Supabase payload: ");
  Serial.println(payload);

  blinkUploadLed();
  int statusCode = http.POST(payload);
  String responseBody = http.getString();

  Serial.print("Supabase upload status: ");
  Serial.println(statusCode);

  if (statusCode == 401) {
    Serial.println("Supabase: 401 Unauthorized - skontroluj SUPABASE_KEY");
  } else if (statusCode == 403) {
    Serial.println("Supabase: 403 Forbidden - skontroluj DEVICE_TOKEN");
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
  showWiFiStatusLed();
  return statusCode >= 200 && statusCode < 300;
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  statusLed.begin();
  statusLed.setBrightness(STATUS_LED_BRIGHTNESS);
  setStatusLed(255, 0, 0);

  printDiagnostics();

  Wire.begin(I2C_SDA, I2C_SCL);
  scanI2C();
  detectSensor();
  connectWiFiOnce(WIFI_STARTUP_TIMEOUT_MS);
}

void loop() {
  if (millis() - lastSensorReadMs < SENSOR_READ_INTERVAL_MS) {
    delay(50);
    return;
  }

  lastSensorReadMs = millis();
  showWiFiStatusLed();

  if (hasBme) {
    printBmeValues();
  } else if (hasBmp) {
    printBmpValues();

    float temperatureC = bmp.readTemperature() + TEMPERATURE_OFFSET_C;
    float pressureHpa = bmp.readPressure() / 100.0F;

    if (!startupUploadTried) {
      Serial.println("Supabase: startup test upload");
      uploadBmpValues(temperatureC, pressureHpa);
      startupUploadTried = true;
      lastUploadMs = millis();
    }

    if (millis() - lastUploadMs >= UPLOAD_INTERVAL_MS || lastUploadMs == 0) {
      uploadBmpValues(temperatureC, pressureHpa);
      lastUploadMs = millis();
    }
  } else {
    Serial.println("Senzor: ziadne hodnoty, senzor nenajdeny");
  }
}
