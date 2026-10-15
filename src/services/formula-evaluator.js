const { spawn } = require('node:child_process');
const path = require('node:path');
const config = require('../config');
const { round2 } = require('./rounding');

function normalizeReferences(formula, formulaValues) {
  return Object.keys(formulaValues || {}).reduce((text, name) => {
    // Formula names are validated identifiers, so they are safe as regex fragments.
    const pattern = new RegExp('(?<![\\w$.])' + name + '(?![\\w])', 'g');
    return text.replace(pattern, 'EXTERNAL_VAR.' + name);
  }, formula);
}

function evaluateFormula(formula, record, formulaValues = {}, timeoutMs = config.timeoutMs) {
  return new Promise((resolve) => {
    const workerPath = path.join(__dirname, '../workers/evaluate.js');
    const normalizedFormula = normalizeReferences(formula, formulaValues);
    const child = spawn(process.execPath, [workerPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({ status: 'FAILED', error: 'Formula timed out after ' + timeoutMs + 'ms', calculationText: normalizedFormula });
    }, timeoutMs);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', err => finish({ status: 'FAILED', error: err.message, calculationText: normalizedFormula }));
    child.on('close', () => {
      if (settled) return;
      try {
        const payload = JSON.parse(stdout);
        if (payload.status !== 'SUCCESS') return finish({ ...payload, status: 'FAILED', error: payload.error || stderr || 'Formula evaluation failed' });
        let result = payload.result;
        if (typeof result === 'number') result = round2(result);
        finish({ ...payload, result, status: 'SUCCESS' });
      } catch {
        finish({ status: 'FAILED', error: stderr.trim() || 'Formula worker returned invalid output', calculationText: normalizedFormula });
      }
    });
    child.stdin.end(JSON.stringify({ formula: normalizedFormula, record, formulaValues }));
  });
}
module.exports = { evaluateFormula, normalizeReferences };