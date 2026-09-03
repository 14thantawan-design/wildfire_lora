#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>
#include <Adafruit_SHT31.h>
#include <WiFi.h>
#include <Preferences.h>
#include "esp_system.h"
#include "config.h"

#if USE_GPS
  #include <TinyGPSPlus.h>
#endif

#if defined(BLUETOOTH_ENABLED) || defined(CONFIG_BT_ENABLED)
  #include "esp_bt.h"
#endif

// =========================
// Data structures
// =========================
enum FireStatus {
  SENSOR_FAULT,
  CALIBRATING,
  NORMAL,
  WATCH,
  WARNING,
  CRITICAL
};

struct SensorData {
  float airTemp;
  float humidity;
  int smokeRaw;
  bool shtOk;
  bool sharpOk;
};

struct DeltaData {
  // Change from the immediately previous reading.
  float airTempDelta;
  float humidityDelta;
  int smokeDelta;

  // Rate-normalized previous change. These are safer than raw delta when sleep interval changes.
  float airTempRatePerMin;
  float humidityRatePerMin;  // negative means humidity dropping
  float smokeRatePerMin;

  // Change from learned normal baseline. These keep alarms active while values remain high.
  float airTempBaselineDelta;
  float humidityBaselineDelta; // current - baseline; negative means humidity dropped
  int smokeBaselineDelta;

  float elapsedMinutes;
};

struct EvidenceFlags {
  bool smokeWatch;
  bool smokeGroup;
  bool smokeCritical;
  bool heatWatch;
  bool heatGroup;
  bool heatCritical;
  bool humidityWatch;
  bool humidityGroup;
  bool humidityCritical;
  int groupCount;
};

struct GpsLocation {
  double latitude;
  double longitude;
  bool valid;
};

// =========================
// Global objects
// =========================
Adafruit_SHT31 sht31 = Adafruit_SHT31();
uint8_t activeSht31Address = SHT31_I2C_ADDRESS_PRIMARY;

#if USE_GPS
TinyGPSPlus gps;
#if GPS_SAVE_TO_NVS
Preferences gpsPrefs;
#endif
GpsLocation nodeGpsLocation = {0.0, 0.0, false};
GpsLocation gpsWorkingLocation = {0.0, 0.0, false};
enum GpsOneShotState {
  GPS_ONE_SHOT_IDLE,
  GPS_ONE_SHOT_ACQUIRING,
  GPS_ONE_SHOT_DONE,
  GPS_ONE_SHOT_FAILED
};
GpsOneShotState gpsOneShotState = GPS_ONE_SHOT_IDLE;
unsigned long gpsStartMs = 0;
unsigned long gpsLastDebugMs = 0;
unsigned long gpsLastAttemptMs = 0;
RTC_DATA_ATTR uint32_t gpsRetryRemainingSec = 0;
uint32_t gpsByteCount = 0;
bool gpsFixReportPending = false;
bool gpsFailureReportPending = false;
#endif
String lastHandledCommandId;
Preferences commandPrefs;
Preferences baselinePrefs;
unsigned long lastLoRaInitAttemptMs = 0;
bool loraReady = false;
SensorData commandSafetyData = {NAN, NAN, -1, false, false};
FireStatus commandSafetyStatus = SENSOR_FAULT;
bool commandSafetyReady = false;
bool baselineRecalibrationAcceptedThisCycle = false;
bool lastCommandAccepted = true;
String lastCommandResultReason;

RTC_DATA_ATTR uint32_t seq = 0;
RTC_DATA_ATTR uint32_t bootSessionId = 0;
RTC_DATA_ATTR bool hasPreviousData = false;
RTC_DATA_ATTR SensorData previousData;
RTC_DATA_ATTR unsigned long previousReadMs = 0;
// Used in DEPLOY_MODE because millis() resets after deep sleep while RTC memory persists.
RTC_DATA_ATTR float expectedNextElapsedMinutes = 0.0f;

RTC_DATA_ATTR int latchedStatusValue = NORMAL;
RTC_DATA_ATTR uint8_t releaseCounter = 0;
RTC_DATA_ATTR uint8_t criticalCandidateCounter = 0;
RTC_DATA_ATTR uint8_t weakWatchCandidateCounter = 0;

// Baseline warm-up and learned normal baseline.
RTC_DATA_ATTR bool baselineInitialized = false;
RTC_DATA_ATTR uint16_t baselineWarmupCount = 0;
RTC_DATA_ATTR uint16_t bootAbnormalCount = 0;
RTC_DATA_ATTR float warmupAirSum = 0.0f;
RTC_DATA_ATTR float warmupHumiditySum = 0.0f;
RTC_DATA_ATTR long warmupSmokeSum = 0;
RTC_DATA_ATTR float baselineAirTemp = 0.0f;
RTC_DATA_ATTR float baselineHumidity = 0.0f;
RTC_DATA_ATTR int baselineSmokeRaw = 0;
RTC_DATA_ATTR uint16_t baselineNvsCyclesSinceSave = 0;

// =========================
// Utility
// =========================
const char* statusToString(FireStatus status) {
  switch (status) {
    case SENSOR_FAULT: return "SENSOR_FAULT";
    case CALIBRATING: return "CALIBRATING";
    case NORMAL: return "NORMAL";
    case WATCH: return "WATCH";
    case WARNING: return "WARNING";
    case CRITICAL: return "CRITICAL";
    default: return "UNKNOWN";
  }
}

void debugPrintln(const String &msg) {
#if SERIAL_DEBUG
  Serial.println(msg);
#endif
}

void disableUnusedRadios() {
  WiFi.mode(WIFI_OFF);
  btStop();
}

void powerSensors(bool on) {
  if (SENSOR_POWER_PIN >= 0) {
    static bool powered = false;
    if (powered == on) return;
    digitalWrite(SENSOR_POWER_PIN, on ? HIGH : LOW);
    powered = on;
    if (on) delay(SENSOR_POWER_STABILIZE_MS);
  }
}

int median3(int a, int b, int c) {
  if ((a <= b && b <= c) || (c <= b && b <= a)) return b;
  if ((b <= a && a <= c) || (c <= a && a <= b)) return a;
  return c;
}

int readSharpOnce() {
  // GP2Y1014 typical timing: LED ON, wait 280us, read ADC, wait 40us, LED OFF.
  // Most Sharp circuits use LOW = LED ON and HIGH = LED OFF.
  digitalWrite(SHARP_LED_PIN, LOW);
  delayMicroseconds(280);
  int raw = analogRead(SHARP_ANALOG_PIN);
  delayMicroseconds(40);
  digitalWrite(SHARP_LED_PIN, HIGH);
  delayMicroseconds(9680);
  return raw;
}

int readSmokeMedian() {
  int a = readSharpOnce();
  delay(5);
  int b = readSharpOnce();
  delay(5);
  int c = readSharpOnce();
  return median3(a, b, c);
}

bool isShtReadingSane(float t, float h) {
  if (isnan(t) || isnan(h)) return false;
  if (t < SHT31_MIN_TEMP_C || t > SHT31_MAX_TEMP_C) return false;
  if (h < SHT31_MIN_HUMIDITY || h > SHT31_MAX_HUMIDITY) return false;
  return true;
}

bool beginSht31() {
  bool shtOk = sht31.begin(SHT31_I2C_ADDRESS_PRIMARY);
  activeSht31Address = SHT31_I2C_ADDRESS_PRIMARY;
  if (!shtOk) {
    shtOk = sht31.begin(SHT31_I2C_ADDRESS_SECONDARY);
    activeSht31Address = SHT31_I2C_ADDRESS_SECONDARY;
  }
  return shtOk;
}

// =========================
// Initialization
// =========================
void initSensors() {
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);

  if (SENSOR_POWER_PIN >= 0) {
    pinMode(SENSOR_POWER_PIN, OUTPUT);
    powerSensors(true);
  }

  pinMode(SHARP_LED_PIN, OUTPUT);
  digitalWrite(SHARP_LED_PIN, HIGH);
  analogReadResolution(12);

  bool shtOk = beginSht31();

#if SERIAL_DEBUG
  Serial.print("SHT31 init: ");
  Serial.println(shtOk ? "OK" : "FAILED");
  if (shtOk) {
    Serial.print("SHT31 address: 0x");
    Serial.println(activeSht31Address, HEX);
  }
#endif
}

bool initLoRa() {
  lastLoRaInitAttemptMs = millis();
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_FREQUENCY)) {
    loraReady = false;
    debugPrintln("LoRa init FAILED");
    return false;
  }

  LoRa.setSpreadingFactor(LORA_SPREADING_FACTOR);
  LoRa.setSignalBandwidth(LORA_SIGNAL_BANDWIDTH);
  LoRa.setCodingRate4(LORA_CODING_RATE_DENOMINATOR);
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.setTxPower(LORA_TX_POWER_DBM);
  LoRa.enableCrc();

  debugPrintln(
    String("LoRa init OK SF=") + LORA_SPREADING_FACTOR +
    " TX=" + LORA_TX_POWER_DBM + " dBm"
  );
  loraReady = true;
  return true;
}

bool ensureLoRaReady() {
  if (loraReady) return true;
  if (millis() - lastLoRaInitAttemptMs < LORA_INIT_RETRY_MS) return false;
  return initLoRa();
}

// =========================
// Read and validate sensors
// =========================
SensorData readSensors() {
  SensorData data;
  data.airTemp = NAN;
  data.humidity = NAN;
  data.smokeRaw = -1;
  data.shtOk = false;
  data.sharpOk = false;

  powerSensors(true);

  float t = sht31.readTemperature();
  float h = sht31.readHumidity();
  if (!isShtReadingSane(t, h)) {
    beginSht31();
    delay(20);
    t = sht31.readTemperature();
    h = sht31.readHumidity();
  }

  if (isShtReadingSane(t, h)) {
    data.airTemp = t;
    data.humidity = h;
    data.shtOk = true;
  }

  int smoke = readSmokeMedian();
  data.smokeRaw = smoke;
  data.sharpOk = (smoke >= 0 && smoke <= 4095);

  return data;
}

bool hasSensorFault(const SensorData &data) {
  if (!data.shtOk) return true;
  if (!data.sharpOk) return true;
  return false;
}

bool isBootAbnormalReading(const SensorData &data) {
  if (hasSensorFault(data)) return true;
  if (data.smokeRaw >= SMOKE_RAW_WARNING) return true;
  if (!isnan(data.airTemp) && data.airTemp >= AIR_TEMP_ABSOLUTE_WARNING) return true;
  if (!isnan(data.humidity) && data.humidity <= HUMIDITY_VERY_LOW) return true;
  return false;
}

bool isStoredBaselineSane(float airTemp, float humidity, int smokeRaw) {
  return !isnan(airTemp) && !isnan(humidity) &&
         airTemp >= SHT31_MIN_TEMP_C && airTemp <= SHT31_MAX_TEMP_C &&
         humidity >= SHT31_MIN_HUMIDITY && humidity <= SHT31_MAX_HUMIDITY &&
         smokeRaw >= 0 && smokeRaw <= 4095;
}

bool loadBaselineFromNvs() {
#if BASELINE_SAVE_TO_NVS && !TEST_MODE
  if (baselineInitialized) return true;

#if BASELINE_FORCE_RECALIBRATE
  if (baselinePrefs.begin("node_base", false)) {
    baselinePrefs.clear();
    baselinePrefs.end();
  }
  return false;
#else
  if (!baselinePrefs.begin("node_base", true)) return false;
  bool valid = baselinePrefs.getBool("valid", false);
  uint32_t version = baselinePrefs.getUInt("ver", 0);
  float airTemp = baselinePrefs.getFloat("air", NAN);
  float humidity = baselinePrefs.getFloat("hum", NAN);
  int smokeRaw = baselinePrefs.getInt("smoke", -1);
  baselinePrefs.end();

  if (!valid || version != BASELINE_STORAGE_VERSION ||
      !isStoredBaselineSane(airTemp, humidity, smokeRaw)) return false;

  baselineAirTemp = airTemp;
  baselineHumidity = humidity;
  baselineSmokeRaw = smokeRaw;
  baselineInitialized = true;
  baselineWarmupCount = BASELINE_WARMUP_CYCLES;
  bootAbnormalCount = 0;
  baselineNvsCyclesSinceSave = 0;
  debugPrintln("Baseline restored from NVS");
  return true;
#endif
#else
  return false;
#endif
}

void saveBaselineToNvs() {
#if BASELINE_SAVE_TO_NVS && !TEST_MODE
  if (!baselineInitialized ||
      !isStoredBaselineSane(baselineAirTemp, baselineHumidity, baselineSmokeRaw)) return;
  if (!baselinePrefs.begin("node_base", false)) return;
  baselinePrefs.putBool("valid", false);
  baselinePrefs.putUInt("ver", BASELINE_STORAGE_VERSION);
  baselinePrefs.putFloat("air", baselineAirTemp);
  baselinePrefs.putFloat("hum", baselineHumidity);
  baselinePrefs.putInt("smoke", baselineSmokeRaw);
  baselinePrefs.putBool("valid", true);
  baselinePrefs.end();
  baselineNvsCyclesSinceSave = 0;
  debugPrintln("Baseline saved to NVS");
#endif
}

bool clearLearnedBaseline() {
#if BASELINE_SAVE_TO_NVS && !TEST_MODE
  if (!baselinePrefs.begin("node_base", false)) return false;
  baselinePrefs.clear();
  baselinePrefs.end();
#endif

  baselineInitialized = false;
  baselineWarmupCount = 0;
  bootAbnormalCount = 0;
  warmupAirSum = 0.0f;
  warmupHumiditySum = 0.0f;
  warmupSmokeSum = 0;
  baselineAirTemp = 0.0f;
  baselineHumidity = 0.0f;
  baselineSmokeRaw = 0;
  baselineNvsCyclesSinceSave = 0;
  latchedStatusValue = CALIBRATING;
  releaseCounter = 0;
  criticalCandidateCounter = 0;
  weakWatchCandidateCounter = 0;
  baselineRecalibrationAcceptedThisCycle = true;
  debugPrintln("Baseline cleared; recalibration requested");
  return true;
}

String baselineRecalibrationBlockReason() {
  if (!commandSafetyReady) return "measurement_unavailable";
  if (hasSensorFault(commandSafetyData)) return "sensor_fault";
  if (commandSafetyStatus == CALIBRATING) return "already_calibrating";
  // Relocation from a cool room to a warmer site can leave the old baseline in
  // WARNING even though the current absolute readings are still safe.
  if (commandSafetyStatus == CRITICAL || commandSafetyStatus == SENSOR_FAULT) {
    return "unsafe_state";
  }
  if (isBootAbnormalReading(commandSafetyData)) return "unsafe_reading";
  return "";
}

bool updateBaselineWarmup(const SensorData &data) {
  if (baselineInitialized) return true;
  if (hasSensorFault(data)) return false;

  if (isBootAbnormalReading(data)) {
    if (bootAbnormalCount < 255) bootAbnormalCount++;
    return false;
  }

  warmupAirSum += data.airTemp;
  warmupHumiditySum += data.humidity;
  warmupSmokeSum += data.smokeRaw;
  baselineWarmupCount++;

  if (baselineWarmupCount >= BASELINE_WARMUP_CYCLES) {
    baselineAirTemp = warmupAirSum / baselineWarmupCount;
    baselineHumidity = warmupHumiditySum / baselineWarmupCount;
    baselineSmokeRaw = (int)(warmupSmokeSum / baselineWarmupCount);
    baselineInitialized = true;
    saveBaselineToNvs();
  }

  return baselineInitialized;
}

float getElapsedMinutesForDelta(unsigned long nowMs) {
#if TEST_MODE
  if (previousReadMs > 0 && nowMs >= previousReadMs) {
    float measured = (nowMs - previousReadMs) / 60000.0f;
    if (measured >= 0.001f) return measured;
  }
  if (expectedNextElapsedMinutes > 0.0f) return expectedNextElapsedMinutes;
  return LOOP_INTERVAL_MS / 60000.0f;
#else
  if (expectedNextElapsedMinutes > 0.0f) return expectedNextElapsedMinutes;
  return NORMAL_SLEEP_SEC / 60.0f;
#endif
}

DeltaData calculateDelta(const SensorData &current, const SensorData &previous, bool hasPrev, unsigned long nowMs) {
  DeltaData d;
  d.airTempDelta = 0.0f;
  d.humidityDelta = 0.0f;
  d.smokeDelta = 0;
  d.airTempRatePerMin = 0.0f;
  d.humidityRatePerMin = 0.0f;
  d.smokeRatePerMin = 0.0f;
  d.airTempBaselineDelta = 0.0f;
  d.humidityBaselineDelta = 0.0f;
  d.smokeBaselineDelta = 0;
  d.elapsedMinutes = 0.0f;

  if (hasPrev) {
    d.elapsedMinutes = getElapsedMinutesForDelta(nowMs);
    if (d.elapsedMinutes < 0.001f) d.elapsedMinutes = 0.001f;

    if (!isnan(current.airTemp) && !isnan(previous.airTemp)) d.airTempDelta = current.airTemp - previous.airTemp;
    if (!isnan(current.humidity) && !isnan(previous.humidity)) d.humidityDelta = current.humidity - previous.humidity;
    if (current.smokeRaw >= 0 && previous.smokeRaw >= 0) d.smokeDelta = current.smokeRaw - previous.smokeRaw;

    d.airTempRatePerMin = d.airTempDelta / d.elapsedMinutes;
    d.humidityRatePerMin = d.humidityDelta / d.elapsedMinutes;
    d.smokeRatePerMin = d.smokeDelta / d.elapsedMinutes;
  }

  if (baselineInitialized) {
    if (!isnan(current.airTemp)) d.airTempBaselineDelta = current.airTemp - baselineAirTemp;
    if (!isnan(current.humidity)) d.humidityBaselineDelta = current.humidity - baselineHumidity;
    if (current.smokeRaw >= 0) d.smokeBaselineDelta = current.smokeRaw - baselineSmokeRaw;
  }

  return d;
}

EvidenceFlags getEvidenceFlags(const SensorData &data, const DeltaData &delta) {
  EvidenceFlags e;
  float humidityDropFromBaseline = -delta.humidityBaselineDelta;

  bool smokeRateWatch = delta.smokeDelta >= SMOKE_RATE_MIN_DELTA_RAW &&
                        delta.smokeRatePerMin >= SMOKE_RATE_WATCH_PER_MIN;
  bool smokeRateWarning = delta.smokeDelta >= SMOKE_RATE_MIN_DELTA_RAW &&
                          delta.smokeRatePerMin >= SMOKE_RATE_WARNING_PER_MIN;
  bool smokeRateCritical = delta.smokeDelta >= SMOKE_RATE_MIN_DELTA_RAW &&
                           delta.smokeRatePerMin >= SMOKE_RATE_CRITICAL_PER_MIN;

  bool airTempRateWatch = delta.airTempDelta >= AIR_TEMP_RATE_MIN_DELTA_C &&
                          delta.airTempRatePerMin >= AIR_TEMP_RATE_WATCH_PER_MIN;
  bool airTempRateWarning = delta.airTempDelta >= AIR_TEMP_RATE_MIN_DELTA_C &&
                            delta.airTempRatePerMin >= AIR_TEMP_RATE_WARNING_PER_MIN;
  bool airTempRateCritical = delta.airTempDelta >= AIR_TEMP_RATE_MIN_DELTA_C &&
                             delta.airTempRatePerMin >= AIR_TEMP_RATE_CRITICAL_PER_MIN;

  bool humidityRateWatch = (-delta.humidityDelta) >= HUMIDITY_DROP_RATE_MIN_DELTA &&
                           (-delta.humidityRatePerMin) >= HUMIDITY_DROP_RATE_WATCH_PER_MIN;
  bool humidityRateWarning = (-delta.humidityDelta) >= HUMIDITY_DROP_RATE_MIN_DELTA &&
                             (-delta.humidityRatePerMin) >= HUMIDITY_DROP_RATE_WARNING_PER_MIN;
  bool humidityRateCritical = (-delta.humidityDelta) >= HUMIDITY_DROP_RATE_MIN_DELTA &&
                              (-delta.humidityRatePerMin) >= HUMIDITY_DROP_RATE_CRITICAL_PER_MIN;

  bool smokeBaselineWatch = delta.smokeBaselineDelta >= SMOKE_BASELINE_WATCH &&
                            data.smokeRaw >= SMOKE_RAW_WATCH_MIN;

  e.smokeWatch = smokeRateWatch || smokeBaselineWatch;
  e.smokeGroup = smokeRateWarning ||
                 delta.smokeBaselineDelta >= SMOKE_BASELINE_WARNING ||
                 data.smokeRaw >= SMOKE_RAW_WARNING;
  e.smokeCritical = smokeRateCritical ||
                    delta.smokeBaselineDelta >= SMOKE_BASELINE_CRITICAL ||
                    data.smokeRaw >= SMOKE_RAW_CRITICAL;

  e.heatWatch = airTempRateWatch ||
                delta.airTempBaselineDelta >= AIR_TEMP_BASELINE_WATCH;
  e.heatGroup = airTempRateWarning ||
                delta.airTempBaselineDelta >= AIR_TEMP_BASELINE_WARNING ||
                (!isnan(data.airTemp) && data.airTemp >= AIR_TEMP_ABSOLUTE_WARNING);
  e.heatCritical = airTempRateCritical ||
                   delta.airTempBaselineDelta >= AIR_TEMP_BASELINE_CRITICAL ||
                   (!isnan(data.airTemp) && data.airTemp >= AIR_TEMP_ABSOLUTE_CRITICAL);

  e.humidityWatch = humidityRateWatch ||
                    humidityDropFromBaseline >= HUMIDITY_BASELINE_DROP_WATCH;
  e.humidityGroup = humidityRateWarning ||
                    humidityDropFromBaseline >= HUMIDITY_BASELINE_DROP_WARNING ||
                    (!isnan(data.humidity) && data.humidity <= HUMIDITY_VERY_LOW);
  e.humidityCritical = humidityRateCritical ||
                       humidityDropFromBaseline >= HUMIDITY_BASELINE_DROP_CRITICAL ||
                       (!isnan(data.humidity) && data.humidity <= HUMIDITY_VERY_LOW);

  e.groupCount = 0;
  if (e.smokeGroup) e.groupCount++;
  if (e.heatGroup) e.groupCount++;
  if (e.humidityGroup) e.groupCount++;
  return e;
}

int calculateConfidence(const SensorData &data, const DeltaData &delta, const EvidenceFlags &e) {
  int score = 0;

  if (e.smokeCritical) score += 45;
  else if (e.smokeGroup) score += 32;
  else if (e.smokeWatch) score += 15;

  if (e.heatCritical) score += 30;
  else if (e.heatGroup) score += 25;
  else if (e.heatWatch) score += 10;

  if (e.humidityCritical) score += 25;
  else if (e.humidityGroup) score += 18;
  else if (e.humidityWatch) score += 8;

  if (!isnan(data.humidity)) {
    if (data.humidity <= HUMIDITY_VERY_LOW) score += 15;
    else if (data.humidity <= HUMIDITY_LOW) score += 10;

    // Fog/dew-like condition: reduce only weak smoke evidence.
    if (data.humidity >= HUMIDITY_HIGH_FOG_LIKE && !e.smokeCritical) {
      score -= FOG_PENALTY_SCORE;
    }
  }

  if (hasSensorFault(data)) score -= 40;
  if (!baselineInitialized) score = min(score, 60); // before baseline is ready, avoid overconfident claims unless absolute values are severe

  if (score < 0) score = 0;
  if (score > 100) score = 100;
  return score;
}

FireStatus evaluateFireStatusRaw(const SensorData &data, const EvidenceFlags &e, int confidence) {
  if (hasSensorFault(data)) return SENSOR_FAULT;

  if (!baselineInitialized) {
    if (bootAbnormalCount >= BOOT_ABNORMAL_REQUIRED_CYCLES) {
      if (e.smokeCritical && (e.heatGroup || e.humidityGroup)) return WARNING;
      return WATCH;
    }
    return CALIBRATING;
  }

  bool criticalSupported = (e.groupCount >= 2);
#if REQUIRE_SMOKE_FOR_CRITICAL
  criticalSupported = criticalSupported && e.smokeGroup;
#else
  criticalSupported = criticalSupported && (e.smokeGroup || (e.heatCritical && e.humidityCritical));
#endif

  if (confidence >= CRITICAL_CONFIDENCE && criticalSupported) return CRITICAL;

  // Without smoke, heat+dry is treated as risk/warning, not confirmed fire.
  if (confidence >= WARNING_CONFIDENCE && (e.groupCount >= 2 || e.smokeCritical)) return WARNING;

  // Avoid WATCH from a single weak environmental signal. Low humidity or mild
  // temperature drift alone is fire-weather context, not enough evidence of ignition.
  bool environmentalWatch = e.heatGroup || e.humidityGroup || (e.heatWatch && e.humidityWatch);
  bool scoreBackedWatch = confidence >= 30 && (e.smokeWatch || environmentalWatch || e.groupCount >= 1);

  if (e.smokeWatch || environmentalWatch || scoreBackedWatch) return WATCH;
  return NORMAL;
}

int statusSeverity(FireStatus status) {
  switch (status) {
    case SENSOR_FAULT: return 0;
    case CALIBRATING: return 1;
    case NORMAL: return 2;
    case WATCH: return 3;
    case WARNING: return 4;
    case CRITICAL: return 5;
    default: return 0;
  }
}

bool isWeakEnvironmentalWatch(FireStatus rawStatus, const EvidenceFlags &e, int confidence) {
  if (rawStatus != WATCH) return false;
  if (e.smokeWatch || e.smokeGroup || e.smokeCritical) return false;
  if (e.heatGroup || e.humidityGroup) return false;
  if (confidence >= WARNING_CONFIDENCE) return false;
  return e.heatWatch || e.humidityWatch;
}

FireStatus applyWeakWatchDebounce(FireStatus rawStatus, const EvidenceFlags &e, int confidence) {
#if WATCH_ENV_CONFIRM_CYCLES <= 1
  weakWatchCandidateCounter = 0;
  return rawStatus;
#else
  if (!isWeakEnvironmentalWatch(rawStatus, e, confidence)) {
    weakWatchCandidateCounter = 0;
    return rawStatus;
  }

  FireStatus latched = (FireStatus)latchedStatusValue;
  if (statusSeverity(latched) >= statusSeverity(WATCH)) {
    weakWatchCandidateCounter = 0;
    return rawStatus;
  }

  if (weakWatchCandidateCounter < 255) weakWatchCandidateCounter++;
  if (weakWatchCandidateCounter >= WATCH_ENV_CONFIRM_CYCLES) return rawStatus;
  return NORMAL;
#endif
}

FireStatus applyCriticalDebounce(FireStatus rawStatus) {
  if (rawStatus == CRITICAL) {
    if ((FireStatus)latchedStatusValue == CRITICAL) return CRITICAL;
    if (criticalCandidateCounter < 255) criticalCandidateCounter++;
    if (criticalCandidateCounter >= CRITICAL_CONFIRM_CYCLES) return CRITICAL;
    return WARNING; // first critical-looking cycle becomes warning/candidate
  }

  criticalCandidateCounter = 0;
  return rawStatus;
}

FireStatus applyStateLatch(FireStatus rawStatus, int confidence) {
  FireStatus latched = (FireStatus)latchedStatusValue;

  if (rawStatus == SENSOR_FAULT || rawStatus == CALIBRATING) {
    latchedStatusValue = rawStatus;
    releaseCounter = 0;
    return rawStatus;
  }

  if (statusSeverity(rawStatus) >= statusSeverity(latched)) {
    latchedStatusValue = rawStatus;
    releaseCounter = 0;
    return rawStatus;
  }

  bool allowRelease = false;
  if (latched == CRITICAL) allowRelease = confidence < CRITICAL_RELEASE_CONFIDENCE;
  else if (latched == WARNING) allowRelease = confidence < WARNING_RELEASE_CONFIDENCE;
  else allowRelease = true;

  if (allowRelease) {
    releaseCounter++;
    if (releaseCounter >= STATUS_RELEASE_CYCLES) {
      latchedStatusValue = rawStatus;
      releaseCounter = 0;
      return rawStatus;
    }
  } else {
    releaseCounter = 0;
  }

  return latched;
}

FireStatus evaluateFireStatus(const SensorData &data, const EvidenceFlags &e, int confidence) {
  FireStatus rawStatus = evaluateFireStatusRaw(data, e, confidence);
  rawStatus = applyCriticalDebounce(rawStatus);
  rawStatus = applyWeakWatchDebounce(rawStatus, e, confidence);
  return applyStateLatch(rawStatus, confidence);
}

void updateBaselineAfterDecision(const SensorData &data, const DeltaData &delta, const EvidenceFlags &e, FireStatus status) {
  if (!baselineInitialized || hasSensorFault(data)) return;

  if (status == NORMAL) {
    baselineAirTemp = baselineAirTemp + BASELINE_EMA_ALPHA * (data.airTemp - baselineAirTemp);
    baselineHumidity = baselineHumidity + BASELINE_EMA_ALPHA * (data.humidity - baselineHumidity);
    baselineSmokeRaw = (int)(baselineSmokeRaw + BASELINE_EMA_ALPHA * (data.smokeRaw - baselineSmokeRaw));
    if (baselineNvsCyclesSinceSave < BASELINE_NVS_SAVE_INTERVAL_CYCLES) {
      baselineNvsCyclesSinceSave++;
    }
    if (baselineNvsCyclesSinceSave >= BASELINE_NVS_SAVE_INTERVAL_CYCLES) {
      saveBaselineToNvs();
    }
  } else if (status == WATCH && !e.smokeWatch && !e.smokeGroup) {
    // Natural day/night heat and humidity drift can produce WATCH without smoke.
    // Adapt slowly so the node does not stay in WATCH all afternoon.
    baselineAirTemp = baselineAirTemp + BASELINE_WATCH_NO_SMOKE_ALPHA * (data.airTemp - baselineAirTemp);
    baselineHumidity = baselineHumidity + BASELINE_WATCH_NO_SMOKE_ALPHA * (data.humidity - baselineHumidity);
  }
}

void addFloatOrNull(JsonDocument &doc, const char *key, float value) {
  if (isnan(value)) doc[key] = nullptr;
  else doc[key] = value;
}

String sensorHealthString(const SensorData &data) {
  if (hasSensorFault(data)) return "FAULT";
  if (!baselineInitialized) return "CAL";
  return "OK";
}

uint32_t plannedReportIntervalSeconds(FireStatus status) {
#if TEST_MODE
  return status == CRITICAL ? max(1UL, CRITICAL_CONTINUE_INTERVAL_MS / 1000UL)
                            : max(1UL, LOOP_INTERVAL_MS / 1000UL);
#else
  if (status == CRITICAL) return max(1UL, CRITICAL_CONTINUE_INTERVAL_MS / 1000UL);
  if (status == CALIBRATING) return CALIBRATING_SLEEP_SEC;
  if (status == WATCH) return WATCH_SLEEP_SEC;
  if (status == WARNING) return WARNING_SLEEP_SEC;
  if (status == SENSOR_FAULT) return SENSOR_FAULT_SLEEP_SEC;
  return NORMAL_SLEEP_SEC;
#endif
}

String buildJsonPacket(const SensorData &data, const DeltaData &delta, FireStatus status, int confidence) {
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  seq++;

  doc["t"] = (status == CRITICAL) ? "c" : "s";
  doc["id"] = NODE_ID;
  doc["q"] = seq;
  doc["sid"] = bootSessionId;
  doc["ri"] = plannedReportIntervalSeconds(status);
  doc["st"] = statusToString(status);
  doc["c"] = confidence;
  addFloatOrNull(doc, "at", data.airTemp);
  addFloatOrNull(doc, "h", data.humidity);
  doc["sm"] = data.smokeRaw;

  // Baseline deltas are used by the backend risk engine.
  doc["sr"] = delta.smokeBaselineDelta;
  doc["ar"] = delta.airTempBaselineDelta;
  doc["hr"] = delta.humidityBaselineDelta;

  doc["sh"] = sensorHealthString(data);

  if (!baselineInitialized) {
    doc["bc"] = baselineWarmupCount;
    doc["bt"] = BASELINE_WARMUP_CYCLES;
  }
  String payload;
  serializeJson(doc, payload);

  // Emergency fallback if future fields make the payload too long.
  if (payload.length() > MAX_SAFE_PAYLOAD_BYTES) {
    StaticJsonDocument<MAX_JSON_SIZE> mini;
    mini["t"] = (status == CRITICAL) ? "c" : "s";
    mini["id"] = NODE_ID;
    mini["q"] = seq;
    mini["sid"] = bootSessionId;
    mini["ri"] = plannedReportIntervalSeconds(status);
    mini["st"] = statusToString(status);
    mini["c"] = confidence;
    mini["at"] = data.airTemp;
    mini["h"] = data.humidity;
    mini["sm"] = data.smokeRaw;
    mini["sr"] = delta.smokeBaselineDelta;
    mini["ar"] = delta.airTempBaselineDelta;
    mini["hr"] = delta.humidityBaselineDelta;
    mini["sh"] = sensorHealthString(data);
    if (!baselineInitialized) {
      mini["bc"] = baselineWarmupCount;
      mini["bt"] = BASELINE_WARMUP_CYCLES;
    }
    serializeJson(mini, payload);
  }

  return payload;
}

bool listenForGatewayCommand(uint32_t expectedSeq);

bool sendLoRaPacket(const String &payload, bool useRandomDelay, bool requireGatewayAck = false) {
  if (!ensureLoRaReady()) {
    debugPrintln("TX skipped: LoRa is not ready");
    return false;
  }

  if (useRandomDelay) {
    long d = random(RANDOM_TX_DELAY_MIN_MS, RANDOM_TX_DELAY_MAX_MS + 1);
#if SERIAL_DEBUG
    Serial.print("Random TX delay ms: ");
    Serial.println(d);
#endif
    delay(d);
  }

  LoRa.idle();
  LoRa.beginPacket();
  LoRa.print(payload);
  bool ok = LoRa.endPacket();
  bool acknowledged = false;
  if (ok) acknowledged = listenForGatewayCommand(seq);
  else LoRa.sleep();

#if SERIAL_DEBUG
  Serial.print("TX bytes: ");
  Serial.println(payload.length());
  Serial.print("TX: ");
  Serial.println(payload);
  Serial.print("TX status: ");
  Serial.println(ok ? "OK" : "FAILED");
  if (requireGatewayAck) {
    Serial.print("Gateway ACK: ");
    Serial.println(acknowledged ? "YES" : "NO");
  }
#endif
  return ok && (!requireGatewayAck || acknowledged);
}

bool sendSensorPacketWithAck(const String &payload) {
#if SENSOR_REQUIRE_GATEWAY_ACK
  for (int attempt = 1; attempt <= SENSOR_ACK_MAX_ATTEMPTS; attempt++) {
#if SERIAL_DEBUG
    Serial.print("Sensor TX attempt: ");
    Serial.print(attempt);
    Serial.print("/");
    Serial.println(SENSOR_ACK_MAX_ATTEMPTS);
#endif
    if (sendLoRaPacket(payload, true, true)) return true;
  }
  debugPrintln("Sensor TX ended without Gateway ACK");
  return false;
#else
  return sendLoRaPacket(payload, true);
#endif
}

#if USE_GPS
bool isGpsCoordinateValid(double latitude, double longitude) {
  if (isnan(latitude) || isnan(longitude)) return false;
  if (latitude < -90.0 || latitude > 90.0) return false;
  if (longitude < -180.0 || longitude > 180.0) return false;
  if (fabs(latitude) < 0.000001 && fabs(longitude) < 0.000001) return false;
  return true;
}

void powerGps(bool on) {
  if (GPS_POWER_PIN >= 0) {
    pinMode(GPS_POWER_PIN, OUTPUT);
    digitalWrite(GPS_POWER_PIN, on ? HIGH : LOW);
    if (on) delay(1000);
  }
}

bool loadGpsLocationFromNvs(GpsLocation &fix) {
#if GPS_SAVE_TO_NVS
  if (GPS_FORCE_RECALIBRATE) return false;
  if (!gpsPrefs.begin("node_gps", true)) return false;

  bool storedValid = gpsPrefs.getBool("valid", false);
  double latitude = gpsPrefs.getDouble("lat", 0.0);
  double longitude = gpsPrefs.getDouble("lng", 0.0);
  gpsPrefs.end();

  if (!storedValid || !isGpsCoordinateValid(latitude, longitude)) return false;

  fix.latitude = latitude;
  fix.longitude = longitude;
  fix.valid = true;
  return true;
#else
  (void)fix;
  return false;
#endif
}

bool loadGpsManualModeFromNvs() {
#if GPS_SAVE_TO_NVS
  if (GPS_FORCE_RECALIBRATE) return false;
  if (!gpsPrefs.begin("node_gps", true)) return false;
  bool manualMode = gpsPrefs.getBool("manual", false);
  gpsPrefs.end();
  return manualMode;
#else
  return false;
#endif
}

void saveGpsLocationToNvs(const GpsLocation &fix) {
#if GPS_SAVE_TO_NVS
  if (!fix.valid) return;
  if (!gpsPrefs.begin("node_gps", false)) return;
  gpsPrefs.putBool("manual", false);
  gpsPrefs.putBool("valid", true);
  gpsPrefs.putDouble("lat", fix.latitude);
  gpsPrefs.putDouble("lng", fix.longitude);
  gpsPrefs.end();
#else
  (void)fix;
#endif
}

void saveGpsManualModeToNvs() {
#if GPS_SAVE_TO_NVS
  if (!gpsPrefs.begin("node_gps", false)) return;
  gpsPrefs.clear();
  gpsPrefs.putBool("manual", true);
  gpsPrefs.end();
#endif
}

void clearGpsLocationFromNvs() {
#if GPS_SAVE_TO_NVS
  if (!gpsPrefs.begin("node_gps", false)) return;
  gpsPrefs.clear();
  gpsPrefs.end();
#endif
}

String buildGpsPacket(const GpsLocation &fix, bool gpsFix, const char *errorCode) {
  StaticJsonDocument<MAX_JSON_SIZE> doc;
  seq++;

  doc["t"] = "gps";
  doc["id"] = NODE_ID;
  doc["q"] = seq;
  doc["sid"] = bootSessionId;
  doc["gf"] = gpsFix ? 1 : 0;

  if (gpsFix && fix.valid) {
    doc["la"] = fix.latitude;
    doc["ln"] = fix.longitude;
  } else {
    doc["er"] = errorCode;
  }

  String payload;
  serializeJson(doc, payload);
  return payload;
}

void sendGpsLocationPackets(const GpsLocation &fix) {
  String payload = buildGpsPacket(fix, true, "");
  for (int i = 0; i < GPS_PACKET_REPEAT_COUNT; i++) {
    sendLoRaPacket(payload, true);
  }
}

void sendGpsFailedPacket(const GpsLocation &partialFix) {
  String payload = buildGpsPacket(partialFix, false, "gps_failed");
  sendLoRaPacket(payload, true);
}

void resetGpsLocation(GpsLocation &fix) {
  fix.latitude = 0.0;
  fix.longitude = 0.0;
  fix.valid = false;
}

void stopGpsAcquisition() {
  Serial2.end();
  powerGps(false);
}

void stopGpsAndUseManualLocation() {
  if (gpsOneShotState == GPS_ONE_SHOT_ACQUIRING) stopGpsAcquisition();
  resetGpsLocation(nodeGpsLocation);
  resetGpsLocation(gpsWorkingLocation);
  gpsFixReportPending = false;
  gpsFailureReportPending = false;
  gpsRetryRemainingSec = 0;
  gpsOneShotState = GPS_ONE_SHOT_DONE;
  saveGpsManualModeToNvs();

#if SERIAL_DEBUG
  Serial.println("Manual location accepted; automatic GPS search disabled");
#endif
}

void startGpsAcquisition() {
  resetGpsLocation(gpsWorkingLocation);
  gps = TinyGPSPlus();
  powerGps(true);
  Serial2.begin(GPS_BAUD, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  gpsStartMs = millis();
  gpsLastAttemptMs = gpsStartMs;
  gpsRetryRemainingSec = 0;
  gpsLastDebugMs = 0;
  gpsByteCount = 0;
  gpsOneShotState = GPS_ONE_SHOT_ACQUIRING;

#if SERIAL_DEBUG
  Serial.println("GPS one-shot: acquisition started in background");
#endif
}

void startGpsReacquisition() {
  if (gpsOneShotState == GPS_ONE_SHOT_ACQUIRING) stopGpsAcquisition();

  resetGpsLocation(nodeGpsLocation);
  resetGpsLocation(gpsWorkingLocation);
  clearGpsLocationFromNvs();
  gpsFixReportPending = false;
  gpsFailureReportPending = false;
  gpsOneShotState = GPS_ONE_SHOT_IDLE;
  startGpsAcquisition();

#if SERIAL_DEBUG
  Serial.println("GPS re-acquire command accepted");
#endif
}

void sendPendingGpsReports() {
  if (gpsFixReportPending) {
    gpsFixReportPending = false;
    sendGpsLocationPackets(nodeGpsLocation);
  }

  if (gpsFailureReportPending) {
    gpsFailureReportPending = false;
    sendGpsFailedPacket(gpsWorkingLocation);
  }
}

void serviceOneShotGps() {
  sendPendingGpsReports();

  if (gpsOneShotState == GPS_ONE_SHOT_FAILED && !nodeGpsLocation.valid) {
    uint64_t retryWaitMs = (uint64_t)gpsRetryRemainingSec * 1000ULL;
    if (gpsRetryRemainingSec == 0 || (uint64_t)(millis() - gpsLastAttemptMs) >= retryWaitMs) {
      startGpsAcquisition();
    }
  }

  if (gpsOneShotState != GPS_ONE_SHOT_ACQUIRING) return;

  while (Serial2.available() > 0) {
    gps.encode((char)Serial2.read());
    gpsByteCount++;
  }

  if (gps.location.isValid() &&
      gps.satellites.isValid() &&
      gps.satellites.value() >= GPS_MIN_SATELLITES &&
      gps.hdop.isValid() &&
      gps.hdop.hdop() > 0.0 &&
      gps.hdop.hdop() <= GPS_MAX_HDOP &&
      gps.location.age() <= GPS_MAX_LOCATION_AGE_MS &&
      isGpsCoordinateValid(gps.location.lat(), gps.location.lng())) {
    gpsWorkingLocation.latitude = gps.location.lat();
    gpsWorkingLocation.longitude = gps.location.lng();
    gpsWorkingLocation.valid = true;
    nodeGpsLocation = gpsWorkingLocation;
    saveGpsLocationToNvs(nodeGpsLocation);
    stopGpsAcquisition();
    gpsOneShotState = GPS_ONE_SHOT_DONE;
    gpsFixReportPending = true;

#if SERIAL_DEBUG
    Serial.println("GPS one-shot: fix acquired and saved");
#endif
    return;
  }

  if (millis() - gpsStartMs >= GPS_FIX_TIMEOUT_MS) {
    stopGpsAcquisition();
    gpsOneShotState = GPS_ONE_SHOT_FAILED;
    gpsFailureReportPending = true;
    gpsLastAttemptMs = millis();
    gpsRetryRemainingSec = max(1UL, GPS_RETRY_INTERVAL_MS / 1000UL);

#if SERIAL_DEBUG
    Serial.println("GPS one-shot: gps_failed, continuing sensor loop");
#endif
    return;
  }

#if SERIAL_DEBUG
  if (millis() - gpsLastDebugMs > 10000UL) {
    gpsLastDebugMs = millis();
    Serial.print("GPS waiting, bytes=");
    Serial.print(gpsByteCount);
    Serial.print(" chars=");
    Serial.print(gps.charsProcessed());
    Serial.print(" ok=");
    Serial.print(gps.passedChecksum());
    Serial.print(" fail=");
    Serial.print(gps.failedChecksum());
    Serial.print(" sat=");
    Serial.print(gps.satellites.isValid() ? gps.satellites.value() : 0);
    Serial.print(" hdop=");
    Serial.print(gps.hdop.isValid() ? gps.hdop.hdop() : 0.0);
    Serial.print(" elapsed_sec=");
    Serial.println((millis() - gpsStartMs) / 1000UL);
  }
#endif
}

void startOneShotGpsIfNeeded() {
  if (!USE_GPS) return;

  if (loadGpsManualModeFromNvs()) {
    gpsOneShotState = GPS_ONE_SHOT_DONE;
#if SERIAL_DEBUG
    Serial.println("GPS one-shot: manual location mode, automatic search skipped");
#endif
    return;
  }

  GpsLocation fix;
  if (loadGpsLocationFromNvs(fix)) {
    nodeGpsLocation = fix;
    gpsOneShotState = GPS_ONE_SHOT_DONE;
    gpsFixReportPending = true;
#if SERIAL_DEBUG
    Serial.println("GPS one-shot: using stored NVS location");
#endif
    return;
  }

  if (gpsRetryRemainingSec > 0) {
    resetGpsLocation(nodeGpsLocation);
    resetGpsLocation(gpsWorkingLocation);
    gpsOneShotState = GPS_ONE_SHOT_FAILED;
    gpsLastAttemptMs = millis();
#if SERIAL_DEBUG
    Serial.print("GPS one-shot: retry deferred for ");
    Serial.print(gpsRetryRemainingSec);
    Serial.println(" sec");
#endif
    return;
  }

  startGpsAcquisition();
}

void accountGpsRetryBeforeSleep(uint64_t sleepSec) {
  if (gpsOneShotState != GPS_ONE_SHOT_FAILED || gpsRetryRemainingSec == 0) return;

  uint32_t awakeSec = (millis() - gpsLastAttemptMs) / 1000UL;
  uint64_t elapsedSec = (uint64_t)awakeSec + sleepSec;
  if (elapsedSec >= gpsRetryRemainingSec) gpsRetryRemainingSec = 0;
  else gpsRetryRemainingSec -= (uint32_t)elapsedSec;
}

bool isOneShotGpsActive() {
  return gpsOneShotState == GPS_ONE_SHOT_ACQUIRING ||
         gpsFixReportPending ||
         gpsFailureReportPending;
}
#endif

void loadLastHandledCommandId() {
  if (!commandPrefs.begin("node_cmd", true)) return;
  lastHandledCommandId = commandPrefs.getString("last_id", "");
  commandPrefs.end();
}

void saveLastHandledCommandId(const String &commandId) {
  if (!commandPrefs.begin("node_cmd", false)) return;
  commandPrefs.putString("last_id", commandId);
  commandPrefs.end();
  lastHandledCommandId = commandId;
}

void sendCommandAckPacket(const String &commandId, bool accepted, const String &reason) {
  StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
  doc["t"] = "cmd_ack";
  doc["id"] = NODE_ID;
  doc["cid"] = commandId;
  doc["sid"] = bootSessionId;
  doc["ok"] = accepted ? 1 : 0;
  if (!accepted && reason.length() > 0) doc["r"] = reason;

  String payload;
  serializeJson(doc, payload);
  LoRa.idle();
  LoRa.beginPacket();
  LoRa.print(payload);
  LoRa.endPacket();
}

String handleGatewayCommand(const String &payload) {
  StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
  if (deserializeJson(doc, payload)) return "";
  if (String((const char *)(doc["t"] | "")) != "cmd") return "";
  if (String((const char *)(doc["id"] | "")) != NODE_ID) return "";

  String commandId = String((const char *)(doc["cid"] | ""));
  String command = String((const char *)(doc["cmd"] | ""));
  if (commandId.length() == 0 ||
      (command != "gps_reacquire" && command != "gps_manual" &&
       command != "baseline_recalibrate")) return "";

  lastCommandAccepted = true;
  lastCommandResultReason = "";
  if (commandId == lastHandledCommandId) return commandId;

  if (command == "baseline_recalibrate") {
    lastCommandResultReason = baselineRecalibrationBlockReason();
    if (lastCommandResultReason.length() > 0) {
      lastCommandAccepted = false;
      return commandId;
    }
    if (!clearLearnedBaseline()) {
      lastCommandAccepted = false;
      lastCommandResultReason = "storage_error";
      return commandId;
    }
    saveLastHandledCommandId(commandId);
    return commandId;
  }

#if USE_GPS
  if (command == "gps_manual") stopGpsAndUseManualLocation();
  else startGpsReacquisition();
  saveLastHandledCommandId(commandId);
  return commandId;
#else
  return "";
#endif
}

bool isUplinkAck(const String &payload, uint32_t expectedSeq) {
  StaticJsonDocument<COMMAND_MAX_JSON_SIZE> doc;
  if (deserializeJson(doc, payload)) return false;
  if (String((const char *)(doc["t"] | "")) != "rx_ack") return false;
  if (String((const char *)(doc["id"] | "")) != NODE_ID) return false;
  uint32_t ackSessionId = doc["sid"] | 0UL;
  uint32_t ackSeq = doc["q"] | 0UL;
  return ackSessionId == bootSessionId && ackSeq == expectedSeq;
}

bool listenForGatewayCommand(uint32_t expectedSeq) {
  unsigned long startedAt = millis();
  String commandAckId;
  bool commandAccepted = true;
  String commandResultReason;
  bool uplinkAcknowledged = false;
  LoRa.receive();

  while (millis() - startedAt < COMMAND_RX_WINDOW_MS) {
    int packetSize = LoRa.parsePacket();
    if (!packetSize) {
      delay(2);
      continue;
    }

    String payload;
    while (LoRa.available()) payload += (char)LoRa.read();
    if (isUplinkAck(payload, expectedSeq)) uplinkAcknowledged = true;
    String handledCommandId = handleGatewayCommand(payload);
    if (handledCommandId.length() > 0) {
      commandAckId = handledCommandId;
      commandAccepted = lastCommandAccepted;
      commandResultReason = lastCommandResultReason;
    }
    LoRa.receive();
  }

  if (commandAckId.length() > 0) {
    sendCommandAckPacket(commandAckId, commandAccepted, commandResultReason);
  }
  if (loraReady) LoRa.sleep();
  return uplinkAcknowledged;
}

void delayWithBackgroundTasks(unsigned long durationMs) {
  unsigned long startMs = millis();
  while (millis() - startMs < durationMs) {
#if USE_GPS
    serviceOneShotGps();
#endif
    unsigned long elapsedMs = millis() - startMs;
    unsigned long remainingMs = (elapsedMs < durationMs) ? durationMs - elapsedMs : 0;
    delay(remainingMs > 50UL ? 50UL : remainingMs);
  }
}

void printSensorDebug(const SensorData &data, const DeltaData &delta, const EvidenceFlags &e, FireStatus status, int confidence) {
#if SERIAL_DEBUG
  Serial.println("========== SENSOR NODE ==========");
  Serial.print("Node: "); Serial.println(NODE_ID);
  Serial.print("State: "); Serial.println(statusToString(status));
  Serial.print("Confidence: "); Serial.println(confidence);
  Serial.print("Baseline Ready: "); Serial.println(baselineInitialized ? "YES" : "NO");
  Serial.print("Warmup Count: "); Serial.print(baselineWarmupCount); Serial.print("/"); Serial.println(BASELINE_WARMUP_CYCLES);
  Serial.print("Boot Abnormal Count: "); Serial.println(bootAbnormalCount);
  Serial.print("Air Temp: "); Serial.println(data.airTemp);
  Serial.print("Humidity: "); Serial.println(data.humidity);
  Serial.print("Smoke Raw: "); Serial.println(data.smokeRaw);
  Serial.print("Smoke Delta: "); Serial.println(delta.smokeDelta);
  Serial.print("Smoke Rate/min: "); Serial.println(delta.smokeRatePerMin);
  Serial.print("Smoke Baseline Delta: "); Serial.println(delta.smokeBaselineDelta);
  Serial.print("Air Delta: "); Serial.println(delta.airTempDelta);
  Serial.print("Air Rate/min: "); Serial.println(delta.airTempRatePerMin);
  Serial.print("Air Baseline Delta: "); Serial.println(delta.airTempBaselineDelta);
  Serial.print("Humidity Delta: "); Serial.println(delta.humidityDelta);
  Serial.print("Humidity Rate/min: "); Serial.println(delta.humidityRatePerMin);
  Serial.print("Humidity Baseline Delta: "); Serial.println(delta.humidityBaselineDelta);
  Serial.print("Evidence G/S/Hu: "); Serial.print(e.groupCount); Serial.print(" /"); Serial.print(e.smokeGroup); Serial.print("/"); Serial.print(e.heatGroup); Serial.print("/"); Serial.println(e.humidityGroup);
  Serial.print("Baseline Smoke/Air/Humidity: ");
  Serial.print(baselineSmokeRaw); Serial.print(" / ");
  Serial.print(baselineAirTemp); Serial.print(" / ");
  Serial.println(baselineHumidity);
  Serial.print("Critical Candidate Counter: "); Serial.println(criticalCandidateCounter);
  Serial.print("Weak Watch Candidate Counter: "); Serial.println(weakWatchCandidateCounter);
  Serial.print("Latched Status: "); Serial.println(statusToString((FireStatus)latchedStatusValue));
  Serial.print("Release Counter: "); Serial.println(releaseCounter);
  Serial.print("Sensor Health: "); Serial.println(sensorHealthString(data));
  Serial.println("=================================");
#endif
}

uint64_t sleepSecondsForStatus(FireStatus status) {
#if TEST_MODE
  return 0;
#else
  if (status == CALIBRATING) return CALIBRATING_SLEEP_SEC;
  if (status == WATCH) return WATCH_SLEEP_SEC;
  if (status == WARNING) return WARNING_SLEEP_SEC;
  if (status == SENSOR_FAULT) return SENSOR_FAULT_SLEEP_SEC;
  return NORMAL_SLEEP_SEC;
#endif
}

void storeExpectedNextInterval(FireStatus status) {
#if TEST_MODE
  if (status == CRITICAL) expectedNextElapsedMinutes = CRITICAL_CONTINUE_INTERVAL_MS / 60000.0f;
  else expectedNextElapsedMinutes = LOOP_INTERVAL_MS / 60000.0f;
#else
  if (status == CRITICAL) expectedNextElapsedMinutes = CRITICAL_CONTINUE_INTERVAL_MS / 60000.0f;
  else expectedNextElapsedMinutes = sleepSecondsForStatus(status) / 60.0f;
#endif
}

void enterDeepSleepForSeconds(uint64_t sleepSec) {
#if !TEST_MODE
#if USE_GPS
  accountGpsRetryBeforeSleep(sleepSec);
#endif
  if (loraReady) LoRa.sleep();
  powerSensors(false);
  esp_sleep_enable_timer_wakeup(sleepSec * 1000000ULL);
  esp_deep_sleep_start();
#endif
}

void enterDeepSleepByStatus(FireStatus status) {
#if !TEST_MODE
  enterDeepSleepForSeconds(sleepSecondsForStatus(status));
#else
  (void)status;
#endif
}

#if USE_GPS
void serviceGpsUntilNextMeasurementOrSleep(FireStatus status) {
#if !TEST_MODE
  const uint64_t intervalSec = sleepSecondsForStatus(status);
  const unsigned long intervalMs = (unsigned long)(intervalSec * 1000ULL);
  const unsigned long startedAt = millis();

  // GPS needs the ESP32 awake to parse UART, but the environmental sensors do
  // not need to be powered or retransmitted while waiting for a fix.
  powerSensors(false);
  while (isOneShotGpsActive() && millis() - startedAt < intervalMs) {
    serviceOneShotGps();
    delay(50);
  }

  const unsigned long elapsedMs = millis() - startedAt;
  if (elapsedMs >= intervalMs) return;

  const uint64_t remainingMs = (uint64_t)intervalMs - elapsedMs;
  const uint64_t remainingSec = (remainingMs + 999ULL) / 1000ULL;
  enterDeepSleepForSeconds(remainingSec > 0 ? remainingSec : 1);
#else
  (void)status;
#endif
}
#endif

void sendMeasurement(const SensorData &current, const DeltaData &delta, FireStatus status, int confidence) {
  String payload = buildJsonPacket(current, delta, status, confidence);
  sendSensorPacketWithAck(payload);
}

void runOneMeasurementCycle() {
  unsigned long nowMs = millis();
  SensorData current = readSensors();

  updateBaselineWarmup(current);
  DeltaData delta = calculateDelta(current, previousData, hasPreviousData, nowMs);
  EvidenceFlags evidence = getEvidenceFlags(current, delta);
  int confidence = calculateConfidence(current, delta, evidence);
  FireStatus status = evaluateFireStatus(current, evidence, confidence);

  commandSafetyData = current;
  commandSafetyStatus = status;
  commandSafetyReady = true;

  printSensorDebug(current, delta, evidence, status, confidence);
  sendMeasurement(current, delta, status, confidence);
  if (baselineRecalibrationAcceptedThisCycle) {
    status = CALIBRATING;
    baselineRecalibrationAcceptedThisCycle = false;
  }
#if USE_GPS
  serviceOneShotGps();
#endif
  updateBaselineAfterDecision(current, delta, evidence, status);

  previousData = current;
  hasPreviousData = true;
  previousReadMs = nowMs;
  storeExpectedNextInterval(status);

#if TEST_MODE
  if (status == CRITICAL) delayWithBackgroundTasks(CRITICAL_CONTINUE_INTERVAL_MS);
  else delayWithBackgroundTasks(LOOP_INTERVAL_MS);
#else
  if (status == CRITICAL || (KEEP_AWAKE_DURING_WARNING && status == WARNING)) {
    const unsigned long activeIntervalMs = status == CRITICAL
      ? CRITICAL_CONTINUE_INTERVAL_MS
      : WARNING_SLEEP_SEC * 1000UL;
    delayWithBackgroundTasks(activeIntervalMs);
  }
#if USE_GPS
  else if (isOneShotGpsActive()) {
    serviceGpsUntilNextMeasurementOrSleep(status);
  }
#endif
  else {
    enterDeepSleepByStatus(status);
  }
#endif
}


void resetRuntimeStateForTestMode() {
#if TEST_MODE
  // During bench testing, start clean after every reset/upload so old RTC counters
  // such as bootAbnormalCount or latched SENSOR_FAULT do not confuse debugging.
  seq = 0;
  do {
    bootSessionId = esp_random();
  } while (bootSessionId == 0);
  hasPreviousData = false;
  previousReadMs = 0;
  expectedNextElapsedMinutes = 0.0f;
  latchedStatusValue = NORMAL;
  releaseCounter = 0;
  criticalCandidateCounter = 0;
  weakWatchCandidateCounter = 0;
  baselineInitialized = false;
  baselineWarmupCount = 0;
  bootAbnormalCount = 0;
  warmupAirSum = 0.0f;
  warmupHumiditySum = 0.0f;
  warmupSmokeSum = 0;
  baselineAirTemp = 0.0f;
  baselineHumidity = 0.0f;
  baselineSmokeRaw = 0;
  baselineNvsCyclesSinceSave = 0;
#endif
}

void setup() {
#if SERIAL_DEBUG
  Serial.begin(SERIAL_BAUD);
  delay(1000);
#endif

  resetRuntimeStateForTestMode();

  disableUnusedRadios();
  randomSeed(esp_random());

  if (bootSessionId == 0) {
    do {
      bootSessionId = esp_random();
    } while (bootSessionId == 0);
  }
  loadBaselineFromNvs();
  loadLastHandledCommandId();

  debugPrintln("Starting Wildfire Sensor Node...");
  debugPrintln(String("Mode: ") + (TEST_MODE ? "TEST_MODE" : "DEPLOY_MODE"));
  debugPrintln(String("Node ID: ") + NODE_ID);

  initSensors();
  loraReady = initLoRa();
#if USE_GPS
  startOneShotGpsIfNeeded();
#endif
}

void loop() {
  runOneMeasurementCycle();
}
