const interpreter = require('formula-interpreter');
const { spawn } = require('node:child_process');
const path = require('node:path');
const config = require('../config');
const { round2 } = require('./rounding');

function normalizeReferences(formula, formulaValues) {
  return Object.keys(formulaValues || {}).reduce((text, name) => {
    const pattern = new RegExp('(?<![\\w$.])' + name + '(?![\\w])', 'g');
    return text.replace(pattern, 'EXTERNAL_VAR.' + name);
  }, formula);
}

function librariesFor(formula) {
  const libraries = [];
  if (/\b(?:IF|AND|OR|XOR)\s*\(/i.test(formula)) libraries.push('LOGICAL');
  if (/\b(?:SUM|ROUND|INT)\s*\(/i.test(formula)) libraries.push('MATHS');
  if (/\b(?:CONCATSTR|STRLENGTH)\s*\(/i.test(formula)) libraries.push('STRING');
  return libraries;
}

function evaluateWithWorker(formula, record, formulaValues, timeoutMs) {
  return new Promise(resolve => {
    const workerPath = path.join(__dirname, '../workers/evaluate.js');
    const child = spawn(process.execPath, [workerPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ status: 'FAILED', error: 'Formula timed out after ' + timeoutMs + 'ms', calculationText: formula });
    }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish({ status: 'FAILED', error: error.message, calculationText: formula }));
    child.on('close', () => {
      if (settled) return;
      try {
        const result = JSON.parse(stdout);
        if (result.status !== 'SUCCESS') return finish({ ...result, status: 'FAILED', error: result.error || stderr || 'Formula evaluation failed.' });
        if (typeof result.result === 'number') result.result = round2(result.result);
        finish(result);
      } catch {
        finish({ status: 'FAILED', error: stderr.trim() || 'Formula worker returned invalid output.', calculationText: formula });
      }
    });
    child.stdin.end(JSON.stringify({ formula, record, formulaValues }));
  });
}

async function evaluateFormula(formula, record, formulaValues = {}, timeoutMs = config.timeoutMs) {
  const normalizedFormula = normalizeReferences(formula, formulaValues);
  const libraryFormula = normalizedFormula.replace(/EXTERNAL_VAR\s*\./g, 'EXTERNAL_VAR.CODE.');
  const payload = { CODE: { ...(record || {}), ...(formulaValues || {}) } };
  const libraries = librariesFor(normalizedFormula);
  try {
    if (typeof interpreter.interpretor !== 'function') {
      return { status: 'FAILED', error: 'formula-interpreter does not export interpretor().', calculationText: normalizedFormula };
    }
    const response = await interpreter.interpretor(
      libraryFormula,
      libraries,
      payload,
      { timeout: timeoutMs, memoryInMB: 32 }
    );
    if (response && response.status === 1) {
      let result = response.data;
      if (typeof result === 'number') {
        try { result = round2(result); }
        catch (error) { return { status: 'FAILED', error: error.message, calculationText: response.calculation || normalizedFormula, inputs: payload.CODE }; }
      }
      return { status: 'SUCCESS', result, inputs: payload.CODE, calculationText: response.calculation || normalizedFormula };
    }
    const message = response?.error || 'Formula evaluation failed.';
    if (/timed out/i.test(message)) {
      return { status: 'FAILED', error: message, calculationText: response?.calculation || normalizedFormula, inputs: payload.CODE };
    }
    // The package's calculation explainer has edge cases around helper-library calls.
    // Fall back to the same disposable worker, never the API process, for those cases.
    return await evaluateWithWorker(normalizedFormula, record, formulaValues, timeoutMs);
  } catch (error) {
    if (/timed out/i.test(error.message || '')) {
      return { status: 'FAILED', error: error.message, calculationText: normalizedFormula, inputs: payload.CODE };
    }
    return await evaluateWithWorker(normalizedFormula, record, formulaValues, timeoutMs);
  }
}

module.exports = { evaluateFormula, normalizeReferences, librariesFor };