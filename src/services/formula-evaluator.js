const interpreter = require('formula-interpreter');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const path = require('node:path');
const config = require('../config');
const { round2 } = require('./rounding');

// Simple arithmetic formulas are common in bulk previews. Compile them once and
// execute them in a restricted VM context instead of paying the interpreter's
// parsing/explanation overhead for every record. Complex formulas still use the
// assignment's formula-interpreter package and isolated-worker fallback.
const simpleFormulaCache = new Map();
const SIMPLE_CACHE_LIMIT = 512;
const UNSAFE_PROPERTIES = new Set(['__proto__', 'prototype', 'constructor']);

function normalizeReferences(formula, formulaValues) {
  return Object.keys(formulaValues || {}).reduce((text, name) => {
    const pattern = new RegExp('(?<![\\w$.])' + name + '(?![\\w])', 'g');
    return text.replace(pattern, 'EXTERNAL_VAR.' + name);
  }, formula);
}

function simpleArithmeticScript(formula) {
  const match = /^\s*return\s+([\s\S]*?)\s*;?\s*$/.exec(formula);
  if (!match) return null;
  const expression = match[1];
  // Keep this fast path deliberately narrow: arithmetic/comparison expressions
  // over primitive values and EXTERNAL_VAR fields only; no calls or statements.
  if (!expression || !/^[A-Za-z0-9_$\s.()+*/%<>=!&|?:-]+$/.test(expression)) return null;
  if (/[A-Za-z_$][A-Za-z0-9_$]*\s*\(/.test(expression)) return null;
  const identifiers = [...expression.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)];
  for (const token of identifiers) {
    const name = token[0];
    const before = expression.slice(0, token.index).trimEnd();
    if (name === 'EXTERNAL_VAR' || ['true', 'false', 'null'].includes(name)) continue;
    if (before.endsWith('.')) {
      if (UNSAFE_PROPERTIES.has(name)) return null;
      continue;
    }
    return null;
  }
  if (/\.\s*(?:__proto__|prototype|constructor)\b/.test(expression)) return null;
  try {
    return new vm.Script('(' + expression + ')', { filename: 'formula-fast-path.vm' });
  } catch {
    return null;
  }
}

function evaluateSimpleArithmetic(formula, record, formulaValues, timeoutMs) {
  let script = simpleFormulaCache.get(formula);
  if (script === undefined) {
    script = simpleArithmeticScript(formula) || null;
    if (simpleFormulaCache.size >= SIMPLE_CACHE_LIMIT) simpleFormulaCache.delete(simpleFormulaCache.keys().next().value);
    simpleFormulaCache.set(formula, script);
  }
  if (!script) return null;
  try {
    const data = { ...(record || {}), ...(formulaValues || {}) };
    const result = script.runInNewContext({ EXTERNAL_VAR: data }, {
      timeout: Math.min(timeoutMs, 100),
      contextCodeGeneration: { strings: false, wasm: false }
    });
    if (typeof result === 'undefined') {
      return { status: 'FAILED', error: 'Formula did not return a value.', calculationText: formula, inputs: data };
    }
    return {
      status: 'SUCCESS',
      result: typeof result === 'number' ? round2(result) : result,
      inputs: data,
      calculationText: formula
    };
  } catch (error) {
    return { status: 'FAILED', error: error.message, calculationText: formula, inputs: { ...(record || {}), ...(formulaValues || {}) } };
  }
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
  const fastResult = evaluateSimpleArithmetic(normalizedFormula, record, formulaValues, timeoutMs);
  if (fastResult) return fastResult;

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
    return await evaluateWithWorker(normalizedFormula, record, formulaValues, timeoutMs);
  } catch (error) {
    if (/timed out/i.test(error.message || '')) {
      return { status: 'FAILED', error: error.message, calculationText: normalizedFormula, inputs: payload.CODE };
    }
    return await evaluateWithWorker(normalizedFormula, record, formulaValues, timeoutMs);
  }
}

module.exports = { evaluateFormula, normalizeReferences, librariesFor };
