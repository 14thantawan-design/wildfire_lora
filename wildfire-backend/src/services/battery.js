const BATTERY_PERCENT_CURVE_MV = Object.freeze([
  [3300, 0],
  [3400, 5],
  [3500, 10],
  [3600, 20],
  [3700, 40],
  [3800, 60],
  [3900, 70],
  [4000, 80],
  [4100, 90],
  [4200, 100]
]);

function batteryPercentFromMillivolts(millivolts) {
  if (typeof millivolts !== 'number' || !Number.isFinite(millivolts)) {
    return undefined;
  }

  const first = BATTERY_PERCENT_CURVE_MV[0];
  const last = BATTERY_PERCENT_CURVE_MV[BATTERY_PERCENT_CURVE_MV.length - 1];
  if (millivolts <= first[0]) return first[1];
  if (millivolts >= last[0]) return last[1];

  for (let index = 1; index < BATTERY_PERCENT_CURVE_MV.length; index += 1) {
    const upper = BATTERY_PERCENT_CURVE_MV[index];
    if (millivolts > upper[0]) continue;

    const lower = BATTERY_PERCENT_CURVE_MV[index - 1];
    const position = (millivolts - lower[0]) / (upper[0] - lower[0]);
    const interpolated = lower[1] + position * (upper[1] - lower[1]);
    return Math.max(0, Math.min(100, Math.round(interpolated)));
  }

  return last[1];
}

function batteryPercentFromVoltage(voltage) {
  if (typeof voltage !== 'number' || !Number.isFinite(voltage)) {
    return undefined;
  }
  return batteryPercentFromMillivolts(voltage * 1000);
}

module.exports = {
  BATTERY_PERCENT_CURVE_MV,
  batteryPercentFromMillivolts,
  batteryPercentFromVoltage
};
