import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {ConvexError} from 'convex/values';

const bundle = await build({
  entryPoints: [new URL('../src/components/comments/comment-username.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{name: 'comment-username-test-dependencies', setup(plugin) {
    plugin.onResolve({filter: /^[^./]/}, ({path}) => ({path: import.meta.resolve(path), external: true}));
  }}],
});
const {
  clerkUsernameErrorMessage, commentUsernameClientError, convexErrorMessage,
  isUsernameUnavailableError, normalizeCommentUsername, saveClerkUsername, waitForConvexUsernameToken,
} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('comment username client validation matches Clerk length and charset defaults', () => {
  assert.equal(normalizeCommentUsername('  tcitry  '), 'tcitry');
  assert.equal(commentUsernameClientError(''), '请先设置用户名，再发布评论。');
  assert.match(commentUsernameClientError('abc'), /4–64/);
  assert.match(commentUsernameClientError('x'.repeat(65)), /4–64/);
  assert.match(commentUsernameClientError('user name'), /字母、数字、下划线和连字符/);
  assert.match(commentUsernameClientError('名字名字'), /字母、数字、下划线和连字符/);
  assert.equal(commentUsernameClientError('tcitry'), '');
  assert.equal(commentUsernameClientError('A_b-1'), '');
});

test('Clerk username API errors are mapped to Chinese copy', () => {
  assert.equal(clerkUsernameErrorMessage({errors: [{code: 'form_identifier_exists'}]}), '这个用户名已被使用，请换一个。');
  assert.match(clerkUsernameErrorMessage({errors: [{code: 'form_username_invalid_length'}]}), /4–64/);
  assert.match(clerkUsernameErrorMessage({errors: [{code: 'form_username_invalid_character'}]}), /字母、数字、下划线和连字符/);
  assert.equal(clerkUsernameErrorMessage({errors: [{code: 'form_param_unknown', longMessage: 'Username is reserved.'}]}), 'Username is reserved.');
  assert.equal(clerkUsernameErrorMessage(new Error('请先设置用户名，再发布评论。')), '请先设置用户名，再发布评论。');
});

test('USERNAME_UNAVAILABLE is detected without treating it as a generic comment failure', () => {
  const error = new ConvexError({code: 'USERNAME_UNAVAILABLE', message: '当前登录信息缺少用户名，暂时无法发布评论。'});
  assert.equal(isUsernameUnavailableError(error), true);
  assert.equal(isUsernameUnavailableError(new Error('USERNAME_UNAVAILABLE')), false);
  assert.equal(convexErrorMessage(error, 'fallback'), '当前登录信息缺少用户名，暂时无法发布评论。');
  assert.equal(convexErrorMessage(new ConvexError({kind: 'RateLimited', name: 'commentWrites'}), 'fallback'), '评论操作过于频繁，请稍后再试。');
});

test('saveClerkUsername writes Clerk username then refreshes the Convex session token', async () => {
  const calls = [];
  const user = {async update(params) {calls.push(['update', params]);}};
  await saveClerkUsername({
    user, username: '  new-reader  ',
    reloadSession: async () => {calls.push(['reload']);},
    getToken: async (options) => {calls.push(['token', options]); return 'token';},
    sessionClaims: {aud: 'convex'},
    refreshConvexToken: () => {calls.push(['refresh']);},
  });
  assert.deepEqual(calls, [
    ['update', {username: 'new-reader'}],
    ['reload'],
    ['token', {skipCache: true}],
    ['refresh'],
  ]);
});

test('saveClerkUsername requests the convex JWT template when session aud is not convex', async () => {
  const tokens = [];
  await saveClerkUsername({
    user: {async update() {}}, username: 'reader-1',
    getToken: async (options) => {tokens.push(options); return 'token';},
    sessionClaims: {aud: 'something-else'},
  });
  assert.deepEqual(tokens, [{template: 'convex', skipCache: true}]);
});

test('waitForConvexUsernameToken resolves after a paint/timeout turn', async () => {
  await waitForConvexUsernameToken();
});
