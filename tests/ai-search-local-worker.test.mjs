import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import worker from '../scripts/lib/ai-search-local-worker.mjs';

function fixture() {
  const calls = [];
  const session = randomUUID();
  const search = {items: {}};
  for (const operation of ['info', 'update', 'list', 'get', 'uploadAndPoll', 'delete']) {
    const receiver = ['info', 'update'].includes(operation) ? search : search.items;
    receiver[operation] = function (...args) {
      assert.equal(this, receiver, 'Remote binding methods retain their receiver');
      calls.push({operation, args});
      return Promise.resolve({operation, args});
    };
  }
  const env = {BOOTSTRAP_SESSION: session, BLOG_SEARCH: search};
  const request = ({path = '/api/bootstrap', method = 'POST', token = session,
    body = {operation: 'info'}, raw = false, headerName = 'x-bootstrap-session'} = {}) => new Request(`http://127.0.0.1:8787${path}`, {
    method,
    headers: {'content-type': 'application/json', ...(token === null ? {} : {[headerName]: token})},
    ...(!['GET', 'HEAD'].includes(method) ? {body: raw ? body : JSON.stringify(body)} : {}),
  });
  return {calls, session, env, request};
}

test('local bootstrap rejects missing, wrong and unset sessions before parsing input or calling bindings', async () => {
  const {calls, env, request} = fixture();
  const cases = [
    [env, {token: null}],
    [env, {token: ''}],
    [env, {token: randomUUID()}],
    [{BLOG_SEARCH: env.BLOG_SEARCH}, {token: null}],
    [{...env, BOOTSTRAP_SESSION: ''}, {token: ''}],
  ];
  for (const [bindings, options] of cases) {
    const response = await worker.fetch(request({...options, body: '{not-json', raw: true}), bindings);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'Not found');
  }
  assert.deepEqual(calls, []);
});

test('local bootstrap does not accept the session from a previous local runtime', async () => {
  const {calls, env, request, session} = fixture();
  const newSession = randomUUID();
  const response = await worker.fetch(request({token: session, body: {operation: 'update', args: [{custom_metadata: []}]}}), {
    ...env, BOOTSTRAP_SESSION: newSession,
  });
  assert.equal(response.status, 404);
  assert.deepEqual(calls, []);
  const authorized = await worker.fetch(request({token: newSession}), {...env, BOOTSTRAP_SESSION: newSession});
  assert.equal(authorized.status, 200);
  assert.deepEqual(calls, [{operation: 'info', args: []}]);
});

test('local bootstrap rejects other methods and paths even with a valid session', async () => {
  const {calls, env, request} = fixture();
  for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal((await worker.fetch(request({method}), env)).status, 404);
  }
  for (const path of ['/', '/api/bootstrap/', '/api/bootstrap/extra', '/api/chat/', '/api/bootstrap-other']) {
    assert.equal((await worker.fetch(request({path}), env)).status, 404);
  }
  assert.deepEqual(calls, []);
});

test('local bootstrap rejects unknown and inherited operation names without accessing remote methods', async () => {
  const {calls, env, request} = fixture();
  for (const operation of ['delete', 'search', 'fetch', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', null]) {
    const response = await worker.fetch(request({body: {operation, args: ['remote-item']}}), env);
    assert.equal(response.status, 404);
  }
  assert.equal((await worker.fetch(request({body: {args: []}}), env)).status, 404);
  assert.deepEqual(calls, []);
});

test('authorized local bootstrap forwards only the supported operations and preserves their arguments', async () => {
  const {calls, env, request} = fixture();
  const operations = [
    {operation: 'info', args: []},
    {operation: 'update', args: [{custom_metadata: [{field_name: 'content_hash', field_type: 'text'}]}]},
    {operation: 'list', args: [{page: 2, per_page: 50, source: 'builtin'}]},
    {operation: 'get', args: ['sample-item']},
    {operation: 'uploadAndPoll', args: ['tcitry-blog/articles/sample.md', '# 公开文章\n\n正文与代码\n', {
      metadata: {content_hash: 'current-hash'}, pollIntervalMs: 10000, timeoutMs: 120000,
    }]},
  ];
  for (const body of operations) {
    const response = await worker.fetch(request({body, headerName: 'X-Bootstrap-Session'}), env);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await response.json(), body);
  }
  assert.deepEqual(calls, operations);
});

test('local bootstrap returns only error classification, never provider error bodies or credentials', async () => {
  const {env, request} = fixture();
  const secret = 'private-provider-response-token';
  const failure = Object.assign(new Error(`Provider rejected credential ${secret}`), {
    name: 'ProviderError', status: 403, code: 10000,
    body: {message: secret}, response: {body: secret}, details: {token: secret},
  });
  for (const implementation of [() => { throw failure; }, async () => { throw failure; }]) {
    env.BLOG_SEARCH.info = implementation;
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), {name: 'ProviderError', status: 403, code: 10000});
    assert.doesNotMatch(body, /private-provider|credential|Provider rejected|"body"|"response"|"details"|"stack"/);
  }
});
