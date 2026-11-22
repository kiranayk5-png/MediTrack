function mysqlBoolean(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  return null;
}

// For safety flags, unrecognized values should not be treated as clear.
function mysqlBooleanOrFailClosed(value) {
  return mysqlBoolean(value) ?? true;
}

module.exports = { mysqlBoolean, mysqlBooleanOrFailClosed };
