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
  state.save('membership');
  assert.deepEqual(JSON.parse([...session.values.values()][0]), {pathname: '/about/', view: 'membership'});
  assert.equal(assistantUIState(() => session, '/about/').restore(), 'membership');
  assert.equal(assistantUIState(() => session, '/posts/other/').restore(), undefined);
  state.clear();
  assert.equal(state.restore(), undefined);
  assert.equal(session.values.size, 0);
});

test('unknown tabs, malformed storage and blocked sessionStorage never reopen or break the panel', () => {
  const session = storage();
  const state = assistantUIState(() => session, '/about/');
  state.save('chat');
  const [key] = session.values.keys();
  for (const value of ['{', 'null', JSON.stringify({pathname: '/about/', view: 'private-message'})]) {
    session.setItem(key, value);
    assert.equal(state.restore(), undefined);
  }
  const blocked = assistantUIState(() => { throw new Error('Storage blocked'); }, '/about/');
  assert.equal(blocked.restore(), undefined);
  assert.doesNotThrow(() => blocked.save('consult'));
  assert.doesNotThrow(() => blocked.clear());
});
