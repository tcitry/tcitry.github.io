import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, copyFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';

test('Public source check blocks tracked env and credential patterns without echoing values', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'reader-public-check-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(path.join(root, 'scripts'));
  await copyFile(new URL('../scripts/check-public-source.mjs', import.meta.url), path.join(root, 'scripts/check-public-source.mjs'));
  execFileSync('git', ['init', '-q', '-b', 'main'], {cwd: root});
  await writeFile(path.join(root, '.gitignore'), '.env.local\n');
  const credential = 'sk_live_' + 'x'.repeat(40);
  await writeFile(path.join(root, '.env.local'), `CLERK_SECRET_KEY=${credential}\n`);
  await writeFile(path.join(root, '.env.example'), 'PUBLIC_CLERK_PUBLISHABLE_KEY=\n');
  const run = () => execFileSync(process.execPath, ['scripts/check-public-source.mjs'], {cwd: root, encoding: 'utf8', stdio: 'pipe'});
  assert.match(run(), /passed/);
  await writeFile(path.join(root, 'accidental-key.ts'), `export const key = '${credential}';\n`);
  assert.throws(run, error => error.status === 1 && error.stderr.includes('accidental-key.ts') && !error.stderr.includes(credential));
  await rm(path.join(root, 'accidental-key.ts'));
  execFileSync('git', ['add', '-f', '.env.local'], {cwd: root});
  assert.throws(run, error => error.status === 1 && error.stderr.includes('environment files must be ignored') && !error.stderr.includes(credential));
});
