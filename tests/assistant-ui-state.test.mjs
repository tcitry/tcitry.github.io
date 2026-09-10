import assert from 'node:assert/strict';
import test from 'node:test';
import {assistantUIState} from '../src/scripts/assistant-ui-state.mjs';

function storage() {
  const values = new Map();
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
}

test('the same public page restores only its chosen UI tab and explicit close clears it', () => {
  const session = storage();
  const state = assistantUIState(() => session, '/about/');
  assert.equal(state.restore(), undefined);
  state.save('consult');
  assert.deepEqual(JSON.parse([...session.values.values()][0]), {pathname: '/about/', view: 'consult'});
  assert.equal(assistantUIState(() => session, '/about/').restore(), 'consult');
  assert.equal(assistantUIState(() => session, '/posts/other/').restore(), undefined);
  assert.equal(state.restore(), undefined, 'Back must not restore a stale open record');
  state.clear();
  assert.equal(state.restore(), undefined);
  assert.equal(session.values.size, 0);
});

test('another browser tab does not inherit the current page open state', () => {
  const session = storage();
  const first = assistantUIState(() => session, '/about/');
  first.save('chat');
  assert.equal(first.restore(), 'chat');
  assert.equal(assistantUIState(() => storage(), '/about/').restore(), undefined);
  first.clear();
  assert.equal(first.restore(), undefined);
});

test('unknown tabs, malformed storage and blocked sessionStorage never reopen or break the panel', () => {
  const session = storage();
  const state = assistantUIState(() => session, '/about/');
  state.save('chat');
  const [key] = session.values.keys();
  for (const value of ['{', 'null', ...['private-message', 'bookmarks', 'likes'].map(view => JSON.stringify({pathname: '/about/', view}))]) {
    session.setItem(key, value);
    assert.equal(state.restore(), undefined);
  }
  const blocked = assistantUIState(() => { throw new Error('Storage blocked'); }, '/about/');
  assert.equal(blocked.restore(), undefined);
  assert.doesNotThrow(() => blocked.save('consult'));
  assert.doesNotThrow(() => blocked.clear());
});

test('the personal area, messages and author management store only a top-level tab name', () => {
  const session = storage();
  const state = assistantUIState(() => session, '/about/');
  for (const view of ['my', 'messages', 'admin']) {
    state.save(view);
    assert.equal(state.restore(), view);
    assert.deepEqual(JSON.parse([...session.values.values()][0]), {pathname: '/about/', view});
  }
  // Authorization is checked by the workspace/backend, not inferred from this record.
  state.clear();
  assert.equal(state.restore(), undefined);
});
