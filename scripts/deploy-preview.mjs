import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { previewAliasFromBranch, assertPreviewWorkersBranch, resolveWorkersBranch } from './ci-branch.mjs';
import {
  assertClerkIssuer, assertConvexSearchURL, assertNoProductionReaderValues, assertPreviewDeployKey,
  assertPreviewReaderSources, readPreviewReaderConfig, withoutReaderSecrets,
} from './reader-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const convexEnvFile = path.join(root, '.generated/convex-preview.env');
const manifestPath = path.join(root, '.generated/preview-build.json');

try {
  assertPreviewWorkersBranch();
  assertNoProductionReaderValues();
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.environment, 'preview', 'Deploy preview requires a sealed preview build from npm run build:preview.');
  const { mapped } = assertPreviewReaderSources();
  const reader = readPreviewReaderConfig(mapped);
  assert.deepEqual(reader, manifest.reader, 'Preview reader configuration changed after the preview build.');
  assertPreviewDeployKey(mapped, reader);
  const env = withoutReaderSecrets({ ...process.env, ...mapped, PUBLIC_SITE_ENV: 'preview' });
  for (const name of ['BLOG_READ_TOKEN', 'BLOG_CONTENT_REPOSITORY', 'BLOG_CONTENT_COMMIT', 'HEROUI_AUTH_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']) delete env[name];
  const convexEnv = { ...env, CONVEX_DEPLOY_KEY: mapped.CONVEX_DEPLOY_KEY };
  for (const name of Object.keys(convexEnv)) {
    if (/^(?:CLOUDFLARE_|CF_)/.test(name) || /(?:TOKEN|SECRET|PASSWORD|DEPLOY_KEY|ADMIN_KEY)/.test(name)) delete convexEnv[name];
  }
  const secretValues = Object.entries(mapped).filter(([name, value]) => value && /(?:TOKEN|SECRET|PASSWORD|DEPLOY_KEY|ADMIN_KEY)/.test(name))
    .flatMap(([, value]) => [value, encodeURIComponent(value)]);
  const redact = value => secretValues.reduce((output, secret) => output.replaceAll(secret, '[redacted]'), String(value ?? ''));
  async function run(label, args, commandEnv, quiet = false) {
    console.log(label);
    try {
      const result = await execute(process.execPath, args, { cwd: root, env: commandEnv, maxBuffer: 32 * 1024 * 1024 });
      if (!quiet) {
        process.stdout.write(redact(result.stdout));
        process.stderr.write(redact(result.stderr));
      }
      return result.stdout;
    } catch (error) {
      const stdout = redact(error.stdout);
      const stderr = redact(error.stderr);
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      const snippet = quiet ? [stdout, stderr].map(part => part.trim()).filter(Boolean).join('\n') : '';
      const failure = new Error(snippet ? `${label} failed\n${snippet}` : `${label} failed`);
      failure.name = 'DeployStepError';
      throw failure;
    }
  }
  await rm(convexEnvFile, { force: true });
  await writeFile(convexEnvFile, `CONVEX_DEPLOY_KEY=${mapped.CONVEX_DEPLOY_KEY}\n`, { mode: 0o600, flag: 'wx' });
  const convex = ['node_modules/convex/bin/main.js'];
  const issuer = await run('Checking the staging Clerk issuer in Convex',
    [...convex, 'env', 'get', 'CLERK_FRONTEND_API_URL', '--env-file', convexEnvFile], convexEnv, true);
  assertClerkIssuer(issuer.trim(), reader);
  let publicSearchEndpoint;
  try {
    const output = await run('Checking the staging AI Search endpoint in Convex',
      [...convex, 'env', 'get', 'AI_SEARCH_PUBLIC_URL', '--env-file', convexEnvFile], convexEnv, true);
    publicSearchEndpoint = output.replace(/\r?\n$/, '');
  } catch { /* The same explicit configuration error covers an unreadable value. */ }
  assertConvexSearchURL(publicSearchEndpoint, reader);
  await run('Deploying Convex functions to the shared staging deployment', [...convex, 'deploy', '--yes', '--typecheck', 'enable', '--codegen', 'disable',
    '--env-file', convexEnvFile, '--cmd', 'node scripts/verify-convex-preview-target.mjs',
    '--cmd-url-env-var-name', 'CONVEX_DEPLOYMENT_URL'], { ...convexEnv, ...mapped });
  const branch = resolveWorkersBranch() ?? manifest.branch;
  assert.ok(branch, 'Could not resolve the preview branch for alias assignment.');
  const previewAlias = previewAliasFromBranch(branch);
  console.log(`Uploading preview Worker version with alias ${previewAlias}; production traffic is unchanged.`);
  const uploadArgs = ['node_modules/wrangler/bin/wrangler.js', 'versions', 'upload',
    '--preview-alias', previewAlias,
    '--var', `PUBLIC_CLERK_PUBLISHABLE_KEY:${reader.clerkPublishableKey}`,
    '--var', `PUBLIC_CONVEX_URL:${reader.convexUrl}`,
    '--message', `preview ${branch} ${manifest.siteCommit.slice(0, 7)}`];
  await run('Uploading the preview Worker version', uploadArgs, env);
  console.log(`Preview deployment finished for branch ${branch}. Workers Builds posts the Version URL comment on the pull request.`);
} catch (error) {
  if (error instanceof assert.AssertionError) {
    console.error(error.message.split('\n')[0]);
  } else if (error?.name === 'DeployStepError') {
    console.error(error.message);
  } else {
    console.error('Preview deployment failed. Check the Convex staging deploy and Worker version upload result.');
  }
  process.exitCode = 1;
} finally {
  await rm(convexEnvFile, { force: true });
}
