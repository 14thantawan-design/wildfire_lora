// Execute the actual C++ decision functions from both sketches as WebAssembly.
// Set CLANGXX to a clang++ with wasm-ld; no board, network, or sensor is required.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const compiler = process.env.CLANGXX || 'C:/Users/14tha/AppData/Local/Android/Sdk/ndk/28.2.13676358/toolchains/llvm/prebuilt/windows-x86_64/bin/clang++.exe'
const output = resolve(root, 'tmp/risk-tests')
mkdirSync(output, { recursive: true })

// Decision logic now lives in one shared module set used by both sensor sketches.
// Read those headers directly so this test always exercises the deployed C++ functions.
const sharedSource = [
  'node_state.h',
  'sensor_reading.h',
  'risk_rules.h',
  'lora_transport.h',
  'node_app.h'
].map((file) => readFileSync(resolve(root, 'sensor_common', file), 'utf8')).join('\n')
const sharedConfig = readFileSync(resolve(root, 'sensor_common', 'sensor_config.h'), 'utf8')

const names = [
  'median3',
  'readParticleMedianMilliVolts',
  'particleUgM3FromMilliVolts',
  'hasSensorFault',
  'statusSeverity',
  'evaluateRawRisk',
  'applyStateLatch',
  'evaluateFireStatus'
]

function extract(source, name) {
  const match = source.match(new RegExp('^\\w+ ' + name + '\\([^]*?^}', 'm'))
  assert.ok(match, 'Missing function: ' + name)
  return match[0]
}

for (const sketch of ['sensor_node', 'sensor_node_2']) {
  const entrySource = readFileSync(resolve(root, sketch, sketch + '.ino'), 'utf8')
  const source = sharedSource
  const nodeConfig = readFileSync(resolve(root, sketch, 'config.h'), 'utf8')
  const config = nodeConfig + '\n' + sharedConfig
  assert.match(entrySource, /sensor_common\/node_app\.h/,
    'Each node must load the shared application modules')
  assert.match(entrySource, /void setup\(\)\s*\{\s*setupNode\(\);\s*\}/,
    'Each Arduino sketch must show setup() and delegate to setupNode()')
  assert.match(entrySource, /void loop\(\)\s*\{\s*runOneMeasurementCycle\(\);\s*\}/,
    'Each Arduino sketch must show loop() and one measurement cycle')
  assert.match(sharedSource, /void setupNode\(\)/,
    'Shared application module must provide setupNode()')
  assert.match(nodeConfig, new RegExp('#define NODE_ID "NODE0[12]"'))
  assert.match(nodeConfig, /sensor_common\/sensor_config\.h/,
    'Each node must load the shared sensor configuration')
  assert.match(config, /#define NORMAL_REPORT_INTERVAL_SEC 300UL/)
  assert.match(config, /#define WATCH_REPORT_INTERVAL_SEC 120UL/)
  assert.match(config, /#define WARNING_REPORT_INTERVAL_SEC 20UL/)
  assert.match(config, /#define RISK_MODEL_VERSION 8/)
  assert.match(config, /#define STATUS_RELEASE_CYCLES 3/)
  assert.doesNotMatch(source, /doc\["rb"\]/,
    'Packets must not duplicate the decision as reason bits')
  assert.match(source, /doc\["rv"\] = RISK_MODEL_VERSION/,
    'Packets must identify the research-threshold model')
  assert.match(source, /addFloatOrNull\(doc, "pm", data\.particleUgM3\)/,
    'Packets must include estimated particle concentration')
  assert.doesNotMatch(source, /doc\["(?:c|pd|sr|ar|hr|bc|bt)"\]/,
    'Current packets must not include score or baseline fields')

  const functions = names.map((name) => extract(source, name)).join('\n')

  const types = ['FireStatus', 'SensorData'].map((name) => {
    const match = source.match(new RegExp('(?:enum|struct) ' + name + '[^\\{]*\\{[^]*?};'))
    assert.ok(match, 'Missing type: ' + name)
    return match[0]
  }).join('\n')

  const cpp = `
#include "${resolve(root, sketch, 'config.h').replaceAll('\\', '/')}"
typedef unsigned char uint8_t;
typedef unsigned short uint16_t;
typedef unsigned int uint32_t;
#define NAN (__builtin_nanf(""))
bool isnan(float value) { return value != value; }
${types}
uint32_t rtcRiskStateVersion = RTC_RISK_STATE_VERSION;
int latchedStatusValue = NORMAL;
uint8_t releaseCounter = 0;
int reads = 0;
int particleSamples[3] = {100, 4000, 120};
int readSharpOnce() { return particleSamples[reads++]; }
void delay(int) {}
${functions}
extern "C" {
void reset() {
  rtcRiskStateVersion = RTC_RISK_STATE_VERSION;
  latchedStatusValue = NORMAL;
  releaseCounter = 0;
}
int medianTest() {
  reads = 0;
  int value = readParticleMedianMilliVolts();
  return value * 10 + reads;
}
float conversionTest(int milliVolts) { return particleUgM3FromMilliVolts(milliVolts); }
int run(float temp, float humidity, float particle, int healthy) {
  SensorData data = {temp, humidity, 600, particle, healthy != 0, healthy != 0};
  return (int)evaluateFireStatus(data);
}
int raw(float temp, float humidity, float particle, int healthy) {
  SensorData data = {temp, humidity, 600, particle, healthy != 0, healthy != 0};
  return (int)evaluateRawRisk(data);
}
}`

  const input = resolve(output, sketch + '.cpp')
  const binary = resolve(output, sketch + '.wasm')
  writeFileSync(input, cpp)
  const compiled = spawnSync(compiler, [
    '--target=wasm32', '-O2', '-nostdlib',
    '-Wl,--no-entry', '-Wl,--export-all', input, '-o', binary
  ], { encoding: 'utf8' })
  assert.equal(compiled.status, 0, compiled.error?.message || compiled.stderr)

  const { instance } = await WebAssembly.instantiate(readFileSync(binary))
  const api = instance.exports
  const raw = (t = 30, h = 70, p = 20, healthy = 1) => api.raw(t, h, p, healthy)
  const run = (t = 30, h = 70, p = 20, healthy = 1) => api.run(t, h, p, healthy)

  assert.equal(api.medianTest(), 1203, 'Read exactly three samples and reject the 4000 mV spike')
  assert.equal(api.conversionTest(1100), 100,
    'Convert 1100 mV using 600 mV clean-air voltage and 5 mV/(ug/m3)')

  // Enum: SENSOR_FAULT=0, NORMAL=1, WATCH=2, WARNING=3.
  assert.equal(raw(35, 50, 50), 1, 'All inclusive NORMAL boundaries stay NORMAL')
  assert.equal(raw(35.01, 50, 50), 2, 'Temperature above 35 enters WATCH')
  assert.equal(raw(35, 49.99, 50), 2, 'Humidity below 50 enters WATCH')
  assert.equal(raw(35, 50, 50.01), 2, 'Particle above 50 enters WATCH')
  assert.equal(raw(45, 50, 50), 2, 'Exactly 45 is WATCH, not WARNING')
  assert.equal(raw(45.01, 50, 50), 3, 'Temperature above 45 enters WARNING')
  assert.equal(raw(30, 50, 150), 2, 'Exactly 150 is WATCH, not WARNING')
  assert.equal(raw(30, 50, 150.01), 3, 'Particle above 150 enters WARNING')
  assert.equal(raw(30, 30, 20), 3, '30C together with 30%RH enters WARNING')
  assert.equal(raw(29.99, 30, 20), 2, 'Humidity alone stays WATCH')
  assert.equal(raw(30, 70, 20, 0), 0, 'A failed sensor reports SENSOR_FAULT separately')

  api.reset()
  assert.equal(run(46, 60, 20), 3, 'Escalation to WARNING is immediate')
  assert.equal(run(), 3, 'First clean sample holds WARNING')
  assert.equal(run(), 3, 'Second clean sample still holds WARNING')
  assert.equal(run(), 2, 'Third clean sample releases WARNING to WATCH')
  assert.equal(run(), 2, 'First WATCH recovery sample holds WATCH')
  assert.equal(run(), 2, 'Second WATCH recovery sample holds WATCH')
  assert.equal(run(), 1, 'Third WATCH recovery sample releases to NORMAL')

  api.reset()
  assert.equal(run(36, 60, 20), 2, 'Escalation to WATCH is immediate')
  assert.equal(run(46, 60, 20), 3, 'WATCH escalates to WARNING immediately')

  console.log(`${sketch}: C++ thresholds, boundaries, latch, median and conversion passed`)
}
