import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearAnnotationDraft,
  drainAnnotationSaves,
  enqueueAnnotationSave,
  readAnnotationDraft,
  resetAnnotationSaveState,
  saveAnnotationDraft,
  takeStoredMark,
} from '../src/scripts/annotation-draft.mjs';

function storage() {
  const values = new Map();
  return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
}

const draft = {
  type: 'highlight', pathname: '/docs/vite/', title: 'Vite+', quote: '统一入口', prefix: 'Web ', suffix: '。', fresh: true,
};

test('draft storage keeps a selection and drops malformed records', () => {
  resetAnnotationSaveState();
  const session = storage();
  assert.equal(readAnnotationDraft(session), null);
  assert.equal(saveAnnotationDraft(session, draft), true);
  assert.equal(readAnnotationDraft(session)?.type, 'highlight');
  assert.equal(readAnnotationDraft(session)?.fresh, true);
  session.setItem('blog-annotation-draft', '{');
  assert.equal(readAnnotationDraft(session), null);
  assert.equal(saveAnnotationDraft(session, {...draft, quote: ''}), false);
  clearAnnotationDraft(session);
  assert.equal(readAnnotationDraft(session), null);
});

test('underline and highlight queue for sync, notes stay out of that queue', () => {
  resetAnnotationSaveState();
  const session = storage();
  assert.equal(enqueueAnnotationSave(draft), true);
  assert.equal(enqueueAnnotationSave({...draft, type: 'note'}), false);
  assert.deepEqual(drainAnnotationSaves().map(item => item.type), ['highlight']);
  assert.deepEqual(drainAnnotationSaves(), []);
  saveAnnotationDraft(session, draft);
  assert.equal(takeStoredMark(session)?.quote, '统一入口');
  assert.equal(takeStoredMark(session), null);
  saveAnnotationDraft(session, {...draft, type: 'note'});
  resetAnnotationSaveState();
  assert.equal(takeStoredMark(session), null);
  assert.equal(readAnnotationDraft(session)?.type, 'note');
});
