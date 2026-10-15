const interpreter = require('formula-interpreter');
const config = require('../config');
const { round2 } = require('./rounding');

function normalizeReferences(formula, formulaValues) {
  return Object.keys(formulaValues || {}).reduce((text, name) => {
    // Formula names are validated identifiers, so they are safe as regex fragments.
    const pattern = new RegExp('(?<![\w$.])' + name + '(?![\w])', 'g');
    return text.replace(pattern, 'EXTERNAL_VAR.' + name);
  }, formula);
}

async function evaluateFormula(formula, record, formulaValues = {}, timeoutMs = config.timeoutMs) {
  const normalizedFormula = normalizeReferences(formula, formulaValues);
  // The documented API exports interpretor(evalString, libraries, payload, options).
  // It forks an isolated child for every formula and kills it on timeout.
  // CODE is used because the package calculation explainer supports EXTERNAL_VAR.CODE paths.
  const libraryFormula = normalizedFormula.replace(/EXTERNAL_VAR\s*\./g, 'EXTERNAL_VAR.CODE.');
  const payload = { CODE: { ...(record || {}), ...(formulaValues || {}) } };
  try {
    if (typeof interpreter.interpretor !== 'function') {
      return { status: 'FAILED', error: 'formula-interpreter does not export interpretor().', calculationText: normalizedFormula };
    }
    const response = await interpreter.interpretor(
      libraryFormula,
      ['LOGICAL', 'MATHS', 'STRING'],
      payload,
      { timeout: timeoutMs, memoryInMB: 32 }
    );
    if (!response || response.status !== 1) {
      return {
        status: 'FAILED',
        error: response?.error || 'Formula evaluation failed.',
        calculationText: response?.calculation || normalizedFormula,
        inputs: payload.CODE
      };
    }
    let result = response.data;
    if (typeof result === 'number') {
      try { result = round2(result); }
      catch (error) {
        return { status: 'FAILED', error: error.message, calculationText: response.calculation || normalizedFormula, inputs: payload.CODE };
      }
    }
    return {
      status: 'SUCCESS',
      result,
      inputs: payload.CODE,
      calculationText: response.calculation || normalizedFormula
    };
  } catch (error) {
    return {
      status: 'FAILED',
      error: error.message || 'Formula evaluation failed.',
      calculationText: normalizedFormula,
      inputs: payload.CODE
    };
  }
}

module.exports = { evaluateFormula, normalizeReferences };