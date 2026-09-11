import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const source = new URL('../scripts/workers-build.mjs', import.meta.url);
const mainCommit = 'c'.repeat(40);
const pinnedCommit = 'a'.repeat(40);

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'workers-build-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts'));
  await mkdir(path.join(directory, 'bin'));
  await mkdir(path.join(directory, 'tmp'));
  await writeFile(path.join(directory, 'tmp', 'unrelated'), 'keep');
  const script = path.join(directory, 'scripts', 'workers-build.mjs');
  await copyFile(source, script);
  await copyFile(new URL('../scripts/reader-config.mjs', import.meta.url), path.join(directory, 'scripts/reader-config.mjs'));
  await mkdir(path.join(directory, 'src/lib'), {recursive: true});
  await copyFile(new URL('../src/lib/public-ai-search-url.mjs', import.meta.url), path.join(directory, 'src/lib/public-ai-search-url.mjs'));
  const log = path.join(directory, 'commands.jsonl');
  await writeFile(path.join(directory, 'bin', 'git'), `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
const clone = args.includes('clone');
const stateFile = process.env.FIXTURE_LOG + '.state';
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { main: process.env.FIXTURE_MAIN_COMMIT, head: null };
const record = { command: 'git', args, contentToken: !!process.env.BLOG_READ_TOKEN, proToken: !!process.env.HEROUI_AUTH_TOKEN, deployToken: !!process.env.CLOUDFLARE_API_TOKEN, convexToken: !!process.env.CONVEX_DEPLOY_KEY, clerkSecret: !!process.env.CLERK_SECRET_KEY, siteEnvironment: process.env.PUBLIC_SITE_ENV };
if (clone) {
  record.askpassUser = cp.execFileSync(process.env.GIT_ASKPASS, ['Username'], { encoding: 'utf8' }).trim();
  record.askpassMatches = cp.execFileSync(process.env.GIT_ASKPASS, ['Password'], { encoding: 'utf8' }).trim() === process.env.BLOG_READ_TOKEN;
  record.askpassMode = fs.statSync(process.env.GIT_ASKPASS).mode & 0o777;
  record.askpassContainsToken = fs.readFileSync(process.env.GIT_ASKPASS, 'utf8').includes(process.env.BLOG_READ_TOKEN);
  fs.mkdirSync(args.at(-1), { recursive: true });
}
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(record) + '\\n');
if (args.includes('checkout')) {
  state.head = args.at(-1);
  if (process.env.FIXTURE_MOVE_MAIN === '1') state.main = 'd'.repeat(40);
  fs.writeFileSync(stateFile, JSON.stringify(state));
}
if (args.includes('rev-parse')) {
  const resolveMain = args.at(-1) === 'origin/main^{commit}';
  const changedAfterBuild = fs.existsSync(process.env.FIXTURE_LOG + '.built')
    && process.env.FIXTURE_FAIL === (args.includes('-C') ? 'content-revision' : 'site-revision');
  const changedDuringVerification = fs.existsSync(process.env.FIXTURE_LOG + '.verified')
    && process.env.FIXTURE_FAIL === (args.includes('-C') ? 'content-during-verify' : 'site-during-verify');
  console.log(resolveMain ? (process.env.FIXTURE_FAIL === 'resolve' ? 'not-a-commit' : state.main)
    : process.env.FIXTURE_FAIL === 'revision' || changedAfterBuild || changedDuringVerification ? 'b'.repeat(40)
    : args.includes('-C') ? state.head : 'e'.repeat(40));
}
// Even a Git error that contains credentials and metadata must stay private.
console.error(args.join(' ') + ' ' + (process.env.BLOG_READ_TOKEN || '') + ' private-revision-abc123');
const step = clone ? 'clone' : args.includes('merge-base') ? 'ancestor' : args.includes('checkout') ? 'checkout'
  : args.includes('remote') ? 'remote' : args.at(-1) === 'origin/main^{commit}' ? 'resolve-command' : null;
if (step && process.env.FIXTURE_FAIL === step) process.exit(1);
`, { mode: 0o700 });
  const npm = path.join(directory, 'npm.mjs');
  await writeFile(npm, `
import fs from 'node:fs';
const args = process.argv.slice(2);
const script = args.at(-1);
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ command: 'npm', args,
  contentToken: !!process.env.BLOG_READ_TOKEN, proToken: !!process.env.HEROUI_AUTH_TOKEN,
  repository: !!process.env.BLOG_CONTENT_REPOSITORY, blog: process.env.BLOG_DIR,
  contentPin: process.env.BLOG_CONTENT_COMMIT ?? null, deployToken: !!process.env.CLOUDFLARE_API_TOKEN, githubToken: !!process.env.GITHUB_TOKEN,
  convexToken: !!process.env.CONVEX_DEPLOY_KEY, clerkSecret: !!process.env.CLERK_SECRET_KEY,
  siteEnvironment: process.env.PUBLIC_SITE_ENV, askpassExists: fs.existsSync(process.env.BLOG_DIR + '/../askpass'),
  contentExists: fs.existsSync(process.env.BLOG_DIR) }) + '\\n');
console.log('ordinary build output ' + (process.env.HEROUI_AUTH_TOKEN || '') + ' ' + process.env.BLOG_DIR
  + ' ' + process.env.FIXTURE_MAIN_COMMIT + ' ' + (process.env.BLOG_CONTENT_COMMIT || ''));
if (script === 'build') fs.writeFileSync(process.env.FIXTURE_LOG + '.built', '');
if (script === 'verify:release') fs.writeFileSync(process.env.FIXTURE_LOG + '.verified', '');
if (process.env.FIXTURE_FAIL === script) process.exit(1);
`);
  const env = {
    ...process.env, PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env.PATH}`,
    TMPDIR: path.join(directory, 'tmp'), npm_execpath: npm, FIXTURE_LOG: log,
    BLOG_CONTENT_REPOSITORY: 'test-owner/private-content', BLOG_READ_TOKEN: 'test-private-token-123',
    HEROUI_AUTH_TOKEN: 'test-pro-token-456', SKIP_DEPENDENCY_INSTALL: '1',
    FIXTURE_MAIN_COMMIT: mainCommit,
    CLOUDFLARE_API_TOKEN: 'test-deploy-token-789', GITHUB_TOKEN: 'test-github-token-789',
    PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.test.invalid$').toString('base64'),
    PUBLIC_CONVEX_URL: 'https://production-fixture-123.convex.cloud',
    AI_SEARCH_PUBLIC_URL: 'https://fixture.search.ai.cloudflare.com/search',
    CONVEX_DEPLOY_KEY: 'prod:production-fixture-123|fixture-convex-secret', CLERK_SECRET_KEY: 'fixture-unused-clerk-secret',
  };
  delete env.PUBLIC_SITE_ENV;
  delete env.BLOG_CONTENT_COMMIT;
  return {
    directory, env,
    async run(overrides = {}) {
      let result;
      try {
        result = { ...await execute(process.execPath, [script], { env: { ...env, ...overrides } }), code: 0 };
      } catch (error) {
        result = { stdout: error.stdout, stderr: error.stderr, code: error.code };
      }
      let commands = [];
      try { commands = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { ...result, commands, output: result.stdout + result.stderr };
    },
  };
}

test('Workers build rejects missing or unsafe configuration before any command runs', async t => {
  for (const [overrides, expected] of [
    [{ BLOG_CONTENT_REPOSITORY: '' }, 'BLOG_CONTENT_REPOSITORY'],
    [{ BLOG_CONTENT_REPOSITORY: 'https://github.com/owner/repo' }, 'BLOG_CONTENT_REPOSITORY'],
    [{ BLOG_CONTENT_REPOSITORY: 'owner/repo\n--upload-pack=invalid' }, 'BLOG_CONTENT_REPOSITORY'],
    [{ BLOG_READ_TOKEN: '' }, 'BLOG_READ_TOKEN'],
    [{ BLOG_CONTENT_COMMIT: '' }, 'BLOG_CONTENT_COMMIT'],
    [{ BLOG_CONTENT_COMMIT: 'main' }, 'BLOG_CONTENT_COMMIT'],
    [{ BLOG_CONTENT_COMMIT: 'abc1234' }, 'BLOG_CONTENT_COMMIT'],
    [{ BLOG_CONTENT_COMMIT: 'a'.repeat(39) }, 'BLOG_CONTENT_COMMIT'],
    [{ BLOG_CONTENT_COMMIT: 'A'.repeat(40) }, 'BLOG_CONTENT_COMMIT'],
    [{ BLOG_CONTENT_COMMIT: ' ' + pinnedCommit }, 'BLOG_CONTENT_COMMIT'],
    [{ BLOG_CONTENT_COMMIT: 'a'.repeat(40) + '\n' }, 'BLOG_CONTENT_COMMIT'],
    [{ HEROUI_AUTH_TOKEN: ' \n' }, 'HEROUI_AUTH_TOKEN'],
    [{ SKIP_DEPENDENCY_INSTALL: '' }, 'SKIP_DEPENDENCY_INSTALL=1'],
    [{ PUBLIC_SITE_ENV: '' }, 'only supports PUBLIC_SITE_ENV=production'],
    [{ PUBLIC_SITE_ENV: 'preview' }, 'only supports PUBLIC_SITE_ENV=production'],
    [{ PUBLIC_SITE_ENV: 'staging' }, 'only supports PUBLIC_SITE_ENV=production'],
    [{ PUBLIC_SITE_ENV: 'Production' }, 'only supports PUBLIC_SITE_ENV=production'],
    [{ PUBLIC_SITE_ENV: 'production\n' }, 'only supports PUBLIC_SITE_ENV=production'],
    [{ PUBLIC_CLERK_PUBLISHABLE_KEY: '' }, 'PUBLIC_CLERK_PUBLISHABLE_KEY'],
    [{ PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_anything' }, 'PUBLIC_CLERK_PUBLISHABLE_KEY'],
    [{ PUBLIC_CONVEX_URL: '' }, 'PUBLIC_CONVEX_URL'],
    [{ AI_SEARCH_PUBLIC_URL: '' }, 'AI_SEARCH_PUBLIC_URL'],
    [{ AI_SEARCH_PUBLIC_URL: 'https://outside.example/search' }, 'AI_SEARCH_PUBLIC_URL'],
    [{ CONVEX_DEPLOY_KEY: '' }, 'CONVEX_DEPLOY_KEY'],
    [{ CONVEX_DEPLOY_KEY: 'dev:production-fixture-123|secret' }, 'CONVEX_DEPLOY_KEY'],
    [{ CONVEX_DEPLOY_KEY: 'prod:another-deployment|secret' }, 'same production deployment'],
  ]) {
    const context = await fixture(t);
    const result = await context.run(overrides);
    assert.equal(result.code, 1);
    assert.match(result.output, new RegExp(expected));
    assert.deepEqual(result.commands, []);
    assert.deepEqual(await readdir(path.join(context.directory, 'tmp')), ['unrelated']);
    assert.ok(!result.output.includes(context.env.BLOG_READ_TOKEN));
    assert.ok(!result.output.includes(context.env.HEROUI_AUTH_TOKEN));
    assert.ok(!result.output.includes(context.env.BLOG_CONTENT_REPOSITORY));
  }
});

test('Workers build defaults to the fetched main commit with full history, scopes secrets and seals once', async t => {
  const context = await fixture(t);
  // This CI entry always prepares a production release, independently of NODE_ENV.
  const result = await context.run({ NODE_ENV: 'development' });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(result.commands.filter(command => command.command === 'npm').map(command => command.args), [
    ['run', 'setup'], ['run', 'build'], ['run', 'check'], ['test'], ['run', 'verify:release'],
  ]);
  const [clone, resolve, checkout, revision, remote] = result.commands;
  const steps = result.commands.filter(command => command.command === 'npm');
  assert.deepEqual(clone.args.slice(0, -2), ['-c', 'credential.helper=', 'clone', '--quiet', '--branch', 'main', '--single-branch', '--no-checkout']);
  assert.equal(clone.args.at(-2), 'https://github.com/test-owner/private-content.git');
  assert.ok(!clone.args.some(arg => arg.includes(context.env.BLOG_READ_TOKEN) || arg.startsWith('--depth')));
  assert.equal(clone.contentToken, true);
  assert.equal(clone.proToken, false);
  assert.equal(clone.askpassUser, 'x-access-token');
  assert.equal(clone.askpassMatches, true);
  assert.equal(clone.askpassMode, 0o700);
  assert.equal(clone.askpassContainsToken, false);
  assert.deepEqual(resolve.args.slice(-3), ['rev-parse', '--verify', 'origin/main^{commit}']);
  assert.equal(result.commands.filter(command => command.args.includes('origin/main^{commit}')).length, 1);
  assert.ok(!result.commands.some(command => command.args.includes('merge-base')), 'The fetched main commit needs no optional-pin ancestry check');
  assert.deepEqual(checkout.args.slice(-4), ['checkout', '--quiet', '--detach', mainCommit]);
  assert.deepEqual(revision.args.slice(-2), ['rev-parse', 'HEAD']);
  assert.deepEqual(remote.args.slice(-3), ['remote', 'remove', 'origin']);
  assert.equal(remote.contentToken, false);
  assert.deepEqual(steps.map(step => step.proToken), [true, false, false, false, false]);
  assert.deepEqual(steps.map(step => step.contentPin), [null, null, null, null, mainCommit]);
  assert.ok(steps.every(step => !step.contentToken && !step.repository && !step.askpassExists && !step.githubToken));
  assert.ok(result.commands.every(command => !command.deployToken));
  assert.ok(result.commands.every(command => !command.convexToken && !command.clerkSecret));
  assert.ok([resolve, checkout, revision, remote].every(command => !command.contentToken && !command.proToken));
  assert.ok(result.commands.every(command => command.siteEnvironment === 'production'));
  assert.ok(steps.every(step => step.contentExists));
  assert.equal(new Set(steps.map(step => step.blog)).size, 1);
  assert.deepEqual(await readdir(path.join(context.directory, 'tmp')), ['unrelated']);
  assert.match(result.output, /ordinary build output/);
  assert.match(result.output, /Production build verified/);
  for (const secret of [context.env.BLOG_READ_TOKEN, context.env.HEROUI_AUTH_TOKEN, context.env.BLOG_CONTENT_REPOSITORY, mainCommit, context.env.CLOUDFLARE_API_TOKEN, steps[0].blog, 'private-revision-abc123']) {
    assert.ok(!result.output.includes(secret), 'build logs must not contain credentials or private checkout metadata');
  }
});

test('Workers build accepts an optional full pin only after checking its ancestry against the fetched main snapshot', async t => {
  const context = await fixture(t);
  const result = await context.run({ BLOG_CONTENT_COMMIT: pinnedCommit });
  assert.equal(result.code, 0, result.output);
  const ancestor = result.commands.find(command => command.args.includes('merge-base'));
  const checkout = result.commands.find(command => command.args.includes('checkout'));
  assert.deepEqual(ancestor.args.slice(-4), ['merge-base', '--is-ancestor', pinnedCommit, mainCommit]);
  assert.deepEqual(checkout.args.slice(-4), ['checkout', '--quiet', '--detach', pinnedCommit]);
  assert.ok(result.commands.indexOf(ancestor) < result.commands.indexOf(checkout));
  assert.deepEqual(result.commands.filter(command => command.command === 'npm').map(command => command.contentPin),
    [null, null, null, null, pinnedCommit], 'Only release verification receives the resolved pin');
  assert.ok(!result.output.includes(pinnedCommit));
  assert.ok(!result.output.includes(mainCommit));
  assert.deepEqual(await readdir(path.join(context.directory, 'tmp')), ['unrelated']);
});

test('Workers build resolves main once and stays detached if the remote-tracking branch later changes', async t => {
  const context = await fixture(t);
  const result = await context.run({ FIXTURE_MOVE_MAIN: '1' });
  assert.equal(result.code, 0, result.output);
  assert.equal(result.commands.filter(command => command.args.includes('origin/main^{commit}')).length, 1);
  assert.deepEqual(result.commands.find(command => command.args.includes('checkout')).args.slice(-2), ['--detach', mainCommit]);
  const verification = result.commands.find(command => command.command === 'npm' && command.args.includes('verify:release'));
  assert.equal(verification.contentPin, mainCommit);
  assert.deepEqual(await readdir(path.join(context.directory, 'tmp')), ['unrelated']);
});

test('Workers build preserves explicit production through the final verification', async t => {
  const context = await fixture(t);
  const result = await context.run({ PUBLIC_SITE_ENV: 'production' });
  assert.equal(result.code, 0, result.output);
  assert.ok(result.commands.every(command => command.siteEnvironment === 'production'));
  const steps = result.commands.filter(command => command.command === 'npm');
  assert.deepEqual(steps.map(step => step.args.at(-1)), ['setup', 'build', 'check', 'test', 'verify:release']);
  assert.deepEqual(steps.map(step => step.proToken), [true, false, false, false, false]);
  assert.ok(steps.every(step => !step.contentToken && !step.repository));
  assert.match(result.output, /Production build verified/);
  assert.deepEqual(await readdir(path.join(context.directory, 'tmp')), ['unrelated']);
});

for (const [failingStep, expectedSteps] of [
  ['clone', []],
  ['resolve-command', []],
  ['resolve', []],
  ['ancestor', []],
  ['checkout', []],
  ['revision', []],
  ['remote', []],
  ['setup', ['setup']],
  ['build', ['setup', 'build']],
  ['site-revision', ['setup', 'build', 'check', 'test']],
  ['content-revision', ['setup', 'build', 'check', 'test']],
  ['verify:release', ['setup', 'build', 'check', 'test', 'verify:release']],
  ['site-during-verify', ['setup', 'build', 'check', 'test', 'verify:release']],
  ['content-during-verify', ['setup', 'build', 'check', 'test', 'verify:release']],
]) {
  test(`Workers build stops after ${failingStep} failure and cleans only its temporary files`, async t => {
    const context = await fixture(t);
    const result = await context.run({ FIXTURE_FAIL: failingStep, ...(failingStep === 'ancestor' ? { BLOG_CONTENT_COMMIT: pinnedCommit } : {}) });
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.output, /(?:Preview|Production) build verified/);
    const npmSteps = result.commands.filter(command => command.command === 'npm').map(command => command.args.at(-1));
    assert.deepEqual(npmSteps, expectedSteps);
    assert.deepEqual(await readdir(path.join(context.directory, 'tmp')), ['unrelated']);
    for (const secret of [context.env.BLOG_READ_TOKEN, context.env.HEROUI_AUTH_TOKEN, context.env.BLOG_CONTENT_REPOSITORY, mainCommit, pinnedCommit, 'private-revision-abc123']) {
      assert.ok(!result.output.includes(secret));
    }
  });
}
