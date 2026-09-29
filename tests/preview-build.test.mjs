import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const source = new URL('../scripts/preview-build.mjs', import.meta.url);
const previewKey = 'pk_test_' + Buffer.from('dev-fixture.clerk.accounts.dev$').toString('base64');

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'preview-build-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts'));
  await mkdir(path.join(directory, 'bin'));
  await mkdir(path.join(directory, 'tmp'));
  const script = path.join(directory, 'scripts/preview-build.mjs');
  await copyFile(source, script);
  for (const file of ['reader-config.mjs', 'workers-build-shared.mjs', 'ci-branch.mjs']) {
    await copyFile(new URL(`../scripts/${file}`, import.meta.url), path.join(directory, 'scripts', file));
  }
  await mkdir(path.join(directory, 'src/lib'), { recursive: true });
  await copyFile(new URL('../src/lib/public-ai-search-url.mjs', import.meta.url), path.join(directory, 'src/lib/public-ai-search-url.mjs'));
  const log = path.join(directory, 'commands.jsonl');
  await writeFile(path.join(directory, 'bin/git'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.includes('clone')) fs.mkdirSync(args.at(-1), { recursive: true });
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ command: 'git', args, siteEnvironment: process.env.PUBLIC_SITE_ENV }) + '\\n');
if (args.includes('rev-parse')) console.log('e'.repeat(40));
`, { mode: 0o700 });
  const npm = path.join(directory, 'npm.mjs');
  await writeFile(npm, `
import fs from 'node:fs';
const args = process.argv.slice(2);
const script = args.at(-1);
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ command: 'npm', args, siteEnvironment: process.env.PUBLIC_SITE_ENV,
  clerk: process.env.PUBLIC_CLERK_PUBLISHABLE_KEY?.slice(0, 7) ?? null, convex: process.env.PUBLIC_CONVEX_URL ?? null }) + '\\n');
if (process.env.FIXTURE_FAIL === script) process.exit(1);
`);
  const env = {
    ...process.env, PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env.PATH}`,
    TMPDIR: path.join(directory, 'tmp'), npm_execpath: npm, FIXTURE_LOG: log,
    BLOG_CONTENT_REPOSITORY: 'test-owner/private-content', BLOG_READ_TOKEN: 'test-private-token-123',
    HEROUI_AUTH_TOKEN: 'test-pro-token-456', SKIP_DEPENDENCY_INSTALL: '1',
    WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feature/preview',
    PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY: previewKey,
    PREVIEW_PUBLIC_CONVEX_URL: 'https://staging-fixture-123.convex.cloud',
    PREVIEW_AI_SEARCH_PUBLIC_URL: 'https://fixture.search.ai.cloudflare.com/search',
    PREVIEW_CONVEX_DEPLOY_KEY: 'dev:staging-fixture-123|fixture-secret',
  };
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

test('preview build rejects main and production configuration before any command runs', async t => {
  const context = await fixture(t);
  const mainBranch = await context.run({ WORKERS_CI_BRANCH: 'main' });
  assert.equal(mainBranch.code, 1);
  assert.match(mainBranch.output, /must not run on main/);
  const productionConvex = await context.run({ PREVIEW_PUBLIC_CONVEX_URL: 'https://hushed-mallard-700.convex.cloud' });
  assert.equal(productionConvex.code, 1);
  assert.match(productionConvex.output, /must not target the production Convex deployment/);
  const productionKey = await context.run({ PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_' + Buffer.from('clerk.test.invalid$').toString('base64') });
  assert.equal(productionKey.code, 1);
  assert.match(productionKey.output, /pk_test/);
  assert.deepEqual(mainBranch.commands, []);
});

test('preview build maps staging reader values through the npm pipeline', async t => {
  const context = await fixture(t);
  const result = await context.run();
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(result.commands.filter(command => command.command === 'npm').map(command => command.args), [
    ['run', 'setup'], ['run', 'build'], ['run', 'check'], ['test'], ['run', 'finalize-preview-build'],
  ]);
  const steps = result.commands.filter(command => command.command === 'npm');
  const testStep = steps.find(step => step.args.at(-1) === 'test');
  assert.equal(testStep.siteEnvironment, undefined);
  assert.ok(steps.filter(step => step !== testStep).every(step => step.siteEnvironment === 'preview'));
  assert.ok(steps.filter(step => ['build', 'check', 'finalize-preview-build'].includes(step.args.at(-1)))
    .every(step => step.clerk === 'pk_test' && step.convex === 'https://staging-fixture-123.convex.cloud'));
  assert.match(result.output, /Preview build verified/);
  assert.deepEqual(await readdir(path.join(context.directory, 'tmp')), []);
});
