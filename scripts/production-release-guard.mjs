import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { siteOrigin } from '../src/lib/public-url.mjs';

const defaultExecute = promisify(execFile);
const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

function gitEnv(env) {
  return { ...env, GIT_TERMINAL_PROMPT: '0' };
}

async function runGit(execute, args, env, timeout = 30_000) {
  return execute('git', args, { env: gitEnv(env), encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
}

export function workersProductionDeployDecision({ ourCommit, mainCommit, containedByMain }) {
  if (!isSha(ourCommit)) return { action: 'fail', message: 'Sealed release is missing siteCommit.' };
  if (!mainCommit) return { action: 'deploy' };
  if (!isSha(mainCommit)) return { action: 'fail', message: 'origin/main is not a full commit SHA.' };
  if (mainCommit === ourCommit) return { action: 'deploy' };
  if (containedByMain === true) {
    return {
      action: 'skip',
      message: `Skipping this Workers deploy: origin/main ${mainCommit} already contains sealed release ${ourCommit}. An older in-flight build must not replace the newer production Worker.`,
    };
  }
  if (containedByMain == null) {
    return {
      action: 'fail',
      message: `Refusing to deploy sealed release ${ourCommit}: could not determine whether it is contained in origin/main ${mainCommit}.`,
    };
  }
  return {
    action: 'fail',
    message: `Refusing to deploy sealed release ${ourCommit}: origin/main is ${mainCommit} and this commit is not an ancestor of it.`,
  };
}

export async function commitContains(root, ancestor, descendant, env = process.env, execute = defaultExecute) {
  if (!isSha(ancestor) || !isSha(descendant)) return false;
  if (ancestor === descendant) return true;
  try {
    await runGit(execute, ['-C', root, 'merge-base', '--is-ancestor', ancestor, descendant], env);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    return null;
  }
}

async function remoteUrl(root, env, execute) {
  try {
    const result = await runGit(execute, ['-C', root, 'remote', 'get-url', 'origin'], env, 10_000);
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function readOriginMain(root, env = process.env, execute = defaultExecute) {
  if (!await remoteUrl(root, env, execute)) return null;
  try {
    await runGit(execute, ['-C', root, 'fetch', '--quiet', '--no-tags', 'origin', 'main'], env, 60_000);
  } catch {
    console.warn('Could not refresh origin/main before the production deploy guard; comparing the previously fetched revision.');
  }
  try {
    const result = await runGit(execute, ['-C', root, 'rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'], env, 10_000);
    const sha = result.stdout.trim();
    return isSha(sha) ? sha : null;
  } catch {
    return null;
  }
}

export async function readPublishedSiteCommit({ origin = siteOrigin, fetchImpl = fetch, timeout = 15_000 } = {}) {
  const url = new URL('/blog-release.json', origin);
  url.searchParams.set('verify', 'deploy-guard');
  const response = await fetchImpl(url, {
    cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(timeout),
    headers: { 'cache-control': 'no-cache' },
  });
  if (response.status !== 200) return null;
  const marker = await response.json();
  return isSha(marker?.siteCommit) ? marker.siteCommit : null;
}

export async function resolveWorkersProductionDeploy({ root, ourCommit, env = process.env, execute = defaultExecute } = {}) {
  const workersCi = env.WORKERS_CI === '1' || env.WORKERS_CI === 'true';
  if (!workersCi) return { action: 'deploy' };
  const mainCommit = await readOriginMain(root, env, execute);
  const containedByMain = mainCommit && mainCommit !== ourCommit
    ? await commitContains(root, ourCommit, mainCommit, env, execute)
    : false;
  return workersProductionDeployDecision({ ourCommit, mainCommit, containedByMain });
}

// A failed online check is not a defect in this release when a newer main
// commit is already what production is serving.
export async function publishedReleaseSupersedes({ root, ourCommit, env = process.env, execute = defaultExecute, fetchImpl = fetch } = {}) {
  const decision = await resolveWorkersProductionDeploy({ root, ourCommit, env, execute });
  if (decision.action !== 'skip') return null;
  let live = null;
  try { live = await readPublishedSiteCommit({ fetchImpl }); } catch { return null; }
  if (!live || live === ourCommit) return null;
  if (await commitContains(root, ourCommit, live, env, execute) !== true) return null;
  return { live, message: `${decision.message} Production is already ${live}.` };
}
