import test from 'node:test';
import assert from 'node:assert/strict';
import { formatForecastCoverageSummary, getForecastChartRows, summarizeForecastCoverage } from './forecastPresentation.js';

test('forecast chart presentation preserves full medicine names and actual values without mutating API rows', () => {
  const rows = [{ id: 4, medicineName: 'Extended-release medicine with a long catalogue name', predictedDemand: '12.5' }];
  const chartRows = getForecastChartRows(rows);
  assert.equal(chartRows[0].medicineName, rows[0].medicineName);
  assert.equal(chartRows[0].predictedDemand, 12.5);
  assert.equal(rows[0].predictedDemand, '12.5');
});

test('forecast chart presentation limits plotted rows without altering the saved forecast collection', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, predictedDemand: index + 0.5 }));
  assert.equal(getForecastChartRows(rows).length, 10);
  assert.equal(rows.length, 12);
});

test('forecast coverage summary reports limited samples without claiming a confidence score', () => {
  const summary = summarizeForecastCoverage([
    { dataQuality: 'insufficient' }, { dataQuality: 'limited' }, { dataQuality: 'adequate' }, { dataQuality: null },
  ]);
  assert.deepEqual(summary, { total: 4, insufficient: 1, limited: 1, lessReliable: 2 });
  const message = formatForecastCoverageSummary(summary);
  assert.match(message, /2 of 4 forecasts/);
  assert.match(message, /less reliable/);
  assert.match(message, /not an accuracy score/);
  assert.equal(formatForecastCoverageSummary(summarizeForecastCoverage([{ dataQuality: 'adequate' }])), '');
});
