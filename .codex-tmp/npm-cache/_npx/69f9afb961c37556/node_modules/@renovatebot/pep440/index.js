const { valid, clean, explain, parse } = require('./lib/version');

const { lt, le, eq, ne, ge, gt, compare, rcompare } = require('./lib/operator');

const {
  filter,
  maxSatisfying,
  minSatisfying,
  RANGE_PATTERN,
  satisfies,
  validRange,
} = require('./lib/specifier');

const { major, minor, patch, inc } = require('./lib/semantic');

module.exports = {
  // version
  valid,
  clean,
  explain,
  parse,

  // operator
  lt,
  le,
  lte: le,
  eq,
  ne,
  neq: ne,
  ge,
  gte: ge,
  gt,
  compare,
  rcompare,

  // range
  filter,
  maxSatisfying,
  minSatisfying,
  RANGE_PATTERN,
  satisfies,
  validRange,

  // semantic
  major,
  minor,
  patch,
  inc,
};
