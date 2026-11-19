/** Production editor bundle and real backend document sanitizer, isolated accounts/data. */
const { spawn } = require('node:child_process');
(async () => {
 if (!process.env.FORMATTING_PYTHON) throw Error('Set FORMATTING_PYTHON to the backend Python interpreter to exercise the real save sanitizer.');
 const server = await require('./helpers/production-fixture-server.cjs').start();
 try {
  await new Promise((resolve, reject) => {
   const child = spawn(process.execPath, ['tests/writing-workspace.browser.cjs'], {
    stdio: 'inherit', env: { ...process.env, WRITING_TEST_ORIGIN: server.origin, EDITOR_CURSOR_ONLY: '1' },
   });
   child.on('error', reject);
   child.on('close', code => code === 0 ? resolve() : reject(Error('Cursor regression exited ' + code)));
  });
 } finally { await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
