'use strict';

function clampPercentage(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

function calculateObservationProgress({
  currentMetricMeters,
  totalLengthMeters,
  dailyBaselineMeters = 0,
  previousAuthoritativeMeters = 0,
}) {
  const current = Math.max(0, Number(currentMetricMeters) || 0);
  const total = Math.max(0, Number(totalLengthMeters) || 0);
  const baseline = Math.max(0, Number(dailyBaselineMeters) || 0);
  const previousMaximum = Math.max(0, Number(previousAuthoritativeMeters) || 0);
  const dailyMeters = Math.max(0, current - baseline);
  const authoritativeMeters = Math.max(previousMaximum, current);

  return {
    absoluteProgressPercentage: total > 0 ? clampPercentage(current / total * 100) : 0,
    dailyProgressMeters: dailyMeters,
    dailyProgressPercentage: total > 0 ? clampPercentage(dailyMeters / total * 100) : 0,
    authoritativeProgressMeters: authoritativeMeters,
    authoritativeProgressPercentage: total > 0 ? clampPercentage(authoritativeMeters / total * 100) : 0,
  };
}

module.exports = { clampPercentage, calculateObservationProgress };
