import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { assetHashes, assertSealedRelease } from '../scripts/release-manifest.mjs';
import { readerBuildIntegration } from '../scripts/reader-build.mjs';

const execute = promisify(execFile);

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'sealed-release-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const site = path.join(directory, 'site');
  const content = path.join(directory, 'content');
  for (const subdirectory of [content, site, 'site/scripts', 'site/dist', 'site/.generated', 'site/node_modules/wrangler/bin', 'site/node_modules/convex/bin']) {
    await mkdir(path.isAbsolute(subdirectory) ? subdirectory : path.join(directory, subdirectory), { recursive: true });
  }
  for (const file of ['release-manifest.mjs', 'verify-release.mjs', 'deploy-verified.mjs', 'theme-package.mjs', 'reader-config.mjs', 'reader-build.mjs', 'finalize-build.mjs', 'verify-convex-target.mjs']) {
    await copyFile(new URL(`../scripts/${file}`, import.meta.url), path.join(site, 'scripts', file));
  }
  await writeFile(path.join(site, '.gitignore'), 'dist/\n.generated/\nnode_modules/\n.env*\n');
  await writeFile(path.join(site, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(site, 'wrangler.jsonc'), '{"name":"test-worker","assets":{"directory":"./dist"}}');
  await writeFile(path.join(site, 'package.json'), JSON.stringify({ type: 'module', dependencies: { '@tcitry/astro-book': '0.1.1' } }));
  await writeFile(path.join(site, 'package-lock.json'), JSON.stringify({ packages: {
    '': { dependencies: { '@tcitry/astro-book': '0.1.1' } },
    'node_modules/@tcitry/astro-book': { version: '0.1.1', resolved: 'https://registry.npmjs.org/@tcitry/astro-book/-/astro-book-0.1.1.tgz', integrity: 'sha512-' + 'A'.repeat(86) + '==' },
  } }));
  await writeFile(path.join(site, 'dist/index.html'), '<html>production fixture</html>');
  const reader = {
    clerkPublishableKey: 'pk_live_' + Buffer.from('clerk.test.invalid$').toString('base64'),
    clerkIssuerDomain: 'https://clerk.test.invalid', convexUrl: 'https://production-fixture-123.convex.cloud',
  };
  await writeFile(path.join(site, '.generated/reader-build.json'), JSON.stringify(reader));
  await writeFile(path.join(content, 'post.md'), 'Reviewed content');
  await writeFile(path.join(site, 'scripts/verify-build.mjs'), `
import fs from 'node:fs';
fs.writeFileSync('.generated/verify-env.json', JSON.stringify({ args: process.argv.slice(2), environment: process.env.PUBLIC_SITE_ENV,
  deployToken: !!process.env.CLOUDFLARE_API_TOKEN, contentToken: !!process.env.BLOG_READ_TOKEN, proToken: !!process.env.HEROUI_AUTH_TOKEN,
  convexToken: !!process.env.CONVEX_DEPLOY_KEY, clerkSecret: !!process.env.CLERK_SECRET_KEY }));
if (process.env.FIXTURE_VERIFY_FAIL) process.exit(1);
if (process.env.FIXTURE_REWRITE_ASSET) fs.writeFileSync('dist/index.html', 'modified during verification');
if (process.env.FIXTURE_REWRITE_CONTENT) fs.writeFileSync(process.env.BLOG_DIR + '/post.md', 'unreviewed content');
fs.writeFileSync('.generated/verification.json', JSON.stringify({ environment: 'production', checkedAt: new Date().toISOString() }));
`);
  await writeFile(path.join(site, 'node_modules/wrangler/bin/wrangler.js'), `
const fs = require('node:fs');
fs.writeFileSync('.generated/deploy-env.json', JSON.stringify({ args: process.argv.slice(2), deployToken: !!process.env.CLOUDFLARE_API_TOKEN,
  contentToken: !!process.env.BLOG_READ_TOKEN, proToken: !!process.env.HEROUI_AUTH_TOKEN, repository: !!process.env.BLOG_CONTENT_REPOSITORY,
  convexToken: !!process.env.CONVEX_DEPLOY_KEY, clerkSecret: !!process.env.CLERK_SECRET_KEY }));
`);
  await writeFile(path.join(site, 'node_modules/convex/bin/main.js'), `
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync('.generated/convex-env.jsonl', JSON.stringify({ args, deployToken: !!process.env.CLOUDFLARE_API_TOKEN,
  convexToken: !!process.env.CONVEX_DEPLOY_KEY, clerkSecret: !!process.env.CLERK_SECRET_KEY,
  contentToken: !!process.env.BLOG_READ_TOKEN, proToken: !!process.env.HEROUI_AUTH_TOKEN,
  developmentSelection: !!process.env.CONVEX_DEPLOYMENT,
  envFileMatches: fs.readFileSync(args[args.indexOf('--env-file') + 1], 'utf8') === 'CONVEX_DEPLOY_KEY=' + process.env.CONVEX_DEPLOY_KEY + '\\n',
  envFileMode: fs.statSync(args[args.indexOf('--env-file') + 1]).mode & 0o777 }) + '\\n');
if (args[0] === 'env') {
  if (process.env.FIXTURE_CONVEX_FAIL === 'issuer-command') process.exit(1);
  console.log(process.env.FIXTURE_ISSUER || 'https://clerk.test.invalid');
} else {
  const result = cp.spawnSync(process.execPath, ['scripts/verify-convex-target.mjs'], { stdio: 'inherit', env: {
    ...process.env, CONVEX_DEPLOYMENT_URL: process.env.FIXTURE_TARGET_URL || 'https://production-fixture-123.convex.cloud' } });
  if (result.status !== 0) process.exit(result.status);
  if (process.env.FIXTURE_CONVEX_FAIL === 'push') {
    console.error(process.env.CONVEX_DEPLOY_KEY);
    process.exit(1);
  }
  if (process.env.FIXTURE_CONVEX_FAIL === 'rewrite') fs.writeFileSync('dist/index.html', 'changed during backend deployment');
  fs.writeFileSync('.generated/convex-deployed', '');
}
`);
  const git = (cwd, args) => execute('git', ['-C', cwd, '-c', 'user.name=Release Fixture', '-c', 'user.email=release@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args]);
  for (const checkout of [site, content]) {
    await git(checkout, ['init', '--quiet']);
    await git(checkout, ['add', '.']);
    await git(checkout, ['commit', '--quiet', '-m', 'Fixture']);
  }
  const contentCommit = (await git(content, ['rev-parse', 'HEAD'])).stdout.trim();
  const env = { ...process.env, BLOG_DIR: content, BLOG_CONTENT_COMMIT: contentCommit,
    CLOUDFLARE_API_TOKEN: 'fixture-deploy-secret', BLOG_READ_TOKEN: 'fixture-content-secret',
    HEROUI_AUTH_TOKEN: 'fixture-pro-secret', BLOG_CONTENT_REPOSITORY: 'fixture/private',
    PUBLIC_CLERK_PUBLISHABLE_KEY: reader.clerkPublishableKey, PUBLIC_CONVEX_URL: reader.convexUrl,
    CONVEX_DEPLOY_KEY: 'prod:production-fixture-123|fixture-convex-secret',
    CONVEX_DEPLOYMENT: 'dev:development-fixture', CLERK_SECRET_KEY: 'fixture-unused-clerk-secret' };
  return { directory, site, content, contentCommit, git,
    async run(script, overrides = {}) {
      try { return { ...await execute(process.execPath, [path.join(site, 'scripts', script)], { cwd: site, env: { ...env, ...overrides } }), code: 0 }; }
      catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code }; }
    },
    async manifest() { return JSON.parse(await readFile(path.join(site, '.generated/release.json'), 'utf8')); },
  };
}

test('Asset hashes cover nested and Unicode files and reject symlinks', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'release-assets-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, '文档'));
  await writeFile(path.join(directory, '文档/index.html'), 'content');
  await writeFile(path.join(directory, 'asset.js'), 'script');
  const initial = await assetHashes(directory);
  assert.deepEqual(Object.keys(initial), ['asset.js', '文档/index.html']);
  await writeFile(path.join(directory, 'asset.js'), 'changed');
  const updated = await assetHashes(directory);
  assert.notEqual(updated['asset.js'], initial['asset.js']);
  assert.equal(updated['文档/index.html'], initial['文档/index.html']);
  await symlink(path.join(directory, 'asset.js'), path.join(directory, 'linked.js'));
  await assert.rejects(assetHashes(directory), /must not contain symlinks/);
});

test('A sealed release deploys exactly its assets without needing the temporary content checkout', async t => {
  const context = await fixture(t);
  const verified = await context.run('verify-release.mjs');
  assert.equal(verified.code, 0, verified.stderr);
  const manifest = await context.manifest();
  assert.equal(manifest.contentCommit, context.contentCommit);
  const verification = JSON.parse(await readFile(path.join(context.site, '.generated/verify-env.json'), 'utf8'));
  assert.deepEqual(verification, { args: ['--env', 'production'], environment: 'production', deployToken: false, contentToken: false, proToken: false, convexToken: false, clerkSecret: false });
  for (const privateValue of [context.directory, 'fixture-deploy-secret', 'fixture-content-secret', 'fixture-pro-secret', 'fixture/private']) {
    assert.ok(!JSON.stringify(manifest).includes(privateValue));
  }
  await rm(context.content, { recursive: true });
  const deployed = await context.run('deploy-verified.mjs', { BLOG_DIR: '' });
  assert.equal(deployed.code, 0, deployed.stderr);
  const deployment = JSON.parse(await readFile(path.join(context.site, '.generated/deploy-env.json'), 'utf8'));
  assert.deepEqual(deployment, { args: ['deploy'], deployToken: true, contentToken: false, proToken: false, repository: false, convexToken: false, clerkSecret: false });
  const convexCommands = (await readFile(path.join(context.site, '.generated/convex-env.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(convexCommands.length, 2);
  assert.ok(convexCommands.every(command => command.convexToken && !command.deployToken && !command.clerkSecret && !command.contentToken && !command.proToken && !command.developmentSelection));
  assert.ok(convexCommands.every(command => command.envFileMatches && command.envFileMode === 0o600));
  assert.ok(convexCommands[1].args.includes('--codegen'));
  assert.ok(convexCommands[1].args.includes('disable'));
  assert.ok(convexCommands[1].args.includes('--cmd-url-env-var-name'));
  await assert.rejects(readFile(path.join(context.site, '.generated/convex-release.env')), { code: 'ENOENT' });
  assert.match(deployed.stdout, /without rebuilding/);
  await writeFile(path.join(context.site, 'dist/index.html'), 'unverified changes');
  await rm(path.join(context.site, '.generated/deploy-env.json'));
  const rejected = await context.run('deploy-verified.mjs');
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /assets changed after verification/);
  await assert.rejects(readFile(path.join(context.site, '.generated/deploy-env.json')), { code: 'ENOENT' });
});

test('Sealing rejects a dirty or changed content checkout and invalidates old seals on failure', async t => {
  const context = await fixture(t);
  const verified = await context.run('verify-release.mjs');
  assert.equal(verified.code, 0, verified.stderr);
  const mismatch = await context.run('verify-release.mjs', { BLOG_CONTENT_COMMIT: 'b'.repeat(40) });
  assert.equal(mismatch.code, 1);
  assert.match(mismatch.stderr, /Content does not match BLOG_CONTENT_COMMIT/);
  await assert.rejects(context.manifest(), { code: 'ENOENT' });
  const rewritten = await context.run('verify-release.mjs', { FIXTURE_REWRITE_CONTENT: '1' });
  assert.equal(rewritten.code, 1);
  assert.match(rewritten.stderr, /clean, isolated checkout/);
  await assert.rejects(context.manifest(), { code: 'ENOENT' });
});

test('Sealing rejects assets modified during verification and deployment rejects changed configuration', async t => {
  const context = await fixture(t);
  const rewritten = await context.run('verify-release.mjs', { FIXTURE_REWRITE_ASSET: '1' });
  assert.equal(rewritten.code, 1);
  assert.match(rewritten.stderr, /Assets changed during verification/);
  await assert.rejects(context.manifest(), { code: 'ENOENT' });
  const verified = await context.run('verify-release.mjs');
  assert.equal(verified.code, 0, verified.stderr);
  const manifest = await context.manifest();
  await writeFile(path.join(context.site, 'wrangler.jsonc'), '{"name":"another-worker"}');
  await assert.rejects(assertSealedRelease(context.site, manifest), /clean, isolated checkout/);
  await context.git(context.site, ['commit', '--quiet', '-am', 'Change target']);
  await assert.rejects(assertSealedRelease(context.site, manifest), /siteCommit changed after verification/);
});

test('Backend failures, a mismatched canonical target or issuer stop Worker upload', async t => {
  for (const overrides of [
    { FIXTURE_CONVEX_FAIL: 'issuer-command' },
    { FIXTURE_ISSUER: 'https://another.test.invalid' },
    { FIXTURE_TARGET_URL: 'https://development-fixture.convex.cloud' },
    { FIXTURE_CONVEX_FAIL: 'push' },
    { FIXTURE_CONVEX_FAIL: 'rewrite' },
    { CONVEX_DEPLOY_KEY: 'dev:production-fixture-123|fixture-secret' },
    { PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_fixture' },
    { PUBLIC_CONVEX_URL: 'https://another-deployment.convex.cloud' },
  ]) {
    const context = await fixture(t);
    assert.equal((await context.run('verify-release.mjs')).code, 0);
    const rejected = await context.run('deploy-verified.mjs', overrides);
    assert.equal(rejected.code, 1, rejected.stdout + rejected.stderr);
    assert.ok(!(rejected.stdout + rejected.stderr).includes('fixture-convex-secret'));
    await assert.rejects(readFile(path.join(context.site, '.generated/deploy-env.json')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(context.site, '.generated/convex-release.env')), { code: 'ENOENT' });
  }
});

test('Production sealing rejects configuration changes after the build', async t => {
  const context = await fixture(t);
  const rejected = await context.run('verify-release.mjs', { PUBLIC_CONVEX_URL: 'https://another-deployment.convex.cloud' });
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /differs from the compiled assets/);
  await assert.rejects(context.manifest(), { code: 'ENOENT' });
});

test('Changing ignored env files during compilation cannot replace the captured build configuration or create a release seal', async t => {
  const context = await fixture(t);
  const captured = JSON.parse(await readFile(path.join(context.site, '.generated/reader-build.json'), 'utf8'));
  assert.equal((await context.run('verify-release.mjs')).code, 0);
  const integration = readerBuildIntegration({ root: context.site, production: true, readerConfig: captured });
  await integration.hooks['astro:build:start']();
  await assert.rejects(context.manifest(), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(context.site, '.generated/reader-build.json')), { code: 'ENOENT' });

  // Vite has captured configuration A. An ignored file switches to B before the
  // compilation completes, which must not change what the build snapshot says.
  await writeFile(path.join(context.site, '.env.production.local'),
    `PUBLIC_CLERK_PUBLISHABLE_KEY=${captured.clerkPublishableKey}\nPUBLIC_CONVEX_URL=https://another-deployment.convex.cloud\n`);
  await integration.hooks['astro:build:done']();
  assert.deepEqual(JSON.parse(await readFile(path.join(context.site, '.generated/reader-build.json'), 'utf8')), captured);

  const overrides = { PUBLIC_SITE_ENV: 'production', PUBLIC_CLERK_PUBLISHABLE_KEY: undefined, PUBLIC_CONVEX_URL: undefined };
  const finalized = await context.run('finalize-build.mjs', overrides);
  assert.equal(finalized.code, 1);
  assert.match(finalized.stderr, /differs from the compiled assets/);
  assert.deepEqual(JSON.parse(await readFile(path.join(context.site, '.generated/reader-build.json'), 'utf8')), captured);
  const rejected = await context.run('verify-release.mjs', overrides);
  assert.equal(rejected.code, 1);
  assert.match(rejected.stderr, /differs from the compiled assets/);
  await assert.rejects(context.manifest(), { code: 'ENOENT' });
});

test('A preview build invalidates the previous production seal without creating a production snapshot', async t => {
  const context = await fixture(t);
  assert.equal((await context.run('verify-release.mjs')).code, 0);
  const integration = readerBuildIntegration({ root: context.site, production: false, readerConfig: {} });
  await integration.hooks['astro:build:start']();
  await integration.hooks['astro:build:done']();
  await assert.rejects(context.manifest(), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(context.site, '.generated/reader-build.json')), { code: 'ENOENT' });
});
