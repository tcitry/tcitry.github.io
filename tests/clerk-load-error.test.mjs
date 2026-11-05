import assert from 'node:assert/strict';
import test from 'node:test';
import {chatLoadFailureCopy, isQuietClerkError, isQuietClerkEvent, quietClerkRejections, shouldReportChatLoadError} from '../src/scripts/module-load-error.mjs';

const network = 'ClerkJS: Network error at "https://clerk.yindongliang.com/v1/client/sessions/session/touch?_clerk_js_version=6" - TypeError: Load failed';

test('only explicit Clerk script and FAPI network failures are quiet', () => {
  for (const message of ['Clerk: Failed to load Clerk JS, failed to load script: https://example.test/script.js', 'Clerk: Failed to load Clerk UI', network]) {
    const error = new Error(message);
    assert.equal(isQuietClerkError(error), true);
    assert.equal(shouldReportChatLoadError(error, 'mount'), false);
    assert.match(chatLoadFailureCopy(error), /登录服务暂时无法连接/);
  }
  for (const code of ['failed_to_load_clerk_js', 'failed_to_load_clerk_ui']) {
    assert.equal(isQuietClerkError({code, message: 'wrapped failure'}), true);
    assert.equal(isQuietClerkEvent({exception: {values: [{value: `code="${code}"`}]}}), true);
  }
});

test('all linked exceptions and cause chains are checked', () => {
  const outer = new Error('wrapper', {cause: new Error(network)});
  assert.equal(isQuietClerkError(outer), true);
  assert.equal(isQuietClerkEvent({exception: {values: [{value: 'failed to load script: https://example.test'}, {value: network}]}}), true);
  const cycle = new Error('business error');
  cycle.cause = cycle;
  assert.equal(isQuietClerkError(cycle), false);
});

test('empty input, business errors, API responses and unrelated network errors report', () => {
  for (const error of [undefined, null, '', {}, new Error('Clerk: API error 401'), new Error('Clerk: API error 500'), {clerkError: true, code: 'session_invalid'}, new Error('failed to load script: https://clerk.yindongliang.com/x.js'), new TypeError('Load failed'), new Error('ClerkJS: Network error at "https://example.test/api/business"'), new Error('Failed to load Clerk business data')]) {
    assert.equal(isQuietClerkError(error), false);
  }
  for (const event of [{}, {exception: {}}, {exception: {values: []}}, {exception: {values: [{value: 'Clerk: API error 503'}]}}]) {
    assert.equal(isQuietClerkEvent(event), false);
  }
});

test('SDK-owned rejected promises cancel only allowlisted failures and listener cleans up', () => {
  const target = new EventTarget();
  const stop = quietClerkRejections(target);
  const rejection = (reason) => {
    const event = new Event('unhandledrejection', {cancelable: true});
    Object.defineProperty(event, 'reason', {value: reason});
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(rejection(new Error(network)), true);
  assert.equal(rejection(new Error('Clerk: API error 500')), false);
  assert.equal(rejection(undefined), false);
  stop();
  assert.equal(rejection(new Error(network)), false);
});
