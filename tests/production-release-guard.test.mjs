import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { commitContains, publishedReleaseSupersedes, resolveWorkersProductionDeploy, workersProductionDeployDecision } from '../scripts/production-release-guard.mjs';

const execute = promisify(execFile);
const git = (cwd, args) => execute('git', ['-C', cwd, '-c', 'user.name=Release Guard', '-c', 'user.email=guard@example.invalid', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });

test('workers deploy guard skips an ancestor, deploys current main, and refuses unrelated history', () => {
  const ours = 'a'.repeat(40);
  const main = 'b'.repeat(40);
  assert.equal(workersProductionDeployDecision({ ourCommit: ours, mainCommit: null, containedByMain: false }).action, 'deploy');
  assert.equal(workersProductionDeployDecision({ ourCommit: ours, mainCommit: ours, containedByMain: false }).action, 'deploy');
  const skipped = workersProductionDeployDecision({ ourCommit: ours, mainCommit: main, containedByMain: true });
  assert.equal(skipped.action, 'skip');
  assert.match(skipped.message, new RegExp(`origin/main ${main} already contains sealed release ${ours}`));
  const diverged = workersProductionDeployDecision({ ourCommit: ours, mainCommit: main, containedByMain: false });
  assert.equal(diverged.action, 'fail');
  assert.match(diverged.message, /not an ancestor/);
  const unknown = workersProductionDeployDecision({ ourCommit: ours, mainCommit: main, containedByMain: null });
  assert.equal(unknown.action, 'fail');
  assert.match(unknown.message, /could not determine/);
  assert.equal(workersProductionDeployDecision({ ourCommit: 'short', mainCommit: null, containedByMain: false }).action, 'fail');
});

async function repoWithNewerMain(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'release-guard-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const site = path.join(directory, 'site');
  const bare = path.join(directory, 'origin.git');
  const newer = path.join(directory, 'newer');
  await git(directory, ['init', '--quiet', '--initial-branch=main', site]);
  await writeFile(path.join(site, 'sealed.txt'), 'sealed\n');
  await git(site, ['add', 'sealed.txt']);
  await git(site, ['commit', '--quiet', '-m', 'Sealed']);
  const ourCommit = (await git(site, ['rev-parse', 'HEAD'])).stdout.trim();
  await git(directory, ['init', '--bare', '--quiet', '--initial-branch=main', bare]);
  await git(site, ['remote', 'add', 'origin', bare]);
  await git(site, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  await execute('git', ['clone', '--quiet', bare, newer]);
  await writeFile(path.join(newer, 'newer.txt'), 'newer\n');
  await git(newer, ['add', 'newer.txt']);
  await git(newer, ['commit', '--quiet', '-m', 'Newer']);
  await git(newer, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
  const mainCommit = (await git(newer, ['rev-parse', 'HEAD'])).stdout.trim();
  return { site, ourCommit, mainCommit };
}

test('Workers CI resolves a newer origin/main and manual deploys stay allowed', async t => {
  const { site, ourCommit, mainCommit } = await repoWithNewerMain(t);
  const skipped = await resolveWorkersProductionDeploy({ root: site, ourCommit, env: { ...process.env, WORKERS_CI: '1' } });
  assert.equal(skipped.action, 'skip');
  assert.match(skipped.message, new RegExp(mainCommit));
  assert.equal((await git(site, ['status', '--porcelain', '--untracked-files=normal'])).stdout, '');
  assert.equal(await commitContains(site, ourCommit, mainCommit), true);
  const manual = await resolveWorkersProductionDeploy({ root: site, ourCommit, env: { ...process.env, WORKERS_CI: '' } });
  assert.equal(manual.action, 'deploy');
  const current = await resolveWorkersProductionDeploy({ root: newerCheckout(site), ourCommit: mainCommit, env: { ...process.env, WORKERS_CI: '1' } });
  assert.equal(current.action, 'deploy');
});

function newerCheckout(site) {
  return path.resolve(site, '../newer');
}

test('a failed online check is superseded only when production already serves a newer descendant', async t => {
  const { site, ourCommit, mainCommit } = await repoWithNewerMain(t);
  const env = { ...process.env, WORKERS_CI: '1' };
  const superseded = await publishedReleaseSupersedes({
    root: site, ourCommit, env,
    fetchImpl: async () => new Response(JSON.stringify({ siteCommit: mainCommit }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(superseded.live, mainCommit);
  assert.match(superseded.message, /Production is already/);
  const stillOurs = await publishedReleaseSupersedes({
    root: site, ourCommit, env,
    fetchImpl: async () => new Response(JSON.stringify({ siteCommit: ourCommit }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(stillOurs, null);
  const unrelated = await publishedReleaseSupersedes({
    root: site, ourCommit, env,
    fetchImpl: async () => new Response(JSON.stringify({ siteCommit: 'c'.repeat(40) }), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  assert.equal(unrelated, null);
});
