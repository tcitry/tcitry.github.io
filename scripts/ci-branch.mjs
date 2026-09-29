import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

export const PRODUCTION_BRANCH = 'main';

export function resolveWorkersBranch(env = process.env) {
  if (env.WORKERS_CI === '1' || env.WORKERS_CI === 'true') return env.WORKERS_CI_BRANCH ?? null;
  try { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return null; }
}

export function assertProductionWorkersBranch(env = process.env) {
  const branch = resolveWorkersBranch(env);
  assert.ok(branch, 'Could not resolve the current Workers Builds branch. Set WORKERS_CI_BRANCH in CI or run from a git checkout.');
  assert.equal(branch, PRODUCTION_BRANCH,
    `Production Workers Builds commands only run on ${PRODUCTION_BRANCH}; the current branch is ${branch}. Use npm run build:preview and npm run deploy:preview on other branches.`);
}

export function assertPreviewWorkersBranch(env = process.env) {
  const branch = resolveWorkersBranch(env);
  assert.ok(branch, 'Could not resolve the current Workers Builds branch. Set WORKERS_CI_BRANCH in CI or run from a git checkout.');
  assert.notEqual(branch, PRODUCTION_BRANCH,
    `Preview Workers Builds commands must not run on ${PRODUCTION_BRANCH}; use build:workers and deploy:verified for production instead.`);
}

/** Aliases for wrangler versions upload --preview-alias. */
export function previewAliasFromBranch(branch, workerName = 'tcitry-blog') {
  assert.ok(typeof branch === 'string' && branch.trim(), 'Preview alias requires a branch name.');
  let alias = branch.trim().toLowerCase().replaceAll('/', '-').replaceAll('_', '-');
  alias = alias.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  assert.match(alias, /^[a-z][a-z0-9-]*$/, 'The branch name cannot be converted into a valid Workers preview alias.');
  const limit = 63 - workerName.length - 1;
  assert.ok(alias.length <= limit, `The preview alias derived from ${branch} exceeds the DNS label limit (${limit} characters).`);
  return alias;
}
