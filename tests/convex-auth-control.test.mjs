import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('../src/components/auth/convex-auth-control.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {
  AUTH_ACCOUNT_UNAVAILABLE,
  AUTH_BOOKMARK_UNAVAILABLE,
  AUTH_SYNC_CONNECTING,
  AUTH_SYNC_UNAVAILABLE,
  bookmarkAuthPresentation,
  convexAuthControlState,
  likeAuthPresentation,
  retryConvexAuth,
} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('signed-in Convex gaps are connecting or unavailable, never anonymous', () => {
  assert.equal(convexAuthControlState({userId: null, isAuthenticated: false, isLoading: false}), 'anonymous');
  assert.equal(convexAuthControlState({userId: 'user-a', isLoaded: false, isAuthenticated: false, isLoading: false}), 'connecting');
  assert.equal(convexAuthControlState({userId: 'user-a', isAuthenticated: false, isLoading: true}), 'connecting');
  assert.equal(convexAuthControlState({userId: 'user-a', isAuthenticated: false, isLoading: false}), 'unavailable');
  assert.equal(convexAuthControlState({userId: 'user-a', isAuthenticated: true, isLoading: false}), 'ready');
});

test('bookmark and like copy explain Convex gaps instead of leaving a silent control', () => {
  assert.equal(bookmarkAuthPresentation('anonymous').tooltip, '登录后收藏当前文章');
  assert.equal(bookmarkAuthPresentation('anonymous').disabled, false);
  assert.equal(bookmarkAuthPresentation('connecting').tooltip, AUTH_SYNC_CONNECTING);
  assert.equal(bookmarkAuthPresentation('connecting').disabled, true);
  assert.equal(bookmarkAuthPresentation('unavailable').label, '重试后收藏当前文章');
  assert.equal(bookmarkAuthPresentation('unavailable').tooltip, '登录状态尚未同步，点击重试');
  assert.equal(bookmarkAuthPresentation('unavailable').disabled, false);
  assert.equal(bookmarkAuthPresentation('ready', true).tooltip, '取消收藏');
  assert.equal(bookmarkAuthPresentation('ready', false).tooltip, '收藏文章');
  assert.equal(likeAuthPresentation('unavailable').label, '重试后喜欢这篇文章');
  assert.equal(likeAuthPresentation('unavailable').disabled, false);
  assert.equal(likeAuthPresentation('ready').label, '喜欢这篇文章');
  assert.equal(likeAuthPresentation('connecting').disabled, true);
});

test('retry prefers a Convex token refresh over a fake primary action', () => {
  const calls = [];
  retryConvexAuth(() => {calls.push('refresh');});
  assert.deepEqual(calls, ['refresh']);
  assert.match(AUTH_SYNC_UNAVAILABLE, /重试/);
  assert.match(AUTH_ACCOUNT_UNAVAILABLE, /重试/);
  assert.match(AUTH_BOOKMARK_UNAVAILABLE, /重试/);
});
