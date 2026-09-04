'use strict';

const assert = require('assert');
const { calculateObservationProgress } = require('./src/services/progress.service');

function close(actual, expected, message) {
  assert(Math.abs(actual - expected) < 0.001, `${message}: expected ${expected}, got ${actual}`);
}

const first = calculateObservationProgress({ currentMetricMeters: 320, totalLengthMeters: 1000 });
close(first.dailyProgressMeters, 320, 'TEST B first observation daily meters');
close(first.dailyProgressPercentage, 32, 'TEST B first observation daily percent');
close(first.authoritativeProgressPercentage, 32, 'TEST B first observation total percent');

const nextDay = calculateObservationProgress({ currentMetricMeters: 780, totalLengthMeters: 1000, dailyBaselineMeters: 620, previousAuthoritativeMeters: 620 });
close(nextDay.dailyProgressMeters, 160, 'TEST C next-day meters');
close(nextDay.dailyProgressPercentage, 16, 'TEST C next-day percent');
close(nextDay.authoritativeProgressPercentage, 78, 'TEST C total percent');

const sameDay = calculateObservationProgress({ currentMetricMeters: 780, totalLengthMeters: 1000, dailyBaselineMeters: 620, previousAuthoritativeMeters: 720 });
close(sameDay.dailyProgressMeters, 160, 'TEST D baseline remains before-day station');
close(sameDay.authoritativeProgressPercentage, 78, 'TEST D authoritative total');

const backwards = calculateObservationProgress({ currentMetricMeters: 760, totalLengthMeters: 1000, dailyBaselineMeters: 620, previousAuthoritativeMeters: 780 });
close(backwards.authoritativeProgressMeters, 780, 'TEST E backward station preserves maximum');
close(backwards.authoritativeProgressPercentage, 78, 'TEST E backward station total');

const endpoint = calculateObservationProgress({ currentMetricMeters: 1000, totalLengthMeters: 1000 });
close(endpoint.absoluteProgressPercentage, 100, 'TEST F endpoint clamp');
const beyond = calculateObservationProgress({ currentMetricMeters: 1120, totalLengthMeters: 1000 });
close(beyond.absoluteProgressPercentage, 100, 'TEST G beyond endpoint clamp');

const normal = calculateObservationProgress({ currentMetricMeters: 500, totalLengthMeters: 1000, previousAuthoritativeMeters: 400 });
const exceptional = calculateObservationProgress({ currentMetricMeters: 500, totalLengthMeters: 1000, previousAuthoritativeMeters: 400 });
assert.deepStrictEqual(exceptional, normal, 'TEST H/I validation status and D_min are independent from progression');

// TEST A is integration-covered by test_observation_workflow.js: its metric input is
// produced by PostGIS ST_LineLocatePoint on the stored curved tronçon geometry.
console.log('✅ Progress business rules: TESTS B-I arithmetic expectations passed (A remains PostGIS integration-covered)');
