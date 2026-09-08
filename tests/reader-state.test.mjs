import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('../src/components/reader/reader-state.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {receiveNote, noteHasConflict, beginNoteSave, failNoteSave, acknowledgeNote, readingProgress, resumeScrollY, createProgressReporter} = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('remote note changes refresh clean editors but preserve unsaved text and its original version', () => {
  const original = {note: 'Original', updatedAt: 10};
  const remote = {note: 'Updated on another device', updatedAt: 20};
  const clean = receiveNote(null, original);
  assert.deepEqual(receiveNote(clean, remote), {text: remote.note, base: remote, remote, remoteChanged: false, saving: false});
  const dirty = {...clean, text: 'My local changes'};
  const conflicted = receiveNote(dirty, remote);
  assert.equal(conflicted.text, 'My local changes');
  assert.deepEqual(conflicted.base, original);
  assert.equal(noteHasConflict(conflicted), true);
  assert.equal(noteHasConflict({...conflicted, base: conflicted.remote}), false);
});

test('remote deletion conflicts with an unsaved draft without discarding either snapshot', () => {
  const dirty = {...receiveNote(null, {note: 'Saved note', updatedAt: 10}), text: 'Unsaved changes'};
  const conflicted = receiveNote(dirty, {note: '', updatedAt: null});
  assert.equal(conflicted.text, 'Unsaved changes');
  assert.equal(conflicted.base.updatedAt, 10);
  assert.equal(conflicted.remote.updatedAt, null);
  assert.equal(noteHasConflict(conflicted), true);
});

test('a save acknowledgement adopts normalized text and retains edits made during the request', () => {
  const dirty = {...receiveNote(null, {note: '', updatedAt: null}), text: '  Submitted  '};
  const saved = {note: 'Submitted', updatedAt: 10};
  assert.deepEqual(acknowledgeNote(dirty, dirty.text, saved), {text: 'Submitted', base: saved, remote: saved, remoteChanged: false, saving: false});
  const changed = {...dirty, text: 'Newer local edit'};
  assert.equal(acknowledgeNote(changed, dirty.text, saved).text, 'Newer local edit');
  assert.equal(acknowledgeNote(dirty, dirty.text, {note: '', updatedAt: null}).text, '');
});

test('a remote deletion observed before the save acknowledgement remains the latest snapshot', () => {
  const submitted = {...receiveNote(null, {note: 'Original', updatedAt: 10}), text: 'Submitted'};
  const deleted = receiveNote(submitted, {note: '', updatedAt: null});
  const acknowledged = acknowledgeNote(deleted, 'Submitted', {note: 'Submitted', updatedAt: 20});
  assert.equal(acknowledged.text, '');
  assert.equal(acknowledged.base.updatedAt, null);
  assert.equal(acknowledged.remote.updatedAt, null);
});

test('create then delete before acknowledgement is detected even when both absent versions are null', () => {
  const submitted = {...receiveNote(null, {note: '', updatedAt: null}), text: 'Submitted'};
  const created = receiveNote(submitted, {note: 'Submitted', updatedAt: 20});
  const deleted = receiveNote(created, {note: '', updatedAt: null});
  const acknowledged = acknowledgeNote(deleted, 'Submitted', {note: 'Submitted', updatedAt: 20});
  assert.equal(acknowledged.text, '');
  assert.equal(acknowledged.base.updatedAt, null);
});

test('resolving a conflict establishes a fresh base before the next save acknowledgement', () => {
  const dirty = {...receiveNote(null, {note: 'Original', updatedAt: 10}), text: 'Merged draft'};
  const conflicted = receiveNote(dirty, {note: 'Remote', updatedAt: 30});
  const resolved = {...conflicted, base: conflicted.remote, remoteChanged: false};
  const acknowledged = acknowledgeNote(resolved, 'Merged draft', {note: 'Merged draft', updatedAt: 40});
  assert.equal(acknowledged.text, 'Merged draft');
  assert.equal(acknowledged.base.updatedAt, 40);
});

test('a pending clear retains its request base when another device recreates the note before acknowledgement', () => {
  const pending = beginNoteSave(receiveNote(null, {note: 'Original', updatedAt: 10}));
  const deleted = receiveNote(pending, {note: '', updatedAt: null});
  const recreated = receiveNote(deleted, {note: 'Recreated remotely', updatedAt: 30});
  assert.equal(recreated.base.updatedAt, 10);
  assert.equal(recreated.remoteChanged, true);
  const acknowledged = acknowledgeNote(recreated, 'Original', {note: '', updatedAt: null});
  assert.equal(acknowledged.text, 'Recreated remotely');
  assert.equal(acknowledged.base.updatedAt, 30);
  assert.equal(acknowledged.saving, false);
});

test('a failed pending save preserves dirty text and exposes remote conflicts', () => {
  const dirty = {...receiveNote(null, {note: 'Original', updatedAt: 10}), text: 'Unsaved'};
  const pending = beginNoteSave(dirty);
  const recreated = receiveNote(pending, {note: 'Remote', updatedAt: 30});
  const failed = failNoteSave(recreated);
  assert.equal(failed.text, 'Unsaved');
  assert.equal(failed.saving, false);
  assert.equal(noteHasConflict(failed), true);
});

test('progress and resume use only article geometry and clamp page overscroll', () => {
  const article = {top: 200, height: 2800, viewportHeight: 800};
  assert.equal(readingProgress(article, 0), 0);
  assert.equal(readingProgress(article, 1200), 50);
  assert.equal(readingProgress(article, 2200), 100);
  assert.equal(readingProgress(article, 9000), 100);
  assert.equal(resumeScrollY(article, 50), 1200);
  assert.equal(resumeScrollY(article, 100), 2200);
  assert.equal(readingProgress({top: 1000, height: 200, viewportHeight: 800}, 0), 0);
  assert.equal(readingProgress({top: 1000, height: 200, viewportHeight: 800}, 400), 100);
});

function reporterHarness(overrides = {}) {
  const timers = new Map();
  const writes = [];
  let time = 0;
  let timerId = 0;
  const reporter = createProgressReporter({
    initialProgress: 40,
    save: async (value) => {writes.push(value); return value;},
    onSaved: () => {}, onError: () => {},
    now: () => time,
    schedule: (callback, delay) => {const id = ++timerId; timers.set(id, {callback, time: time + delay}); return id;},
    cancel: (id) => timers.delete(id),
    ...overrides,
  });
  return {reporter, timers, writes, async advance(ms) {
    time += ms;
    for (const [id, timer] of timers) {
      if (timer.time <= time) {timers.delete(id); timer.callback();}
    }
    await Promise.resolve();
    await Promise.resolve();
  }};
}

test('mount and flush do not overwrite remote progress; user advances coalesce over ten seconds', async () => {
  const {reporter, timers, writes, advance} = reporterHarness();
  await reporter.flush();
  reporter.observe(0);
  assert.equal(timers.size, 0);
  reporter.observe(45);
  reporter.observe(58);
  await advance(9999);
  assert.deepEqual(writes, []);
  await advance(1);
  assert.deepEqual(writes, [58]);
  reporter.observe(52);
  reporter.updateRemote(80);
  reporter.observe(75);
  await reporter.flush();
  assert.deepEqual(writes, [58]);
  reporter.dispose();
});

test('progress queues an advance during a pending save and cancels timers when unmounted', async () => {
  let resolveSave;
  const writes = [];
  const {reporter, timers, advance} = reporterHarness({save: (progress) => {
    writes.push(progress);
    return new Promise((resolve) => {resolveSave = resolve;});
  }});
  reporter.observe(50);
  await advance(10000);
  reporter.observe(70);
  assert.deepEqual(writes, [50]);
  resolveSave(50);
  await Promise.resolve();
  await advance(10000);
  assert.deepEqual(writes, [50, 70]);
  resolveSave(70);
  await Promise.resolve();
  reporter.observe(90);
  assert.equal(timers.size, 1);
  reporter.dispose();
  assert.equal(timers.size, 0);
});

test('failed progress keeps pending work for an explicit retry without an automatic retry loop', async () => {
  let attempts = 0;
  let errors = 0;
  const {reporter, timers, advance} = reporterHarness({save: async (progress) => {
    if (++attempts === 1) throw new Error('Offline');
    return progress;
  }, onError: () => {errors++;}});
  reporter.observe(60);
  await advance(10000);
  assert.equal(errors, 1);
  assert.equal(timers.size, 0);
  await reporter.flush();
  assert.equal(attempts, 2);
  reporter.dispose();
});
