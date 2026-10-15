const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let input = '';
rl.on('line', line => { input += line; });
rl.on('close', async () => {
  try {
    const payload = JSON.parse(input);
    // The assignment requires formula-interpreter. Its package API can vary by version,
    // so this worker reports adapter failures explicitly instead of executing arbitrary JS
    // with eval/new Function in the application process.
    const library = require('formula-interpreter');
    const formula = String(payload.formula || '');
    const data = { EXTERNAL_VAR: { ...(payload.record || {}), ...(payload.formulaValues || {}) } };
    let response;
    if (typeof library === 'function') response = await library(formula, data, { timeout: 900 });
    else if (typeof library.evaluate === 'function') response = await library.evaluate(formula, data, { timeout: 900 });
    else if (typeof library.interpret === 'function') response = await library.interpret(formula, data, { timeout: 900 });
    else throw new Error('Unsupported formula-interpreter API; inspect installed package exports.');
    const status = String(response.status || (response.error ? 'FAILED' : 'SUCCESS')).toUpperCase();
    const result = response.result ?? response.value;
    process.stdout.write(JSON.stringify({
      status: status === 'SUCCESS' || status === 'OK' ? 'SUCCESS' : 'FAILED',
      result,
      error: response.error || response.message || null,
      calculationText: response.calculationText || response.calculation || formula,
      inputs: response.inputs || data.EXTERNAL_VAR
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: 'FAILED', error: error.message, calculationText: input }));
  }
});