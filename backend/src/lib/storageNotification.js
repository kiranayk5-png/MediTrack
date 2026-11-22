const { mysqlBoolean } = require('./mysqlBoolean');

function formatStorageNotification(row) {
  const withinRange = mysqlBoolean(row.isWithinRange);
  const parts = [];

  if (withinRange === false) parts.push('Sensor reading is outside the configured storage limits.');
  if (row.temperatureC != null) parts.push(`Temperature ${row.temperatureC} °C.`);
  if (row.humidityPercent != null) parts.push(`Humidity ${row.humidityPercent}%.`);

  if (row.conditionStatus && (row.conditionStatus !== 'normal' || withinRange === false)) {
    parts.push(`Recorded physical condition: ${row.conditionStatus.replaceAll('_', ' ')}.`);
  }

  return {
    severity: 'high',
    message: parts.length ? parts.join(' ') : 'Storage reading requires review.',
  };
}

module.exports = { formatStorageNotification };
