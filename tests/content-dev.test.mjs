import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBlogChange, createImportQueue } from '../scripts/lib/content-dev.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('dev watches importable Markdown and public assets, excluding private and unrelated files', () => {
  for (const source of ['about.md', '_index.md', 'docs/Frontend/_index.md', 'docs/Frontend/article.MD', 'weekly/2026/new.md', 'timeline/2026.md', 'posts/new.mdx', 'docs/AI/Skills/_index.md', 'docs/AI/Skills/article.md']) {
    assert.equal(classifyBlogChange(source), 'content', source);
  }
  for (const source of ['static/cover.svg', 'static/demos/2026/example/index.html', 'scripts/upload-r2-image.py']) {
    assert.equal(classifyBlogChange(source), 'assets', source);
  }
  for (const source of ['private/note.md', 'docs/Private/note.md', 'docs/.hidden/note.md', 'docs/drafts/note.md', 'docs/templates/_index.md', 'docs/node_modules/readme.md', 'demos/source.md', 'skills/_index.md', 'skills/r2/SKILL.md', '.agents/skills/x/SKILL.md', '.claude/skills/x/SKILL.md', '.cursor/rules.md', 'docs/.agents/skills/x.md', 'docs/AI/.claude/note.md', 'Agents.md', 'README.md', '.git/index', 'static/private/secret.svg', 'static/.env', 'static/unlisted.txt', 'static/other/image.svg', 'scripts/tool.py']) {
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

test('the public Skills exception preserves authoring, draft and symlink boundaries', async () => {
  const { mkdtemp, mkdir, writeFile, symlink, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { collectSources, publicSources } = await import('../scripts/legacy-content.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'skills-'));
  const draft = 'docs/AI/Skills/draft.md';
  const allowed = ['docs/AI/Skills/_index.md', 'docs/AI/Skills/article.md', 'docs/AI/Skills/example.mdx', draft];
  const denied = [
    'docs/Other/skills/SKILL.md',
    'docs/MixedCase/SkIlLs/SKILL.md',
    'docs/AI/Skills/skills/nested.md',
    'docs/AI/Skills/case/SkIlLs/nested.md',
    'posts/2026/skills/SKILL.md',
    'skills/_index.md',
    'skills/r2/SKILL.md',
    '.agents/skills/x/SKILL.md',
    '.claude/skills/x/SKILL.md',
    'docs/.agents/skills/y.md',
    'docs/AI/.cursor/z.md',
    'docs/AI/Skills/.agents/skills/x/SKILL.md',
    'docs/AI/Skills/Private/secret.md',
    'docs/AI/Skills/node_modules/dependency.md',
    'docs/AI/Skills/drafts/note.md',
  ];
  try {
    for (const file of [...allowed, ...denied]) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), `---\ntitle: Fixture\ndraft: ${file === draft}\n---\n`);
    }
    for (const source of allowed) assert.equal(classifyBlogChange(source), 'content', source);
    for (const source of denied) assert.equal(classifyBlogChange(source), undefined, source);

    // Classification has no filesystem information. Only the scanner is
    // responsible for rejecting symlinked files and directories.
    await symlink(path.join(root, 'docs/AI/Skills/article.md'), path.join(root, 'docs/AI/Skills/linked-article.md'));
    await symlink(path.join(root, 'skills/r2'), path.join(root, 'docs/AI/Skills/linked-skills'));
    const records = await collectSources(root);
    const sources = new Set(records.map(record => record.source));
    assert.deepEqual([...sources].sort(), [...allowed].sort());
    for (const source of denied) assert.ok(!sources.has(source), source);
    assert.ok(!sources.has('docs/AI/Skills/linked-article.md'));
    assert.ok(![...sources].some(source => source.startsWith('docs/AI/Skills/linked-skills/')));
    assert.deepEqual(publicSources(records).map(record => record.source).sort(), allowed.filter(source => source !== draft).sort());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the public Skills directory exception requires its exact path and case', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { collectSources } = await import('../scripts/legacy-content.mjs');
  const root = await mkdtemp(path.join(tmpdir(), 'skills-case-'));
  const denied = ['docs/AI/skills/SKILL.md', 'docs/Other/SKILLS/SKILL.md', 'posts/2026/SkIlLs/SKILL.md'];
  try {
    // Keep this fixture separate from docs/AI/Skills on filesystems that fold case.
    for (const file of denied) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), '---\ntitle: Authoring fixture\ndraft: false\n---\n');
      assert.equal(classifyBlogChange(file), undefined, file);
    }
    assert.deepEqual((await collectSources(root)).map(record => record.source), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
