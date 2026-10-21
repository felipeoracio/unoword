/** Tests for the extension backend client cookie and error behavior. */
const assert = require('node:assert/strict');
const API = require('../shared/api-client.js');

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('requests include browser-managed credentials without auth headers', async () => {
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 200, json: async () => ({ authenticated: true }) };
  };
  await API.post('/auth/login', { email: 'writer@example.com', password: 'password' });
  assert.equal(captured.url, 'https://unoword.vercel.app/api/auth/login');
  const manifest = require('../manifest.json');
  assert.ok(manifest.host_permissions.includes(`${new URL(captured.url).origin}/*`));
  assert.equal(captured.options.credentials, 'include');
  assert.equal(captured.options.headers.Authorization, undefined);
});

test('API errors preserve the response status', async () => {
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ detail: 'Authentication required' }) });
  await assert.rejects(() => API.get('/auth/me'), (error) => error instanceof API.ApiError && error.status === 401);
});

test('multipart uploads keep browser-generated content headers', async () => {
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 201, json: async () => ({ id: 'document-id' }) };
  };
  const form = new FormData();
  form.append('document_title', 'Notes');
  await API.upload('/documents/upload', form);
  assert.equal(captured.options.credentials, 'include');
  assert.equal(captured.options.headers, undefined);
  assert.equal(captured.options.body, form);
});

test('wrong-current-password responses are never automatically retried', async () => {
  const calls = [];
  global.fetch = async url => { calls.push(url); return { ok: false, status: 401, json: async () => ({ detail: 'current_password_invalid' }) }; };
  await assert.rejects(() => API.post('/auth/password/change', { current_password: 'fixture-password' }), error => error.status === 401);
  assert.equal(calls.length, 1);
  assert.ok(!calls.some(url => url.endsWith('/auth/refresh')));
});

(async () => {
  let passed = 0, failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  \u2713', name); passed++; }
    catch (error) { console.log('  \u2717', name); console.log('     ', error.message); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
