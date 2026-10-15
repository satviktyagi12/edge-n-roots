const readline = require('node:readline');
const vm = require('node:vm');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let input = '';
rl.on('line', line => { input += line; });
rl.on('close', async () => {
  let payload;
  try {
    payload = JSON.parse(input);
    const formula = String(payload.formula || '');
    const data = { ...(payload.record || {}), ...(payload.formulaValues || {}) };
    const context = {
      EXTERNAL_VAR: data,
      IF: (condition, yes, no) => condition ? yes : no,
      AND: (...values) => values.every(Boolean),
      OR: (...values) => values.some(Boolean),
      SUM: (...values) => values.flat().reduce((sum, value) => sum + Number(value || 0), 0),
      ROUND: (value, places = 0) => Number(Number(value).toFixed(Number(places))),
      Math
    };
    let result;
    let libraryError = null;
    try {
      const library = require('formula-interpreter');
      let response;
      if (typeof library === 'function') response = await library(formula, { EXTERNAL_VAR: data }, { timeout: 800 });
      else if (typeof library.evaluate === 'function') response = await library.evaluate(formula, { EXTERNAL_VAR: data }, { timeout: 800 });
      else if (typeof library.interpret === 'function') response = await library.interpret(formula, { EXTERNAL_VAR: data }, { timeout: 800 });
      if (response && !response.error && String(response.status || 'SUCCESS').toUpperCase() !== 'FAILED') {
        result = response.result ?? response.value;
        process.stdout.write(JSON.stringify({
          status: 'SUCCESS',
          result,
          inputs: response.inputs || data,
          calculationText: response.calculationText || response.calculation || formula
        }));
        return;
      }
      if (response?.error) libraryError = String(response.error);
    } catch (error) {
      libraryError = error.message;
    }
    // Isolated fallback for package/API mismatch; the parent also enforces a hard timeout.
    const script = '(function(){' + formula + '\n})()';
    result = vm.runInNewContext(script, context, {
      timeout: 800,
      contextCodeGeneration: { strings: false, wasm: false }
    });
    if (typeof result === 'undefined') throw new Error(libraryError || 'Formula did not return a value.');
    const substituted = formula.replace(/EXTERNAL_VAR\s*\.\s*([A-Za-z_$][\w$]*)/g,
      (match, key) => Object.prototype.hasOwnProperty.call(data, key) ? JSON.stringify(data[key]) : match);
    process.stdout.write(JSON.stringify({
      status: 'SUCCESS',
      result,
      inputs: data,
      calculationText: formula + '\n=> ' + substituted + '\n=> ' + JSON.stringify(result)
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: 'FAILED',
      error: error.message,
      calculationText: payload?.formula || input
    }));
  }
});