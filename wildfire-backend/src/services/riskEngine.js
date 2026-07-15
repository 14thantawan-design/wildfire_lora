const SERVER_STATES = ['CALIBRATING', 'NORMAL', 'WATCH', 'WARNING', 'CRITICAL', 'SENSOR_FAULT', 'OFFLINE'];
const FIRE_DANGER_LEVELS = ['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH'];
const SMOKE_LOW_STABLE_RAW = 2;
const SMOKE_LOW_STABLE_CONFIRMATIONS = 3;

function toNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function getPacketNumber(packet, packetKey, readingKey) {
  return toNumber(packet[packetKey] ?? packet[readingKey]);
}

function normalizeReading(reading) {
  return {
    timestamp: reading.timestamp ? new Date(reading.timestamp) : undefined,
    smoke_raw: toNumber(reading.smoke_raw ?? reading.sm),
    smoke_baseline_delta: toNumber(reading.smoke_baseline_delta ?? reading.sr),
    smoke_delta: toNumber(reading.smoke_delta ?? reading.sd),
    air_temp: toNumber(reading.air_temp ?? reading.at),
    air_baseline_delta: toNumber(reading.air_baseline_delta ?? reading.ar),
    humidity: toNumber(reading.humidity ?? reading.h),
    humidity_baseline_delta: toNumber(reading.humidity_baseline_delta ?? reading.hr),
    server_state: reading.server_state ?? reading.state,
    server_risk_score: toNumber(reading.server_risk_score),
    evidence: reading.evidence
  };
}

function normalizePacket(packet, timestamp = new Date()) {
  return {
    timestamp,
    smoke_raw: getPacketNumber(packet, 'sm', 'smoke_raw'),
    smoke_baseline_delta: getPacketNumber(packet, 'sr', 'smoke_baseline_delta'),
    smoke_delta: getPacketNumber(packet, 'sd', 'smoke_delta'),
    air_temp: getPacketNumber(packet, 'at', 'air_temp'),
    air_baseline_delta: getPacketNumber(packet, 'ar', 'air_baseline_delta'),
    humidity: getPacketNumber(packet, 'h', 'humidity'),
    humidity_baseline_delta: getPacketNumber(packet, 'hr', 'humidity_baseline_delta'),
    sensor_health: packet.sh ?? packet.sensor_health,
    node_state: packet.st ?? packet.node_state,
    node_confidence: getPacketNumber(packet, 'c', 'node_confidence')
  };
}

function scoreSmoke(current, reasons) {
  const smokeRaw = current.smoke_raw ?? 0;
  const smokeBaselineDelta = current.smoke_baseline_delta ?? 0;
  let score = 0;
  let smoke = 'none';

  if (smokeRaw >= 1800 || smokeBaselineDelta >= 900) {
    score = 45;
    smoke = 'critical';
    addReason(reasons, 'smoke_critical');
  } else if (smokeRaw >= 1200 || smokeBaselineDelta >= 450) {
    score = 35;
    smoke = 'strong';
    addReason(reasons, 'smoke_strong');
  } else if (smokeRaw >= 250 || smokeBaselineDelta >= 150) {
    score = 20;
    smoke = 'weak';
    addReason(reasons, 'smoke_weak');
  }

  return { score, smoke };
}

function scoreHeat(current, reasons) {
  const airTemp = current.air_temp ?? 0;
  const airBaselineDelta = current.air_baseline_delta ?? 0;
  let score = 0;
  let heat = 'none';

  if (airBaselineDelta >= 6 || airTemp >= 50) {
    score = 25;
    heat = 'critical';
    addReason(reasons, 'heat_critical');
  } else if (airBaselineDelta >= 4 || airTemp >= 40) {
    score = 18;
    heat = 'strong';
    addReason(reasons, 'heat_strong');
  } else if (airBaselineDelta >= 2) {
    score = 8;
    heat = 'weak';
    addReason(reasons, 'heat_weak');
  }

  return { score, heat };
}

function scoreHumidity(current, reasons) {
  const humidity = current.humidity ?? 100;
  // Firmware sends current - baseline, so a humidity drop is negative.
  const humidityDropFromBaseline = -(current.humidity_baseline_delta ?? 0);
  let score = 0;
  let humidityEvidence = 'none';

  if (humidityDropFromBaseline >= 15) {
    score = 15;
    humidityEvidence = 'critical_drop';
    addReason(reasons, 'humidity_critical_drop');
  } else if (humidity <= 35 || humidityDropFromBaseline >= 10) {
    score = 10;
    humidityEvidence = 'very_dry';
    addReason(reasons, 'humidity_very_dry');
  } else if (humidity <= 45 || humidityDropFromBaseline >= 5) {
    score = 5;
    humidityEvidence = 'dry';
    addReason(reasons, 'humidity_dry');
  }

  return { score, humidity: humidityEvidence };
}

function countDirection(values, direction) {
  let count = 0;
  let maxStep = 0;

  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) continue;

    const delta = current - previous;
    if ((direction === 'up' && delta > 0) || (direction === 'down' && delta < 0)) {
      count += 1;
      maxStep = Math.max(maxStep, Math.abs(delta));
    }
  }

  return { count, maxStep };
}

function firstLastDelta(values) {
  const defined = values.filter((value) => value !== undefined);
  if (defined.length < 2) return 0;
  return defined[defined.length - 1] - defined[0];
}

function seriesDurationMs(series) {
  const timestamps = series
    .map((item) => (item.timestamp instanceof Date ? item.timestamp.getTime() : undefined))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length < 2) return 0;
  return Math.max(...timestamps) - Math.min(...timestamps);
}

function scoreTrend(current, history, hasSmokeEvidence, reasons) {
  const recent = [...history.slice(-9), current]
    .map(normalizeReading)
    .filter((reading) => reading.timestamp instanceof Date && !Number.isNaN(reading.timestamp.getTime()))
    .sort((first, second) => first.timestamp.getTime() - second.timestamp.getTime());

  const evidence = {
    trend: 'none',
    weatherDrift: false,
    dryingCondition: false
  };

  if (recent.length < 4) {
    return { score: 0, ...evidence };
  }

  const smokeValues = recent.map((reading) => reading.smoke_raw);
  const tempValues = recent.map((reading) => reading.air_temp);
  const humidityValues = recent.map((reading) => reading.humidity);
  const smokeRise = countDirection(smokeValues, 'up');
  const tempRise = countDirection(tempValues, 'up');
  const humidityDrop = countDirection(humidityValues, 'down');
  const smokeDelta = firstLastDelta(smokeValues);
  const tempDelta = firstLastDelta(tempValues);
  const humidityDelta = -firstLastDelta(humidityValues);
  const durationMs = seriesDurationMs(recent);
  let score = 0;

  if (smokeRise.count >= 3 && smokeDelta >= 50) {
    score += 4;
    evidence.trend = 'rising';
    addReason(reasons, 'smoke_rising_trend');
  }

  if (tempRise.count >= 3 && tempDelta >= 2.5 && (tempRise.maxStep >= 2.5 || durationMs < 60 * 60 * 1000)) {
    score += 3;
    addReason(reasons, 'temperature_fast_rise');
  }

  if (humidityDrop.count >= 3 && humidityDelta >= 5 && (humidityDrop.maxStep >= 6 || durationMs < 60 * 60 * 1000)) {
    score += 3;
    addReason(reasons, 'humidity_fast_drop');
  }

  if (!hasSmokeEvidence) {
    const slowWindow = durationMs >= 60 * 60 * 1000;

    if (tempRise.count >= 3 && tempDelta >= 2 && tempRise.maxStep <= 3 && slowWindow) {
      evidence.weatherDrift = true;
      evidence.trend = 'weather_drift';
      addReason(reasons, 'weather_drift');
    }

    if (humidityDrop.count >= 3 && humidityDelta >= 5 && humidityDrop.maxStep <= 8 && slowWindow) {
      evidence.dryingCondition = true;
      if (evidence.trend === 'none') evidence.trend = 'weather_drift';
      addReason(reasons, 'drying_condition');
    }
  }

  return { score: Math.min(score, 10), ...evidence };
}

function applyFogPenalty(score, current, smokeEvidence, reasons) {
  const humidity = current.humidity ?? 0;
  if (humidity < 90 || smokeEvidence === 'none') return score;

  if (smokeEvidence === 'weak') {
    addReason(reasons, 'fog_humidity_penalty');
    return Math.max(0, score - 15);
  }

  if (smokeEvidence === 'strong') {
    addReason(reasons, 'fog_humidity_minor_penalty');
    return Math.max(0, score - 5);
  }

  return score;
}

function getFireDangerLevel(current) {
  const humidity = current.humidity;
  const airTemp = current.air_temp;

  if (humidity !== undefined && airTemp !== undefined && humidity <= 30 && airTemp >= 38) {
    return 'VERY_HIGH';
  }

  if (humidity !== undefined && airTemp !== undefined && humidity <= 35 && airTemp >= 35) {
    return 'HIGH';
  }

  if ((humidity !== undefined && humidity <= 45) || (airTemp !== undefined && airTemp >= 32)) {
    return 'MODERATE';
  }

  return 'LOW';
}

function hasSmokeAtLeastStrong(evidence) {
  return evidence.smoke === 'strong' || evidence.smoke === 'critical';
}

function hasHeatOrHumidityEvidence(evidence) {
  return evidence.heat !== 'none' || evidence.humidity !== 'none';
}

function previousSupportsCritical(history) {
  const previous = history[history.length - 1];
  if (!previous) return false;

  const evidence = previous.evidence || {};
  const riskScore = toNumber(previous.server_risk_score) ?? 0;

  if (previous.server_state === 'CRITICAL') return true;

  return (
    riskScore >= 70 &&
    (evidence.smoke === 'strong' || evidence.smoke === 'critical') &&
    (evidence.heat !== 'none' || evidence.humidity !== 'none')
  );
}

function normalizeSensorHealth(sensorHealth) {
  if (sensorHealth === undefined || sensorHealth === null || sensorHealth === '') return undefined;
  return String(sensorHealth).trim().toUpperCase();
}

function isCalibratingSensorHealth(sensorHealth) {
  const normalized = normalizeSensorHealth(sensorHealth);
  return normalized === 'CAL' || normalized === 'CALIBRATING';
}

function isSensorFault(sensorHealth) {
  const normalized = normalizeSensorHealth(sensorHealth);
  return Boolean(normalized && normalized !== 'OK' && !isCalibratingSensorHealth(normalized));
}

function hasStableLowSmoke(current, history) {
  const recent = [...history.map(normalizeReading), current]
    .filter((reading) => reading.smoke_raw !== undefined)
    .sort((first, second) => {
      const firstTime = first.timestamp instanceof Date ? first.timestamp.getTime() : 0;
      const secondTime = second.timestamp instanceof Date ? second.timestamp.getTime() : 0;
      return firstTime - secondTime;
    });

  const tail = recent.slice(-SMOKE_LOW_STABLE_CONFIRMATIONS);

  return (
    tail.length >= SMOKE_LOW_STABLE_CONFIRMATIONS &&
    tail.every((reading) => reading.smoke_raw <= SMOKE_LOW_STABLE_RAW)
  );
}

function determineServerState({ current, evidence, riskScore, history, weatherDrift, dryingCondition }) {
  const hasSmokeEvidence = evidence.smoke !== 'none';
  const sensorFault = isSensorFault(current.sensor_health);

  if (sensorFault && !hasSmokeAtLeastStrong(evidence)) return 'SENSOR_FAULT';

  if (isCalibratingSensorHealth(current.sensor_health) && !hasSmokeEvidence) {
    return 'CALIBRATING';
  }

  if (riskScore < 25) return 'NORMAL';

  if (!hasSmokeEvidence) {
    if ((weatherDrift || dryingCondition) && riskScore < 40) return 'NORMAL';
    return 'WATCH';
  }

  if (sensorFault && evidence.smoke === 'critical') return 'WARNING';

  const criticalCandidate =
    riskScore >= 70 &&
    hasSmokeAtLeastStrong(evidence) &&
    hasHeatOrHumidityEvidence(evidence);

  if (criticalCandidate) {
    return previousSupportsCritical(history) ? 'CRITICAL' : 'WARNING';
  }

  if (riskScore >= 55) return 'WARNING';
  return 'WATCH';
}

function evaluateRisk(packet, history = [], options = {}) {
  const reasons = [];
  const current = normalizePacket(packet, options.timestamp || new Date());
  const evidence = {
    smoke: 'none',
    heat: 'none',
    humidity: 'none',
    trend: 'none'
  };

  const smokeScore = scoreSmoke(current, reasons);
  evidence.smoke = smokeScore.smoke;

  const heatScore = scoreHeat(current, reasons);
  evidence.heat = heatScore.heat;

  const humidityScore = scoreHumidity(current, reasons);
  evidence.humidity = humidityScore.humidity;

  const trendScore = scoreTrend(current, history, evidence.smoke !== 'none', reasons);
  evidence.trend = trendScore.trend;

  const stableLowSmoke = hasStableLowSmoke(current, history);
  if (stableLowSmoke) {
    addReason(reasons, 'smoke_low_stable');
  }

  if (isCalibratingSensorHealth(current.sensor_health)) {
    addReason(reasons, 'baseline_calibrating');
  }

  if (isSensorFault(current.sensor_health)) {
    addReason(reasons, 'sensor_data_incomplete');
    if (current.air_temp === undefined || current.humidity === undefined) {
      addReason(reasons, 'sht31_missing');
    }
  }

  let serverRiskScore = smokeScore.score + heatScore.score + humidityScore.score + trendScore.score;
  serverRiskScore = applyFogPenalty(serverRiskScore, current, evidence.smoke, reasons);
  serverRiskScore = Math.max(0, Math.min(100, Math.round(serverRiskScore)));

  const fireDangerLevel = getFireDangerLevel(current);
  if (fireDangerLevel === 'HIGH' || fireDangerLevel === 'VERY_HIGH') {
    addReason(reasons, `fire_danger_${fireDangerLevel.toLowerCase()}`);
  }

  const serverState = determineServerState({
    current,
    evidence,
    riskScore: serverRiskScore,
    history,
    weatherDrift: trendScore.weatherDrift,
    dryingCondition: trendScore.dryingCondition
  });

  if (serverState === 'SENSOR_FAULT') {
    addReason(reasons, 'sensor_fault');
  }

  return {
    server_state: serverState,
    server_risk_score: serverRiskScore,
    server_reasons: reasons,
    fire_danger_level: fireDangerLevel,
    evidence
  };
}

module.exports = {
  FIRE_DANGER_LEVELS,
  SERVER_STATES,
  evaluateRisk
};
