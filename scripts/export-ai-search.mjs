import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCorpus, jsonBytes } from './lib/ai-search-corpus.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.generated/ai-search');
const staging = path.join(root, '.generated/ai-search-exporting');
const commit = directory => {
  try { return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};
try {
  const content = JSON.parse(await readFile(path.join(root, '.generated/content.json'), 'utf8'));
  const revision = { siteCommit: commit(root), contentCommit: commit(path.resolve(process.env.BLOG_DIR || path.join(homedir(), 'Blog'))) };
  if (process.env.BLOG_CONTENT_COMMIT) assert.equal(revision.contentCommit, process.env.BLOG_CONTENT_COMMIT, 'AI Search source must match BLOG_CONTENT_COMMIT');
  const environment = process.env.PUBLIC_SITE_ENV === 'production' ? 'production' : 'preview';
  const { documents, references, manifest } = createCorpus(content.pages, { revision, environment });
  await rm(staging, { recursive: true, force: true });
  await mkdir(path.join(staging, 'documents'), { recursive: true });
  for (const document of documents) await writeFile(path.join(staging, 'documents', `${document.id}.md`), document.markdown);
  await writeFile(path.join(staging, 'references.json'), jsonBytes(references));
  await writeFile(path.join(staging, 'manifest.json'), jsonBytes(manifest));
  await rm(directory, { recursive: true, force: true });
  await rename(staging, directory);
  console.log(`Exported ${documents.length} public articles for AI Search (${environment}); no remote changes.`);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'AI Search export failed; prepare the reviewed content and inspect the local build.');
  process.exitCode = 1;
}
