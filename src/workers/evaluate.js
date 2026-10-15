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
    // Prefer the assignment's formula-interpreter package when its runtime API is available.
    try {
      const library = require('formula-interpreter');
      let response;
      if (typeof library === 'function') response = await library(formula, { EXTERNAL_VAR: data }, { timeout: 800 });
      else if (typeof library.evaluate === 'function') response = await library.evaluate(formula, { EXTERNAL_VAR: data }, { timeout: 800 });
      else if (typeof library.interpret === 'function') response = await library.interpret(formula, { EXTERNAL_VAR: data }, { timeout: 800 });
      if (response && !response.error && String(response.status || 'SUCCESS').toUpperCase() !== 'FAILED') {
        result = response.result ?? response.value;
        process.stdout.write(JSON.stringify({ status:'SUCCESS', result, inputs:response.inputs || data, calculationText:response.calculationText || response.calculation || formula }));
        return;
      }
      if (response?.error) libraryError = String(response.error);
    } catch (error) {
      libraryError = error.message;
    }
    // Fail-closed fallback for package/API mismatch: evaluate only in this disposable process.
    // vm's timeout interrupts synchronous infinite loops; the parent process also kills this worker.
    const script = '(function(){' + formula + '\\n})()';
    result = vm.runInNewContext(script, context, { timeout: 800, contextCodeGeneration: { strings: false, wasm: false } });
    if (typeof result === 'undefined') throw new Error(libraryError || 'Formula did not return a value.');
    process.stdout.write(JSON.stringify({ status:'SUCCESS', result, inputs:data, calculationText:formula }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ status:'FAILED', error:error.message, calculationText:payload?.formula || input }));
  }
});