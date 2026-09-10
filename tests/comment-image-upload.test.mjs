import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function client({deployment = 'https://fixture.convex.cloud', site = ''} = {}) {
  const bundle = await build({
    entryPoints: [new URL('../src/components/comments/comment-image-upload.ts', import.meta.url).pathname],
    bundle: true, platform: 'node', format: 'esm', write: false,
    define: {
      'import.meta.env.PUBLIC_CONVEX_URL': JSON.stringify(deployment),
      'import.meta.env.PUBLIC_CONVEX_SITE_URL': JSON.stringify(site),
    },
  });
  return import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
}
const {uploadCommentImage, ImageUploadError} = await client();
const png = () => new File([Uint8Array.of(137, 80, 78, 71)], 'fixture.png', {type: 'image/png'});
const token = async () => 'fixture-session-token';
const failsWith = code => error => {
  assert.ok(error instanceof ImageUploadError);
  assert.equal(error.code, code);
  assert.doesNotMatch(error.message, /private-provider-detail|fixture-session-token|<html>/);
  return true;
};

test('image uploads retain their authenticated raw-file contract and private consultation purpose', async t => {
  const file = png();
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({url: String(url), init});
    return Response.json({imageId: 'fixture-image-id'}, {status: 201});
  });
  for (const purpose of ['comment', 'consultation']) {
    assert.equal(await uploadCommentImage(file, token, {purpose}), 'fixture-image-id');
  }
  assert.deepEqual(requests.map(request => request.url), [
    'https://fixture.convex.site/comment-images/upload',
    'https://fixture.convex.site/comment-images/upload?purpose=consultation',
  ]);
  for (const {init} of requests) {
    assert.equal(init.method, 'POST');
    assert.equal(init.body, file);
    assert.deepEqual(init.headers, {Authorization: 'Bearer fixture-session-token', 'Content-Type': 'image/png'});
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test('known HTTP failures map to safe local errors without displaying arbitrary backend text', async t => {
  for (const [status, code, expected] of [
    [401, 'UNAUTHENTICATED', 'UNAUTHENTICATED'], [403, 'FORBIDDEN', 'FORBIDDEN'],
    [413, 'FILE_TOO_LARGE', 'FILE_TOO_LARGE'], [429, 'RATE_LIMITED', 'RATE_LIMITED'],
    [400, 'INVALID_ARGUMENT', 'INVALID_FILE'], [400, 'unknown', 'UPLOAD_FAILED'],
    [500, 'INVALID_ARGUMENT', 'UPLOAD_FAILED'], [503, 'unknown', 'UPLOAD_FAILED'],
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({code, message: '<html>private-provider-detail fixture-session-token'}, {status}));
    await assert.rejects(uploadCommentImage(png(), token), failsWith(expected));
    mock.mock.restore();
  }
});

test('non-JSON and malformed success responses never become image ids or leak server bodies', async t => {
  for (const [response, code] of [
    [new Response('<html>private-provider-detail', {status: 502}), 'UPLOAD_FAILED'],
    [new Response('<html>private-provider-detail', {status: 401}), 'UNAUTHENTICATED'],
    [new Response('<html>private-provider-detail', {status: 200}), 'INVALID_RESPONSE'],
    ...[null, {}, {imageId: null}, {imageId: 1}, {imageId: ''}, {imageId: ' '}]
      .map(payload => [Response.json(payload), 'INVALID_RESPONSE']),
  ]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(uploadCommentImage(png(), token), failsWith(code));
    mock.mock.restore();
  }
});

test('network, timeout, cancellation and missing sessions remain distinguishable and do not leak errors', async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => {throw new TypeError('private-provider-detail');});
  await assert.rejects(uploadCommentImage(png(), token), failsWith('NETWORK'));
  network.mock.restore();
  const noFetch = t.mock.method(globalThis, 'fetch', async () => {assert.fail('An unavailable or cancelled token never uploads');});
  await assert.rejects(uploadCommentImage(png(), async () => null), failsWith('UNAUTHENTICATED'));
  await assert.rejects(uploadCommentImage(png(), async () => {throw new Error('private-provider-detail');}), failsWith('AUTH_UNAVAILABLE'));
  await assert.rejects(uploadCommentImage(png(), token, {signal: AbortSignal.abort()}), failsWith('ABORTED'));
  for (const reason of [new DOMException('private-provider-detail', 'AbortError'), new DOMException('private-provider-detail', 'TimeoutError')]) {
    const controller = new AbortController();
    let rejectToken;
    const pending = uploadCommentImage(png(), () => new Promise((_resolve, reject) => {rejectToken = reject;}), {signal: controller.signal});
    await Promise.resolve();
    controller.abort(reason);
    await assert.rejects(pending, failsWith(reason.name === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED'));
    rejectToken(new Error('late token failure remains handled'));
  }
  assert.equal(noFetch.mock.callCount(), 0);
  noFetch.mock.restore();
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    controller.abort(new DOMException('private-provider-detail', 'TimeoutError'));
    throw init.signal.reason;
  });
  await assert.rejects(uploadCommentImage(png(), token, {signal: controller.signal}), failsWith('TIMEOUT'));
});

test('invalid files and unusable configuration fail before requesting a token or uploading', async t => {
  t.mock.method(globalThis, 'fetch', async () => {assert.fail('Invalid local input cannot upload');});
  const noToken = async () => {assert.fail('Invalid local input cannot request a token');};
  for (const [file, code] of [
    [new File([], 'empty.png', {type: 'image/png'}), 'INVALID_FILE'],
    [new File(['text'], 'document.txt', {type: 'text/plain'}), 'INVALID_FILE'],
    [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', {type: 'image/png'}), 'FILE_TOO_LARGE'],
  ]) await assert.rejects(uploadCommentImage(file, noToken), failsWith(code));
  for (const options of [{deployment: ''}, {site: 'bad url'}, {site: 'http://external.example'}, {site: 'https://user:password@external.example'}, {site: 'https://external.example/path'}]) {
    const configured = await client(options);
    await assert.rejects(configured.uploadCommentImage(png(), noToken), error => {
      assert.ok(error instanceof configured.ImageUploadError);
      assert.equal(error.code, 'CONFIGURATION');
      return true;
    });
  }
});
