import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const previewKey = 'pk_test_' + Buffer.from('dev-fixture.clerk.accounts.dev$').toString('base64');
const productionKey = 'pk_live_' + Buffer.from('clerk.test.invalid$').toString('base64');
const stagingDeployKey = 'dev:staging-fixture-123|fixture-secret';
const prodDeployKey = 'prod:hushed-mallard-700|ambient-prod-secret';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'deploy-preview-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts'));
  await mkdir(path.join(directory, '.generated'));
  await mkdir(path.join(directory, 'node_modules/convex/bin'), { recursive: true });
  await writeFile(path.join(directory, 'wrangler.jsonc'), JSON.stringify({
    vars: { PUBLIC_CLERK_PUBLISHABLE_KEY: productionKey, PUBLIC_CONVEX_URL: 'https://hushed-mallard-700.convex.cloud' },
  }));
  for (const file of ['deploy-preview.mjs', 'reader-config.mjs', 'ci-branch.mjs', 'verify-convex-preview-target.mjs']) {
    await copyFile(new URL(`../scripts/${file}`, import.meta.url), path.join(directory, 'scripts', file));
  }
  await mkdir(path.join(directory, 'src/lib'), { recursive: true });
  await copyFile(new URL('../src/lib/public-ai-search-url.mjs', import.meta.url), path.join(directory, 'src/lib/public-ai-search-url.mjs'));
  await writeFile(path.join(directory, '.generated/preview-build.json'), JSON.stringify({
    version: 1,
    environment: 'preview',
    branch: 'feature/preview',
    siteCommit: 'e'.repeat(40),
    contentCommit: 'c'.repeat(40),
    reader: {
      clerkPublishableKey: previewKey,
      clerkIssuerDomain: 'https://dev-fixture.clerk.accounts.dev',
      convexUrl: 'https://staging-fixture-123.convex.cloud',
      aiSearchUrl: 'https://fixture.search.ai.cloudflare.com/search',
    },
    verifiedAt: '2026-09-29T00:00:00.000Z',
  }, null, 2) + '\n');
  const log = path.join(directory, 'commands.jsonl');
  await writeFile(path.join(directory, 'node_modules/convex/bin/main.js'), `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const envFile = args.includes('--env-file') ? args[args.indexOf('--env-file') + 1] : null;
const record = {
  command: 'convex', args,
  convexDeployKey: process.env.CONVEX_DEPLOY_KEY ?? null,
  envFileDeployKey: envFile && fs.existsSync(envFile) ? (fs.readFileSync(envFile, 'utf8').match(/^CONVEX_DEPLOY_KEY=(.*)$/m)?.[1] ?? null) : null,
};
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(record) + '\\n');
if (args[0] === 'env' && args[1] === 'get' && args[2] === 'CLERK_FRONTEND_API_URL') {
  console.log('https://dev-fixture.clerk.accounts.dev');
  process.exit(0);
}
if (args[0] === 'env' && args[1] === 'get' && args[2] === 'AI_SEARCH_PUBLIC_URL') {
  console.log('https://fixture.search.ai.cloudflare.com/search');
  process.exit(0);
}
if (args[0] === 'deploy') process.exit(0);
process.exit(0);
`);
  await mkdir(path.join(directory, 'node_modules/wrangler/bin'), { recursive: true });
  await writeFile(path.join(directory, 'node_modules/wrangler/bin/wrangler.js'), `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ command: 'wrangler', args: process.argv.slice(2) }) + '\\n');
`);
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    FIXTURE_LOG: log,
    WORKERS_CI: '1',
    WORKERS_CI_BRANCH: 'feature/preview',
    PREVIEW_PUBLIC_CLERK_PUBLISHABLE_KEY: previewKey,
    PREVIEW_PUBLIC_CONVEX_URL: 'https://staging-fixture-123.convex.cloud',
    PREVIEW_AI_SEARCH_PUBLIC_URL: 'https://fixture.search.ai.cloudflare.com/search',
    PREVIEW_CONVEX_DEPLOY_KEY: stagingDeployKey,
    CONVEX_DEPLOY_KEY: prodDeployKey,
    PUBLIC_CLERK_PUBLISHABLE_KEY: productionKey,
    PUBLIC_CONVEX_URL: 'https://hushed-mallard-700.convex.cloud',
    AI_SEARCH_PUBLIC_URL: 'https://fixture.search.ai.cloudflare.com/search',
    CLOUDFLARE_API_TOKEN: 'ambient-cf-token',
  };
  return {
    directory, env,
    async run(overrides = {}) {
      let result;
      try {
        result = { ...await execute(process.execPath, [path.join(directory, 'scripts/deploy-preview.mjs')], {
          env: { ...env, ...overrides }, cwd: directory,
        }), code: 0 };
      } catch (error) {
        result = { stdout: error.stdout, stderr: error.stderr, code: error.code };
      }
      let commands = [];
      try { commands = (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return { ...result, commands, output: result.stdout + result.stderr };
    },
  };
}

test('deploy preview ignores ambient production deploy credentials and only passes the staging Convex key', async t => {
  const context = await fixture(t);
  const result = await context.run();
  assert.equal(result.code, 0, result.output);
  const convexCommands = result.commands.filter(command => command.command === 'convex');
  assert.ok(convexCommands.length >= 2, result.output);
  assert.ok(convexCommands.every(command => command.convexDeployKey == null));
  assert.ok(convexCommands.filter(command => command.args[0] === 'deploy').every(command => command.envFileDeployKey === stagingDeployKey));
  assert.ok(convexCommands.every(command => command.envFileDeployKey !== prodDeployKey));
  assert.ok(!result.output.includes(prodDeployKey));
  assert.ok(result.commands.some(command => command.command === 'wrangler'));
});
