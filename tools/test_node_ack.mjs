// Run the actual C++ receive loop / command handler as Wasm with radio and clock mocks.
// No real LoRa, credentials, board or network is accessed.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const compiler = process.env.CLANGXX || 'C:/Users/14tha/AppData/Local/Android/Sdk/ndk/28.2.13676358/toolchains/llvm/prebuilt/windows-x86_64/bin/clang++.exe'
const output = resolve(root, '.codex-build/node-ack-tests')
mkdirSync(output, { recursive: true })
const source = readFileSync(resolve(root, 'sensor_common/gateway_commands.h'), 'utf8')
function extract(name) {
  const match = source.match(new RegExp('^(?:bool|String) ' + name + '\\([^]*?^}', 'm'))
  assert.ok(match, `Missing function: ${name}`)
  return match[0]
}
const cpp = `
#define SECURE_LORA_ENABLED 1
#define NODE_ID "NODE01"
#include "${resolve(root, 'sensor_common/sensor_config.h').replaceAll('\\', '/')}"
bool equal(const char* a, const char* b) { while (*a && *a == *b) { a++; b++; } return *a == *b; }
struct String {
  const char* text;
  String(const char* value = "") : text(value) {}
  unsigned length() const { unsigned count = 0; while (text[count]) count++; return count; }
  bool operator==(const String& other) const { return equal(text, other.text); }
  bool operator!=(const String& other) const { return !(*this == other); }
};
struct Packet { const char* type; const char* node; const char* cid; const char* cmd; int ack; bool authenticated; bool malformed; };
Packet current;
unsigned nowMs, originMs, arrivalMs;
int scenario, packetsRead, sleepCalls, commandAcks, gpsActions, commandSaves, commandAt, sentAt;
bool loraReady = true, lastCommandAccepted = true;
String lastCommandResultReason, lastHandledCommandId;
unsigned long millis() { return nowMs; }
void delay(unsigned long duration) { nowMs += duration; }
struct Radio {
  void receive() {}
  int parsePacket() {
    unsigned elapsed = nowMs - originMs;
    if (scenario == 3) {
      if ((packetsRead == 0 && elapsed >= 1000) || (packetsRead == 1 && elapsed >= 1500)) {
        current.authenticated = packetsRead++ == 1;
        return 64;
      }
      return 0;
    }
    if (scenario == 0 || packetsRead || elapsed < arrivalMs) return 0;
    packetsRead++;
    return 64;
  }
  void sleep() { sleepCalls++; }
} LoRa;
bool receiveSecureReply(String &payload) { payload = String("mock packet"); return current.authenticated; }
struct Field {
  Packet* packet; const char* key;
  const char* operator|(const char*) {
    if (equal(key, "t")) return packet->type;
    if (equal(key, "id")) return packet->node;
    if (equal(key, "cid")) return packet->cid;
    return packet->cmd;
  }
  int operator|(int) { return packet->ack; }
};
template<unsigned Size> struct StaticJsonDocument { Packet packet; Field operator[](const char* key) { return {&packet, key}; } };
template<unsigned Size> bool deserializeJson(StaticJsonDocument<Size> &doc, const String&) {
  doc.packet = current; return current.malformed;
}
void stopGpsAndUseManualLocation() { gpsActions++; commandAt = nowMs - originMs; }
void startGpsReacquisition() { gpsActions++; commandAt = nowMs - originMs; }
void saveLastHandledCommandId(const String& id) { commandSaves++; lastHandledCommandId = id; }
void sendCommandAckPacket(const String&, bool, const String&) { commandAcks++; sentAt = nowMs - originMs; }
${extract('handleGatewayCommand')}
${extract('listenForGatewayCommand')}
extern "C" int run(int which, int requireAck, int wrap) {
  scenario = which; nowMs = originMs = wrap ? 4294967000U : 0;
  arrivalMs = which == 12 ? 5998 : which == 13 ? 6000 : 1000;
  packetsRead = sleepCalls = commandAcks = gpsActions = commandSaves = 0;
  commandAt = sentAt = -1;
  lastHandledCommandId = String(which == 11 ? "cmd_test" : "");
  current = {"reply", "NODE01", "", "", 1, true, false};
  if (which == 2) current.authenticated = false;
  if (which == 4) current.node = "NODE02";
  if (which == 5) current.type = "not_an_ack";
  if (which == 6) current.malformed = true;
  if (which == 7) current.ack = 0;
  if (which == 8) current.ack = 2;
  if (which >= 9 && which <= 11) { current.cid = "cmd_test"; current.cmd = which == 10 ? "gps_reacquire" : "gps_manual"; }
  return listenForGatewayCommand(requireAck != 0);
}
extern "C" unsigned elapsed() { return nowMs - originMs; }
extern "C" int sleeps() { return sleepCalls; }
extern "C" int actions() { return gpsActions; }
extern "C" int acks() { return commandAcks; }
extern "C" int commandTime() { return commandAt; }
extern "C" int sendTime() { return sentAt; }
`
const input = resolve(output, 'ack.cpp')
const binary = resolve(output, 'ack.wasm')
writeFileSync(input, cpp)
const compiled = spawnSync(compiler, ['--target=wasm32', '-O2', '-nostdlib',
  '-Wl,--no-entry', '-Wl,--export-all', input, '-o', binary], { encoding: 'utf8' })
assert.equal(compiled.status, 0, compiled.error?.message || compiled.stderr)
const { instance } = await WebAssembly.instantiate(readFileSync(binary))
const api = instance.exports
const run = (scenario, requireAck = 1, wrap = 0) => {
  const result = api.run(scenario, requireAck, wrap)
  assert.equal(api.sleeps(), 1, 'Radio is always put to sleep after the receive loop')
  return result
}
assert.equal(run(1), 1); assert.equal(api.elapsed(), 1000, 'Valid ACK exits without waiting the other five seconds')
assert.equal(run(0), 0); assert.equal(api.elapsed(), 6000, 'No ACK times out at six seconds')
for (const [scenario, name] of [[2, 'Unauthenticated frame'], [4, 'Other node'], [5, 'Wrong type'],
  [6, 'Malformed JSON'], [7, 'No positive sensor ACK'], [8, 'Invalid ACK flag']]) {
  assert.equal(run(scenario), 0, name)
  assert.equal(api.elapsed(), 6000, name + ' cannot trigger an early exit')
}
assert.equal(run(3), 1); assert.equal(api.elapsed(), 1500, 'Invalid frame does not block the following valid ACK')
for (const scenario of [9, 10]) {
  assert.equal(run(scenario), 1)
  assert.equal(api.actions(), 1, 'Attached GPS command is handled')
  assert.equal(api.acks(), 1, 'Command result is sent before radio sleep')
  assert.equal(api.commandTime(), 1000); assert.equal(api.sendTime(), 1000)
  assert.equal(api.elapsed(), 1000, 'Attached command does not force the full receive window')
}
assert.equal(run(11), 1); assert.equal(api.actions(), 0); assert.equal(api.acks(), 1, 'Duplicate command is acknowledged, not repeated')
assert.equal(run(7, 0), 0); assert.equal(api.elapsed(), 1000, 'GPS reply a=0 finishes RX without reporting a sensor ACK')
assert.equal(run(12), 1); assert.equal(api.elapsed(), 5998, 'ACK just before deadline is accepted')
assert.equal(run(13), 0); assert.equal(api.elapsed(), 6000, 'ACK at/after deadline is not accepted')
assert.equal(run(1, 1, 1), 1); assert.equal(api.elapsed(), 1000, 'Timer rollover preserves early exit')
assert.equal(run(0, 1, 1), 0); assert.equal(api.elapsed(), 6000, 'Timer rollover preserves timeout')
console.log('FG1 C++ ACK loop: early exit, 6s timeout, invalid frames, attached commands, GPS and timer rollover passed.')
