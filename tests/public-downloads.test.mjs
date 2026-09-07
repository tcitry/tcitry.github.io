import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { copyPublicDownloads } from '../scripts/public-downloads.mjs';

test('publishes the article download without copying adjacent scripts or credentials', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'blog-downloads-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const blog = path.join(root, 'blog'), output = path.join(root, 'public');
  await mkdir(path.join(blog, 'scripts'), { recursive: true });
  await writeFile(path.join(blog, 'scripts/upload-r2-image.py'), '# public example\n');
  await writeFile(path.join(blog, 'scripts/local-tool.py'), '# local only\n');
  await writeFile(path.join(blog, '.env'), 'PRIVATE_FIXTURE=value\n');
  await copyPublicDownloads(blog, output);
  assert.deepEqual(await readdir(output), ['scripts']);
  assert.deepEqual(await readdir(path.join(output, 'scripts')), ['upload-r2-image.py']);
  assert.equal(await readFile(path.join(output, 'scripts/upload-r2-image.py'), 'utf8'), '# public example\n');
});

test('rejects a missing download or a symlink to private data', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'blog-downloads-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const blog = path.join(root, 'blog'), output = path.join(root, 'public');
  await mkdir(path.join(blog, 'scripts'), { recursive: true });
  await assert.rejects(copyPublicDownloads(blog, output), { code: 'ENOENT' });
  await writeFile(path.join(blog, '.env'), 'PRIVATE_FIXTURE=value\n');
  await symlink('../.env', path.join(blog, 'scripts/upload-r2-image.py'));
  await assert.rejects(copyPublicDownloads(blog, output), /regular file inside Blog/);
  await rm(path.join(blog, 'scripts'), { recursive: true });
  await mkdir(path.join(blog, 'private'));
  await writeFile(path.join(blog, 'private/upload-r2-image.py'), '# private fixture\n');
  await symlink('private', path.join(blog, 'scripts'));
  await assert.rejects(copyPublicDownloads(blog, output), /regular file inside Blog/);
});
