const { AppError } = require('../utils/errors');

const RESERVED = new Set(['EXTERNAL_VAR', 'Math', 'IF', 'AND', 'OR', 'SUM', 'ROUND', 'MIN', 'MAX', 'ABS', 'true', 'false', 'null', 'undefined', 'return']);

function dependenciesOf(formulaText, formulaNames) {
  const found = new Set();
  // EXTERNAL_VAR.field is an input field; bare identifiers are formula references.
  const withoutExternal = formulaText.replace(/EXTERNAL_VAR\s*\.\s*[A-Za-z_$][\w$]*/g, '');
  const identifiers = withoutExternal.match(/[A-Za-z_$][\w$]*/g) || [];
  for (const token of identifiers) {
    if (formulaNames.has(token) && !RESERVED.has(token)) found.add(token);
  }
  return [...found];
}

function graphFor(formulas) {
  const byName = new Map(formulas.map(f => [f.name, f]));
  const names = new Set(byName.keys());
  const deps = new Map();
  for (const f of formulas) deps.set(f.name, dependenciesOf(f.formula, names).filter(n => n !== f.name || /\breturn\s+\w+\b/.test(f.formula)));
  return { byName, deps };
}

function cyclePath(deps) {
  const state = new Map();
  const stack = [];
  function visit(name) {
    if (state.get(name) === 1) return [...stack.slice(stack.indexOf(name)), name];
    if (state.get(name) === 2) return null;
    state.set(name, 1); stack.push(name);
    for (const dep of deps.get(name) || []) {
      const path = visit(dep);
      if (path) return path;
    }
    stack.pop(); state.set(name, 2); return null;
  }
  for (const name of deps.keys()) {
    const path = visit(name);
    if (path) return path;
  }
  return null;
}

function executionLevels(formulas) {
  const { deps } = graphFor(formulas);
  const cycle = cyclePath(deps);
  if (cycle) throw new AppError(400, 'DEPENDENCY_CYCLE', `Dependency loop detected: ${cycle.join(' → ')}`, { path: cycle });
  const pending = new Set(deps.keys());
  const done = new Set();
  const levels = [];
  while (pending.size) {
    const level = [...pending].filter(name => (deps.get(name) || []).every(dep => done.has(dep)));
    if (!level.length) throw new AppError(400, 'DEPENDENCY_CYCLE', 'Dependency loop detected.');
    levels.push(level.map(name => formulas.find(f => f.name === name)));
    level.forEach(name => { pending.delete(name); done.add(name); });
  }
  return levels;
}

function assertKnownInputs(formulas, record) {
  const formulaNames = new Set(formulas.map(f => f.name));
  const missing = new Set();
  for (const f of formulas) {
    const matches = f.formula.match(/EXTERNAL_VAR\s*\.\s*([A-Za-z_$][\w$]*)/g) || [];
    for (const match of matches) {
      const key = match.split('.').pop().trim();
      if (!(key in record)) missing.add(key);
    }
    const stripped = f.formula.replace(/EXTERNAL_VAR\s*\.\s*[A-Za-z_$][\w$]*/g, '');
    for (const token of stripped.match(/[A-Za-z_$][\w$]*/g) || []) {
      if (formulaNames.has(token) || RESERVED.has(token)) continue;
      if (/^(return|IF|AND|OR|SUM|ROUND|MIN|MAX|ABS|Math)$/.test(token)) continue;
      // Keywords and function names are not input identifiers.
      if (new RegExp('\\b' + token + '\\s*\\(').test(stripped)) continue;
      if (!['true','false','null','undefined'].includes(token)) missing.add(token);
    }
  }
  if (missing.size) throw new AppError(400, 'MISSING_INPUT', 'Formula references missing input fields or formula names.', { missing: [...missing] });
}
module.exports = { dependenciesOf, graphFor, cyclePath, executionLevels, assertKnownInputs };