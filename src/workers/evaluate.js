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

    // The assignment package exports a named interpretor function. Its calculation
    // explainer understands EXTERNAL_VAR.CODE paths, so map the input object there.
    try {
      const library = require('formula-interpreter');
      if (typeof library.interpretor === 'function') {
        const libraryFormula = formula.replace(/EXTERNAL_VAR\s*\./g, 'EXTERNAL_VAR.CODE.');
        const response = await library.interpretor(
          libraryFormula,
          ['LOGICAL', 'MATHS', 'STRING'],
          { CODE: data },
          { timeout: 800, memoryInMB: 32 }
        );
        if (response && response.status === 1) {
          process.stdout.write(JSON.stringify({
            status: 'SUCCESS',
            result: response.data,
            inputs: data,
            calculationText: response.calculation || formula
          }));
          return;
        }
        if (response?.error && !/EXTERNAL_VAR\.[A-Za-z_$][\w$]*/.test(formula)) {
          throw new Error(response.error);
        }
      }
    } catch (error) {
      // Fall back only in this disposable worker; the parent independently enforces a timeout.
      if (error?.message && /Timed out/.test(error.message)) throw error;
    }

    const script = '(function(){' + formula + '\n})()';
    const result = vm.runInNewContext(script, context, {
      timeout: 800,
      contextCodeGeneration: { strings: false, wasm: false }
    });
    if (typeof result === 'undefined') throw new Error('Formula did not return a value.');
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