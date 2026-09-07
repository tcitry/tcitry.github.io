import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const source = new URL('../scripts/workers-build.mjs', import.meta.url);

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'workers-build-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts'));
  await mkdir(path.join(directory, 'bin'));
  await mkdir(path.join(directory, 'tmp'));
  await writeFile(path.join(directory, 'tmp', 'unrelated'), 'keep');
  const script = path.join(directory, 'scripts', 'workers-build.mjs');
  await copyFile(source, script);
  const log = path.join(directory, 'commands.jsonl');
  await writeFile(path.join(directory, 'bin', 'git'), `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
const clone = args.includes('clone');
const record = { command: 'git', args, contentToken: !!process.env.BLOG_READ_TOKEN, proToken: !!process.env.HEROUI_AUTH_TOKEN, siteEnvironment: process.env.PUBLIC_SITE_ENV };
if (clone) {
  record.askpassUser = cp.execFileSync(process.env.GIT_ASKPASS, ['Username'], { encoding: 'utf8' }).trim();
  record.askpassMatches = cp.execFileSync(process.env.GIT_ASKPASS, ['Password'], { encoding: 'utf8' }).trim() === process.env.BLOG_READ_TOKEN;
  record.askpassMode = fs.statSync(process.env.GIT_ASKPASS).mode & 0o777;
  record.askpassContainsToken = fs.readFileSync(process.env.GIT_ASKPASS, 'utf8').includes(process.env.BLOG_READ_TOKEN);
  fs.mkdirSync(args.at(-1), { recursive: true });
}
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(record) + '\\n');
// Even a Git error that contains credentials and metadata must stay private.
console.error(args.join(' ') + ' ' + (process.env.BLOG_READ_TOKEN || '') + ' private-revision-abc123');
if (process.env.FIXTURE_FAIL === (clone ? 'clone' : 'remote')) process.exit(1);
`, { mode: 0o700 });
  const npm = path.join(directory, 'npm.mjs');
  await writeFile(npm, `
import fs from 'node:fs';
const args = process.argv.slice(2);
const script = args.at(-1);
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ command: 'npm', args,
  contentToken: !!process.env.BLOG_READ_TOKEN, proToken: !!process.env.HEROUI_AUTH_TOKEN,
  repository: !!process.env.BLOG_CONTENT_REPOSITORY, blog: process.env.BLOG_DIR,
  siteEnvironment: process.env.PUBLIC_SITE_ENV, askpassExists: fs.existsSync(process.env.BLOG_DIR + '/../askpass'),
  contentExists: fs.existsSync(process.env.BLOG_DIR) }) + '\\n');
console.log('ordinary build output ' + (process.env.HEROUI_AUTH_TOKEN || '') + ' ' + process.env.BLOG_DIR);
if (process.env.FIXTURE_FAIL === script) process.exit(1);
`);
  const env = {
    ...process.env, PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env.PATH}`,
    TMPDIR: path.join(directory, 'tmp'), npm_execpath: npm, FIXTURE_LOG: log,
    BLOG_CONTENT_REPOSITORY: 'test-owner/private-content', BLOG_READ_TOKEN: 'test-private-token-123',
    HEROUI_AUTH_TOKEN: 'test-pro-token-456', SKIP_DEPENDENCY_INSTALL: '1',
  };
  delete env.PUBLIC_SITE_ENV;
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
    [{ HEROUI_AUTH_TOKEN: ' \n' }, 'HEROUI_AUTH_TOKEN'],
    [{ SKIP_DEPENDENCY_INSTALL: '' }, 'SKIP_DEPENDENCY_INSTALL=1'],
    [{ PUBLIC_SITE_ENV: '' }, 'only supports PUBLIC_SITE_ENV=production'],
    [{ PUBLIC_SITE_ENV: 'preview' }, 'only supports PUBLIC_SITE_ENV=production'],
    [{ PUBLIC_SITE_ENV: 'staging' }, 'only supports PUBLIC_SITE_ENV=production'],
    [{ PUBLIC_SITE_ENV: 'Production' }, 'only supports PUBLIC_SITE_ENV=production'],
    [{ PUBLIC_SITE_ENV: 'production\n' }, 'only supports PUBLIC_SITE_ENV=production'],
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

test('Workers build defaults to production, checks out full main history, scopes secrets and verifies in order', async t => {
  const context = await fixture(t);
  // This CI entry always prepares a production release, independently of NODE_ENV.
  const result = await context.run({ NODE_ENV: 'development' });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(result.commands.filter(command => command.command === 'npm').map(command => command.args), [
    ['run', 'setup'], ['run', 'build'], ['run', 'check'], ['test'], ['run', 'verify'],
  ]);
  const [clone, remote, ...steps] = result.commands;
  assert.deepEqual(clone.args.slice(0, -2), ['-c', 'credential.helper=', 'clone', '--quiet', '--branch', 'main', '--single-branch']);
  assert.equal(clone.args.at(-2), 'https://github.com/test-owner/private-content.git');
  assert.ok(!clone.args.some(arg => arg.includes(context.env.BLOG_READ_TOKEN) || arg.startsWith('--depth')));
  assert.equal(clone.contentToken, true);
  assert.equal(clone.proToken, false);
  assert.equal(clone.askpassUser, 'x-access-token');
  assert.equal(clone.askpassMatches, true);
  assert.equal(clone.askpassMode, 0o700);
  assert.equal(clone.askpassContainsToken, false);
  assert.deepEqual(remote.args.slice(-3), ['remote', 'remove', 'origin']);
  assert.equal(remote.contentToken, false);
  assert.deepEqual(steps.map(step => step.proToken), [true, false, false, false, false]);
  assert.ok(steps.every(step => !step.contentToken && !step.repository && !step.askpassExists));
  assert.ok(result.commands.every(command => command.siteEnvironment === 'production'));
  assert.ok(steps.every(step => step.contentExists));
  assert.equal(new Set(steps.map(step => step.blog)).size, 1);
  assert.deepEqual(await readdir(path.join(context.directory, 'tmp')), ['unrelated']);
  assert.match(result.output, /ordinary build output/);
  assert.match(result.output, /Production build verified/);
  for (const secret of [context.env.BLOG_READ_TOKEN, context.env.HEROUI_AUTH_TOKEN, context.env.BLOG_CONTENT_REPOSITORY, steps[0].blog, 'private-revision-abc123']) {
    assert.ok(!result.output.includes(secret), 'build logs must not contain credentials or private checkout metadata');
  }
});

test('Workers build preserves explicit production through the final verification', async t => {
  const context = await fixture(t);
  const result = await context.run({ PUBLIC_SITE_ENV: 'production' });
  assert.equal(result.code, 0, result.output);
  assert.ok(result.commands.every(command => command.siteEnvironment === 'production'));
  const steps = result.commands.filter(command => command.command === 'npm');
  assert.deepEqual(steps.map(step => step.args.at(-1)), ['setup', 'build', 'check', 'test', 'verify']);
  assert.deepEqual(steps.map(step => step.proToken), [true, false, false, false, false]);
  assert.ok(steps.every(step => !step.contentToken && !step.repository));
  assert.match(result.output, /Production build verified/);
  assert.deepEqual(await readdir(path.join(context.directory, 'tmp')), ['unrelated']);
});

for (const [failingStep, expectedSteps] of [
  ['clone', []],
  ['setup', ['setup']],
  ['build', ['setup', 'build']],
  ['verify', ['setup', 'build', 'check', 'test', 'verify']],
]) {
  test(`Workers build stops after ${failingStep} failure and cleans only its temporary files`, async t => {
    const context = await fixture(t);
    const result = await context.run({ FIXTURE_FAIL: failingStep });
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.output, /(?:Preview|Production) build verified/);
    const npmSteps = result.commands.filter(command => command.command === 'npm').map(command => command.args.at(-1));
    assert.deepEqual(npmSteps, expectedSteps);
    assert.deepEqual(await readdir(path.join(context.directory, 'tmp')), ['unrelated']);
    for (const secret of [context.env.BLOG_READ_TOKEN, context.env.HEROUI_AUTH_TOKEN, context.env.BLOG_CONTENT_REPOSITORY, 'private-revision-abc123']) {
      assert.ok(!result.output.includes(secret));
    }
  });
}
