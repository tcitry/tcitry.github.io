import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gitDates } from '../scripts/legacy-content.mjs';

test('Git dates preserve literal filenames and the latest commit without changing the source', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'blog-git-dates-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args, date) => execFileSync('git', [
    '-c', 'commit.gpgSign=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'user.name=Git dates fixture', '-c', 'user.email=fixture@example.invalid',
    '-C', root, ...args,
  ], {
    encoding: 'utf8',
    env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  });
  git(['init', '--quiet']);
  const firstDate = '2024-01-02T03:04:05.000Z';
  const latestDate = '2024-06-07T08:09:10.000Z';
  const files = [
    'docs/Kubernetes/理解 "Pod" 的生命周期.md',
    'docs/中文文档/更新记录.md',
    'docs/space in the name.md',
    'posts/normal.md',
    'weekly/line\nbreak.md',
    'docs/tab\tin the name.md',
    'about.md',
  ];
  for (const source of [...files, 'README.md']) {
    await mkdir(path.dirname(path.join(root, source)), { recursive: true });
    await writeFile(path.join(root, source), 'First revision.\n');
  }
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', 'Initial fixture content'], firstDate);

  const updated = new Set([files[0], files[1], files[4], files[6]]);
  for (const source of updated) await writeFile(path.join(root, source), 'Second revision.\n');
  git(['add', '--all']);
  git(['commit', '--quiet', '-m', 'Update selected fixture content'], latestDate);
  await writeFile(path.join(root, 'docs/untracked.md'), 'Uncommitted fixture.\n');
  const statusBefore = git(['status', '--porcelain=v1', '-z']);
  const headBefore = git(['rev-parse', 'HEAD']);
  const contentsBefore = await Promise.all(files.map((source) => readFile(path.join(root, source), 'utf8')));

  const dates = gitDates(root);
  assert.equal(dates.size, files.length, 'Only committed sources in the existing path scope are returned');
  for (const source of files) {
    assert.equal(dates.get(source), updated.has(source) ? latestDate : firstDate,
      `${JSON.stringify(source)} uses its actual latest commit timestamp`);
  }
  assert.deepEqual([...dates.keys()].sort(), [...files].sort(), 'Names are neither quoted, split, nor escaped');
  assert.equal(dates.has('docs/untracked.md'), false);
  assert.equal(dates.has('README.md'), false);
  assert.equal(git(['status', '--porcelain=v1', '-z']), statusBefore, 'The content worktree and index are unchanged');
  assert.equal(git(['rev-parse', 'HEAD']), headBefore, 'The content repository history is unchanged');
  assert.deepEqual(await Promise.all(files.map((source) => readFile(path.join(root, source), 'utf8'))), contentsBefore,
    'Reading Git dates never rewrites Markdown');
});
