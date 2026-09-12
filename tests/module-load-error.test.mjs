import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowViteCssPreloadFallback,
  chatLoadFailureCopy,
  isAssetLoadError,
  isClerkLoadError,
  isCssPreloadError,
  isRetriableChatLoadError,
  needsChatPageRefresh,
  safeChatErrorDetail,
} from '../src/scripts/module-load-error.mjs';

test('CSS preload errors are cancelled so the JavaScript import can continue', () => {
  const target = new EventTarget();
  const stop = allowViteCssPreloadFallback(target);
  const event = new Event('vite:preloadError', {cancelable: true});
  Object.defineProperty(event, 'payload', {value: new Error('Unable to preload CSS for /_astro/mount-chat.abc.css')});
  target.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  const moduleError = new Event('vite:preloadError', {cancelable: true});
  Object.defineProperty(moduleError, 'payload', {value: new Error('Failed to fetch dynamically imported module: /_astro/mount-chat.js')});
  target.dispatchEvent(moduleError);
  assert.equal(moduleError.defaultPrevented, false, 'A missing JS chunk must still fail the import');
  stop();
});

test('assistant load copy names auth, stale assets, and mount failures instead of a silent network failure', () => {
  assert.equal(isCssPreloadError(new Error('Unable to preload CSS for /x.css')), true);
  assert.equal(isAssetLoadError(new Error('Failed to fetch dynamically imported module: https://yindongliang.com/_astro/mount-chat.js')), true);
  const clerk = new Error('Clerk: Failed to load Clerk');
  clerk.clerkError = true;
  assert.equal(isClerkLoadError(clerk), true);
  assert.match(chatLoadFailureCopy(new Error('Unable to preload CSS for /x.css')), /刷新/);
  assert.match(chatLoadFailureCopy(clerk), /登录服务/);
  assert.match(chatLoadFailureCopy(new Error('network down')), /检查网络/);
  assert.match(chatLoadFailureCopy(new TypeError('Cannot read properties of undefined (reading \'useAuth\')'), 'mount'), /未能打开/);
  assert.doesNotMatch(chatLoadFailureCopy(new TypeError('Cannot read properties of undefined'), 'mount'), /检查网络/);
  assert.doesNotMatch(chatLoadFailureCopy(clerk), /检查网络/);
  assert.equal(isRetriableChatLoadError(new TypeError('Failed to fetch dynamically imported module: [url]')), true);
  assert.equal(isRetriableChatLoadError(new Error('network down')), false);
  assert.equal(needsChatPageRefresh(new TypeError('Load failed'), 'import'), true);
  assert.match(chatLoadFailureCopy(new TypeError('Load failed'), 'import'), /刷新/);
  assert.equal(needsChatPageRefresh(new TypeError('Cannot read properties of undefined (reading \'useAuth\')'), 'mount'), false);
});

test('production error detail is a short sanitized message', () => {
  assert.equal(safeChatErrorDetail(new TypeError('Cannot read properties of undefined (reading \'useAuth\')')), "Cannot read properties of undefined (reading 'useAuth')");
  assert.match(safeChatErrorDetail(new Error('Failed to fetch dynamically imported module: https://yindongliang.com/_astro/mount-chat.abc.js?token=secret')), /\[url\]/);
  assert.doesNotMatch(safeChatErrorDetail(new Error('contact user@example.com')), /@example/);
  assert.equal(safeChatErrorDetail(new Error('pk_live_abc123xyz')), '[key]');
});
