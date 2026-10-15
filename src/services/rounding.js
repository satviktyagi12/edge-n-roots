function round2(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('Formula result must be a finite number.');
  }
  // EPSILON compensates for common binary representation errors before rounding.
  return Number((Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2));
}
module.exports = { round2 };