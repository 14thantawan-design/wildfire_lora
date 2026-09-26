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
  'evaluateRawRisk',
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
  assert.match(source, /if \(status == WATCH\) return 120UL/)
  assert.match(source, /if \(status == WARNING\) return 20UL/)
  assert.match(source, /if \(status == SENSOR_FAULT\) return 300UL/)
  assert.match(source, /data\.particleAdc = readParticleMedianAdc\(\)/,
    'Each measurement cycle must use the median of three smoke readings')
  assert.doesNotMatch(source, /doc\["rb"\]/,
    'Packets must not duplicate the decision as reason bits')
  assert.match(source, /doc\["adc"\] = data\.particleAdc/,
    'Packets must include the raw particle ADC value')
  assert.doesNotMatch(source, /doc\["(?:c|pd|sr|ar|hr|bc|bt)"\]/,
    'Current packets must not include score or baseline fields')

  const functions = names.map((name) => extract(source, name)).join('\n')
  const medianFunction = extract(source, 'median3')
  const smokeFunction = extract(source, 'readParticleMedianAdc')

  const types = ['FireStatus', 'SensorData'].map((name) => {
    const match = source.match(new RegExp('(?:enum|struct) ' + name + '[^\\{]*\\{[^]*?};'))
    assert.ok(match, 'Missing type: ' + name)
    return match[0]
  }).join('\n')

  const cpp = `
#include "${resolve(root, sketch, 'config.h').replaceAll('\\', '/')}"
typedef unsigned short uint16_t;
typedef unsigned int uint32_t;
${types}
${medianFunction}
int samples[3];
int readIndex;
int readSharpOnce() { return samples[readIndex++]; }
void delay(int) {}
${smokeFunction}
${functions}
extern "C" {
int smoke(int a, int b, int c) {
  samples[0] = a; samples[1] = b; samples[2] = c;
  readIndex = 0;
  return readParticleMedianAdc();
}
int smokeReads() { return readIndex; }
int run(float temp, float humidity, int particle) {
  SensorData data = {temp, humidity, particle};
  return (int)evaluateFireStatus(data);
}
int raw(float temp, float humidity, int particle) {
  SensorData data = {temp, humidity, particle};
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
  const raw = (t = 30, h = 70, p = 20) => api.raw(t, h, p)
  const run = (t = 30, h = 70, p = 20) => api.run(t, h, p)

  // Enum: NORMAL=0, WATCH=1, WARNING=2, SENSOR_FAULT=3.
  assert.equal(raw(35, 50, 300), 0, 'All inclusive NORMAL boundaries stay NORMAL')
  assert.equal(raw(35.01, 50, 300), 1, 'Temperature above 35 enters WATCH')
  assert.equal(raw(35, 49.99, 300), 1, 'Humidity below 50 enters WATCH')
  assert.equal(raw(35, 50, 301), 1, 'Particle ADC above 300 enters WATCH')
  assert.equal(raw(45, 50, 300), 1, 'Exactly 45 is WATCH, not WARNING')
  assert.equal(raw(45.01, 50, 300), 2, 'Temperature above 45 enters WARNING')
  assert.equal(raw(30, 50, 1100), 1, 'Exactly 1100 ADC is WATCH, not WARNING')
  assert.equal(raw(30, 50, 1101), 2, 'Particle ADC above 1100 enters WARNING')
  assert.equal(raw(30, 30, 20), 2, '30C together with 30%RH enters WARNING')
  assert.equal(raw(29.99, 30, 20), 1, 'Humidity alone stays WATCH')
  assert.equal(run(46, 60, 20), 2, 'Current WARNING reading returns WARNING')
  assert.equal(run(), 0, 'Next NORMAL reading returns NORMAL immediately')
  assert.equal(raw(NaN, 70, 20), 3, 'Failed temperature reading reports SENSOR_FAULT')
  assert.equal(raw(30, NaN, 20), 3, 'Failed humidity reading reports SENSOR_FAULT')
  assert.equal(raw(86, 70, 20), 3, 'Temperature outside sensor range reports SENSOR_FAULT')
  assert.equal(raw(30, 101, 20), 3, 'Humidity outside sensor range reports SENSOR_FAULT')
  assert.equal(raw(30, 70, 4096), 3, 'ADC outside sensor range reports SENSOR_FAULT')
  assert.equal(run(30, 70, -1), 3, 'Failed smoke ADC reports SENSOR_FAULT')
  assert.equal(api.smoke(100, 900, 110), 110, 'One high smoke spike is excluded')
  assert.equal(api.smokeReads(), 3, 'Smoke sensor is read exactly three times')
  assert.equal(api.smoke(900, 100, 110), 110, 'Median does not depend on reading order')

  console.log(`${sketch}: C++ risk thresholds passed`)
}
