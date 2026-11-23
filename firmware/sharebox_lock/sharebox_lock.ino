/**
 * 共享盒子电磁锁固件
 *
 * 开发板：ESP32
 * 库（Arduino 库管理器）：
 *   PubSubClient  （Nick O'Leary）
 *   ArduinoJson   （Benoit Blanchon，7.x）
 *
 * 接线：GPIO 不能直接驱动电磁锁。
 *   ESP32 GPIO4 -> 继电器模块 IN
 *   ESP32 GND   -> 继电器模块 GND（共地）
 *   继电器 COM/NO 串在 12V 电源和电磁锁之间
 *   吸合 3 秒时锁舌应收回，随后松开，避免线圈长通电
 *
 * 改下面的 WiFi、MQTT_HOST（跑 server 那台电脑的局域网 IP）后烧录。
 * UNLOCK_TOKEN 必须和 server/config.js 的 unlockToken 一致。
 * MQTT 客户端 ID 固定为 sharebox_<盒子编号>，服务端靠它判断是否在线。
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

const char* WIFI_SSID = "Eric Home";
const char* WIFI_PASS = "iamaman9";
// 跑 `npm start` 时，日志里「固件 MQTT_HOST 填 …」就是当前局域网 IP。换网络后按新地址改。
const char* MQTT_HOST = "192.168.0.11";
const uint16_t MQTT_PORT = 1883;

const char* BOX_CODE = "BOX1001";
const char* UNLOCK_TOKEN = "sharebox-dev-token";

const int LOCK_PIN = 4;
// 继电器 DC+ 接 5V，ESP32 高电平只有 3.3V。低电平触发时 3.3V 仍会被当成有效，红灯会常亮。
// 跳线帽放在 COM 和 H，平时输出低电平，开锁时输出高电平。
const bool LOCK_ACTIVE_LOW = false;
const unsigned long PULSE_MS = 3000;
const unsigned long WIFI_RETRY_MS = 5000;
const unsigned long MQTT_RETRY_MS = 3000;

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

char topicCmd[64];
char topicState[64];
char clientId[64];

bool pulsing = false;
unsigned long pulseUntil = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastMqttAttempt = 0;

void setLock(bool engaged) {
  int level;
  if (engaged) {
    level = LOCK_ACTIVE_LOW ? LOW : HIGH;
  } else {
    level = LOCK_ACTIVE_LOW ? HIGH : LOW;
  }
  digitalWrite(LOCK_PIN, level);
}

void servicePulse() {
  if (pulsing && (long)(millis() - pulseUntil) >= 0) {
    setLock(false);
    pulsing = false;
    Serial.println("lock released");
  }
}

void publishState(const char* lockStatus, const char* cmdId, const char* reason) {
  JsonDocument doc;
  doc["lockStatus"] = lockStatus;
  doc["ts"] = millis();
  if (cmdId && cmdId[0]) doc["cmdId"] = cmdId;
  if (reason && reason[0]) doc["reason"] = reason;

  char buf[256];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  if (n == 0 || n >= sizeof(buf)) {
    Serial.println("state json overflow");
    return;
  }
  if (!mqtt.publish(topicState, buf, false)) {
    Serial.println("state publish failed");
  }
}

void onMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.println("bad json");
    return;
  }

  const char* cmd = doc["cmd"] | "";
  if (strcmp(cmd, "unlock") != 0) return;

  char cmdId[40];
  const char* rawId = doc["cmdId"] | "";
  strncpy(cmdId, rawId, sizeof(cmdId) - 1);
  cmdId[sizeof(cmdId) - 1] = '\0';

  const char* token = doc["token"] | "";
  if (strcmp(token, UNLOCK_TOKEN) != 0) {
    Serial.println("unlock rejected: token");
    publishState("failed", cmdId, "口令不正确");
    return;
  }

  Serial.printf("unlock %s\n", cmdId);
  setLock(true);
  pulsing = true;
  pulseUntil = millis() + PULSE_MS;
  publishState("opened", cmdId, "");
}

bool connectMqtt() {
  if (mqtt.connected()) return true;
  Serial.printf("mqtt connecting %s\n", MQTT_HOST);
  bool ok = mqtt.connect(
    clientId,
    topicState,
    0,
    false,
    "{\"lockStatus\":\"offline\"}"
  );
  if (!ok) {
    Serial.printf("mqtt failed rc=%d\n", mqtt.state());
    return false;
  }
  if (!mqtt.subscribe(topicCmd)) {
    Serial.println("subscribe failed");
    mqtt.disconnect();
    return false;
  }
  Serial.println("mqtt connected");
  return true;
}

void setup() {
  Serial.begin(115200);
  // 先写锁存再切输出，避免上电瞬间把继电器吸合
  digitalWrite(LOCK_PIN, LOCK_ACTIVE_LOW ? HIGH : LOW);
  pinMode(LOCK_PIN, OUTPUT);
  setLock(false);

  snprintf(topicCmd, sizeof(topicCmd), "sharebox/%s/cmd", BOX_CODE);
  snprintf(topicState, sizeof(topicState), "sharebox/%s/state", BOX_CODE);
  snprintf(clientId, sizeof(clientId), "sharebox_%s", BOX_CODE);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lastWifiAttempt = millis();

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(512);

  Serial.printf("box %s pin %d\n", BOX_CODE, LOCK_PIN);
}

void loop() {
  servicePulse();

  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiAttempt >= WIFI_RETRY_MS) {
      lastWifiAttempt = millis();
      Serial.println("wifi reconnect");
      WiFi.begin(WIFI_SSID, WIFI_PASS);
    }
    delay(20);
    return;
  }

  if (!mqtt.connected() && millis() - lastMqttAttempt >= MQTT_RETRY_MS) {
    lastMqttAttempt = millis();
    connectMqtt();
  }

  mqtt.loop();
}
