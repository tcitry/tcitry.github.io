import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBlogChange, createImportQueue } from '../scripts/lib/content-dev.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('dev watches importable Markdown and public assets, excluding private and unrelated files', () => {
  for (const source of ['about.md', '_index.md', 'docs/Frontend/_index.md', 'docs/Frontend/article.MD', 'weekly/2026/new.md', 'timeline/2026.md', 'posts/new.mdx']) {
    assert.equal(classifyBlogChange(source), 'content', source);
  }
  for (const source of ['static/cover.svg', 'static/demos/2026/example/index.html', 'scripts/upload-r2-image.py']) {
    assert.equal(classifyBlogChange(source), 'assets', source);
  }
  for (const source of ['private/note.md', 'docs/Private/note.md', 'docs/.hidden/note.md', 'docs/drafts/note.md', 'docs/templates/_index.md', 'docs/node_modules/readme.md', 'demos/source.md', 'Agents.md', 'README.md', '.git/index', 'static/private/secret.svg', 'static/.env', 'static/unlisted.txt', 'static/other/image.svg', 'scripts/tool.py']) {
    assert.equal(classifyBlogChange(source), undefined, source);
  }
});

test('rapid saves coalesce into one import of each kind', { timeout: 2000 }, async t => {
  const calls = [];
  const queue = createImportQueue({ delay: 10, run: async batch => { calls.push([...batch].sort()); } });
  t.after(() => queue.close());
  queue.enqueue('content');
  queue.enqueue('content');
  queue.enqueue('assets');
  await queue.whenIdle();
  assert.deepEqual(calls, [['assets', 'content']]);
});

test('saves during an import are retained for a later serial batch', { timeout: 2000 }, async t => {
  const started = deferred(), finish = deferred();
  const calls = [];
  let concurrent = 0;
  const queue = createImportQueue({
    delay: 10,
    async run(batch) {
      assert.equal(++concurrent, 1, 'imports must not overlap');
      calls.push([...batch].sort());
      if (calls.length === 1) { started.resolve(); await finish.promise; }
      concurrent--;
    },
  });
  t.after(() => queue.close());
  queue.enqueue('content');
  await started.promise;
  queue.enqueue('assets');
  queue.enqueue('content');
  finish.resolve();
  await queue.whenIdle();
  assert.deepEqual(calls, [['content'], ['assets', 'content']]);
});

test('a failed import keeps watching and the next save can recover', { timeout: 2000 }, async t => {
  const errors = [], successes = [];
  let runs = 0;
  const queue = createImportQueue({
    delay: 10,
    async run() { if (++runs === 1) throw new Error('invalid front matter'); },
    onError(error) { errors.push(error.message); },
    onSuccess(batch) { successes.push([...batch]); },
  });
  t.after(() => queue.close());
  queue.enqueue('content');
  await queue.whenIdle();
  assert.deepEqual(errors, ['invalid front matter']);
  assert.deepEqual(successes, []);
  queue.enqueue('content');
  await queue.whenIdle();
  assert.deepEqual(successes, [['content']]);
});

test('closing cancels a pending debounce and releases waiting requests', async () => {
  let runs = 0;
  const queue = createImportQueue({ delay: 100, run: async () => { runs++; } });
  queue.enqueue('content');
  const waiting = queue.whenIdle();
  await queue.close();
  await waiting;
  queue.enqueue('content');
  await queue.whenIdle();
  assert.equal(runs, 0);
});

test('the next save retries the whole failed batch, including assets skipped after a content error', { timeout: 2000 }, async t => {
  const calls = [];
  const queue = createImportQueue({
    delay: 10,
    async run(batch) {
      calls.push([...batch].sort());
      if (calls.length === 1) throw new Error('content failed before assets ran');
    },
  });
  t.after(() => queue.close());
  queue.enqueue('content');
  queue.enqueue('assets');
  await queue.whenIdle();
  assert.equal(calls.length, 1, 'failure must not start an endless retry loop');
  queue.enqueue('content');
  await queue.whenIdle();
  assert.deepEqual(calls, [['assets', 'content'], ['assets', 'content']]);
});

test('closing aborts the active import and discards queued work without logging errors', { timeout: 2000 }, async () => {
  const started = deferred();
  let runs = 0;
  const queue = createImportQueue({
    delay: 10,
    async run(_batch, signal) {
      runs++;
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
        started.resolve();
      });
    },
    onSuccess() { assert.fail('a stopped import cannot succeed'); },
    onError() { assert.fail('normal shutdown is not an import error'); },
  });
  queue.enqueue('content');
  await started.promise;
  queue.enqueue('assets');
  await queue.close();
  await queue.whenIdle();
  assert.equal(runs, 1);
});
