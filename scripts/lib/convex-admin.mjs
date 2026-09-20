import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { assertProductionDeployKey, loadReaderEnvironment, readProductionReaderConfig } from '../reader-config.mjs';

const execute = promisify(execFile);

export async function prepareConvexAdminEnv(root) {
  const configured = loadReaderEnvironment(root);
  const reader = readProductionReaderConfig(configured);
  assertProductionDeployKey(configured, reader);
  const envFile = path.join(root, '.generated/convex-admin.env');
  await mkdir(path.dirname(envFile), { recursive: true });
  await rm(envFile, { force: true });
  await writeFile(envFile, `CONVEX_DEPLOY_KEY=${configured.CONVEX_DEPLOY_KEY}\n`, { mode: 0o600, flag: 'wx' });
  return { env: configured, envFile, convexUrl: reader.convexUrl };
}

export async function runConvexAdminFunction(root, functionName, args, { push = false, log = console.log } = {}) {
  const { env, envFile, convexUrl } = await prepareConvexAdminEnv(root);
  const cli = [path.join(root, 'node_modules/convex/bin/main.js'), 'run', functionName, JSON.stringify(args), '--env-file', envFile];
  if (push) cli.push('--push');
  log(`Running ${functionName} on ${convexUrl}${push ? ' (with --push)' : ''}`);
  const result = await execute(process.execPath, cli, { cwd: root, env, maxBuffer: 16 * 1024 * 1024 });
  const output = result.stdout.trim();
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    return output;
  }
}

export function assertConvexAdminConfigured(root) {
  assert.ok(process.env.CONVEX_DEPLOY_KEY, 'Set CONVEX_DEPLOY_KEY to the production deployment key before applying the import.');
  assert.ok(process.env.PUBLIC_CONVEX_URL, 'Set PUBLIC_CONVEX_URL to the production Convex deployment URL before applying the import.');
  return prepareConvexAdminEnv(root);
}
