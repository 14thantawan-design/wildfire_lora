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
const names = ['median3', 'readSmokeMedian', 'hasSensorFault', 'getEvidenceFlags',
  'calculateConfidence', 'evaluateFireStatusRaw', 'statusSeverity',
  'isWeakEnvironmentalWatch', 'applyWeakWatchDebounce', 'applyCriticalDebounce',
  'applyStateLatch', 'evaluateFireStatus', 'updateBaselineAfterDecision']

function extract(source, name) {
  const match = source.match(new RegExp('^\\w+ ' + name + '\\([^]*?^}', 'm'))
  assert.ok(match, 'Missing function: ' + name)
  return match[0]
}

let firstFunctions
for (const sketch of ['sensor_node', 'sensor_node_2']) {
  const source = readFileSync(resolve(root, sketch, sketch + '.ino'), 'utf8')
  const functions = names.map(name => extract(source, name)).join('\n')
  if (firstFunctions) assert.equal(functions, firstFunctions, 'Both nodes must use identical decision functions')
  firstFunctions = functions
  const types = ['FireStatus', 'SensorData', 'DeltaData', 'EvidenceFlags'].map(name =>
    source.match(new RegExp('(?:enum|struct) ' + name + ' {[^]*?};'))[0]).join('\n')
  const cpp = `
#include "${resolve(root, sketch, 'config.h').replaceAll('\\', '/')}"
typedef unsigned char uint8_t;
typedef unsigned short uint16_t;
template <typename T> T min(T a, T b) { return a < b ? a : b; }
bool isnan(float x) { return x != x; }
${types}
bool baselineInitialized = true;
int latchedStatusValue = NORMAL;
uint8_t releaseCounter = 0, criticalCandidateCounter = 0, weakWatchCandidateCounter = 0;
uint16_t bootAbnormalCount = 0, baselineNvsCyclesSinceSave = 0;
float baselineAirTemp = 30, baselineHumidity = 70;
int baselineSmokeRaw = 100;
void saveBaselineToNvs() {}
int reads = 0, smokeSamples[3] = {100, 4000, 120};
int readSharpOnce() { return smokeSamples[reads++]; }
void delay(int) {}
${functions}
extern "C" {
void reset(int ready) {
  baselineInitialized = ready; latchedStatusValue = NORMAL;
  releaseCounter = criticalCandidateCounter = weakWatchCandidateCounter = 0;
  bootAbnormalCount = 0; baselineNvsCyclesSinceSave = 0;
  baselineAirTemp = 30; baselineHumidity = 70; baselineSmokeRaw = 100;
}
int medianTest() { reads = 0; int value = readSmokeMedian(); return value * 10 + reads; }
int run(float temp, float humidity, int smoke, float td, float hd, int sd,
        float tr, float hr, float sr, int healthy) {
  SensorData data = {temp, humidity, smoke, healthy != 0, healthy != 0};
  DeltaData delta = {};
  delta.airTempBaselineDelta = td; delta.humidityBaselineDelta = hd; delta.smokeBaselineDelta = sd;
  delta.airTempDelta = tr; delta.humidityDelta = hr; delta.smokeDelta = (int)sr;
  delta.airTempRatePerMin = tr; delta.humidityRatePerMin = hr; delta.smokeRatePerMin = sr;
  EvidenceFlags evidence = getEvidenceFlags(data, delta);
  int score = calculateConfidence(data, delta, evidence);
  return evaluateFireStatus(data, evidence, score) * 1000 + score;
}
int rawState(int score) {
  SensorData data = {30, 70, 100, true, true};
  EvidenceFlags evidence = {};
  return evaluateFireStatusRaw(data, evidence, score);
}
float adapt(int state, int smoke) {
  SensorData data = {32, 65, 200, true, true};
  DeltaData delta = {};
  EvidenceFlags evidence = {}; evidence.smokeWatch = smoke;
  updateBaselineAfterDecision(data, delta, evidence, (FireStatus)state);
  return baselineAirTemp;
}
}`
  const input = resolve(output, sketch + '.cpp')
  const binary = resolve(output, sketch + '.wasm')
  writeFileSync(input, cpp)
  const compiled = spawnSync(compiler, ['--target=wasm32', '-O2', '-nostdlib',
    '-Wl,--no-entry', '-Wl,--export-all', input, '-o', binary], { encoding: 'utf8' })
  assert.equal(compiled.status, 0, compiled.error?.message || compiled.stderr)
  const { instance } = await WebAssembly.instantiate(readFileSync(binary))
  const api = instance.exports
  const sample = (t = 30, h = 70, s = 100, td = 0, hd = 0, sd = 0, tr = 0, hr = 0, sr = 0, healthy = 1) =>
    api.run(t, h, s, td, hd, sd, tr, hr, sr, healthy)
  assert.equal(api.medianTest(), 1203, 'Read exactly three samples and reject the 4000 spike')
  api.reset(1)
  assert.equal(sample(), 2000)
  assert.equal(sample(32, 65, 100, 2, -5), 2020, 'First weak environmental WATCH waits')
  assert.equal(sample(32, 65, 100, 2, -5), 3020)
  api.reset(1)
  assert.equal(sample(34, 60, 100, 4, -10), 4050)
  api.reset(1)
  assert.equal(sample(36, 55, 100, 6, -15), 4080, 'First CRITICAL waits in WARNING')
  assert.equal(sample(36, 55, 100, 6, -15), 5080, 'Heat and dryness reach CRITICAL without smoke')
  assert.equal(sample(), 5000)
  assert.equal(sample(), 5000)
  assert.equal(sample(), 2000, 'Three clean measurements release')
  api.reset(1)
  assert.equal(sample(30, 70, 1800), 3020, 'Smoke alone cannot exceed WATCH')
  api.reset(1)
  assert.equal(sample(40, 45), 4050, 'Absolute values work with zero baseline differences')
  api.reset(1)
  assert.equal(sample(50, 35, 1800, 6, -15, 900), 4100, 'No double counting absolute and baseline evidence')
  assert.equal(sample(50, 35, 1800, 6, -15, 900), 5100)
  api.reset(1)
  assert.equal(sample(30, 85, 100, 0, 15), 2000, 'Humidity increase is not a drop')
  api.reset(1)
  assert.equal(sample(30, 70, 100, 0, 0, 0, 1.2, -4), 4080, 'Existing rate evidence still participates')
  api.reset(0)
  assert.equal(sample(), 1000, 'Startup is CALIBRATING')
  assert.equal(sample(50, 35, 1800), 1060, 'Startup score cap is retained')
  api.reset(1)
  assert.ok(sample(50, 35, 1800, 0, 0, 0, 0, 0, 0, 0) < 1000, 'Sensor fault takes priority')
  for (const [score, state] of [[0, 2], [19, 2], [20, 3], [49, 3], [50, 4], [74, 4], [75, 5], [100, 5]]) {
    assert.equal(api.rawState(score), state)
  }
  api.reset(1)
  assert.ok(Math.abs(api.adapt(2, 0) - 30.1) < 0.0001, 'NORMAL adapts 5%')
  api.reset(1)
  assert.ok(Math.abs(api.adapt(3, 0) - 30.02) < 0.0001, 'WATCH without smoke adapts 1%')
  for (const [state, smoke] of [[3, 1], [4, 0], [5, 0]]) {
    api.reset(1)
    assert.equal(api.adapt(state, smoke), 30, 'Freeze baseline on smoke/WARNING/CRITICAL')
  }
  console.log(sketch + ': C++ score, boundary, median, confirmation, recovery and baseline checks passed')
}
