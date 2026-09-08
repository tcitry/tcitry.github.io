import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { artifact, cachedThemeIntegrity } from '../scripts/theme-package.mjs';

const execute = promisify(execFile);
const source = { repository: 'https://github.com/test/theme.git', commit: 'a'.repeat(40), package: 'packages/astro-book' };
const bytes = gzipSync(Buffer.from('deterministic theme fixture'), { level: 0 });
bytes[9] = 255;
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const locked = { resolved: `file:${artifact}`, integrity };

test('Theme cache requires both the source pin and actual lockfile integrity', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'theme-cache-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const metadata = path.join(directory, 'tcitry-astro-book.source.json');
  const tarball = path.join(directory, 'tcitry-astro-book.tgz');
  assert.equal(await cachedThemeIntegrity(directory, source, locked), null);
  await writeFile(metadata, JSON.stringify({ ...source, integrity }));
  await writeFile(tarball, bytes);
  assert.equal(await cachedThemeIntegrity(directory, source, locked), integrity);
  assert.equal(await cachedThemeIntegrity(directory, { ...source, commit: 'b'.repeat(40) }, locked), null);
  assert.equal(await cachedThemeIntegrity(directory, { ...source, repository: 'https://github.com/other/theme.git' }, locked), null);
  assert.equal(await cachedThemeIntegrity(directory, source, { ...locked, integrity: 'sha512-other' }), null);
  await writeFile(tarball, 'corrupt cache');
  assert.equal(await cachedThemeIntegrity(directory, source, locked), null);
  await writeFile(metadata, 'not json');
  assert.equal(await cachedThemeIntegrity(directory, source, locked), null);
});

test('Setup excludes the Pro token from public theme processes and reuses only a verified theme cache', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'theme-setup-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts'));
  await mkdir(path.join(directory, 'bin'));
  for (const file of ['setup.mjs', 'theme-package.mjs']) await copyFile(new URL(`../scripts/${file}`, import.meta.url), path.join(directory, 'scripts', file));
  await writeFile(path.join(directory, 'astro-book.source.json'), JSON.stringify(source));
  await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/@tcitry/astro-book': locked } }));
  const log = path.join(directory, 'commands.jsonl');
  await writeFile(path.join(directory, 'bin/git'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ command: 'git', args, pro: !!process.env.HEROUI_AUTH_TOKEN }) + '\\n');
if (args[0] === 'checkout') {
  fs.mkdirSync('packages/astro-book', { recursive: true });
  fs.writeFileSync('packages/astro-book/package.json', JSON.stringify({ name: '@tcitry/astro-book', version: '1.0.0' }));
}
if (args[0] === 'rev-parse') console.log('${source.commit}');
`, { mode: 0o700 });
  const npm = path.join(directory, 'npm.mjs');
  await writeFile(npm, `
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ command: 'npm', args, pro: !!process.env.HEROUI_AUTH_TOKEN }) + '\\n');
if (args[0] === 'pack') {
  fs.writeFileSync(path.join(args.at(-1), 'theme.tgz'), Buffer.from('${bytes.toString('base64')}', 'base64'));
  console.log(JSON.stringify([{ filename: 'theme.tgz' }]));
}
`);
  const run = () => execute(process.execPath, [path.join(directory, 'scripts/setup.mjs')], {
    env: { ...process.env, PATH: `${path.join(directory, 'bin')}${path.delimiter}${process.env.PATH}`,
      npm_execpath: npm, FIXTURE_LOG: log, HEROUI_AUTH_TOKEN: 'fixture-private-pro-token' },
  });
  const first = await run();
  const records = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(records.filter(record => record.command === 'git').every(record => !record.pro));
  const npmRecords = records.filter(record => record.command === 'npm');
  assert.deepEqual(npmRecords.map(record => [record.args[0], record.pro]), [['ci', false], ['pack', false], ['ci', true]]);
  assert.ok(npmRecords.filter(record => record.args[0] === 'ci').every(record => record.args.includes('--prefer-offline')));
  assert.ok(npmRecords.filter(record => record.args[0] === 'ci').every(record => record.args.includes('--include=dev')));
  assert.ok(!first.stdout.includes('fixture-private-pro-token'));
  await writeFile(log, '');
  const second = await run();
  assert.match(second.stdout, /Reusing the verified theme artifact/);
  const cachedRecords = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(cachedRecords.map(record => [record.command, record.args[0], record.pro]), [['npm', 'ci', true]]);
  assert.equal((await readFile(path.join(directory, artifact))).equals(bytes), true);
});
