import test from 'node:test';
import assert from 'node:assert/strict';
import {GATE_SCENARIOS, parseVersion, releaseGate, type GateStatus} from './waza-release-gate-model.ts';

// Oracle: unmodified upstream release_gate.py at 2585ee0f46bcefd9adb1b8f5d4ce19184a4d2929.
// On 2026-10-17 these fixtures were run through real VERSION / package.json /
// Cargo.toml files in a resolved temporary root, then version_sync(root, tag).
// The CLI was also run with invalid SemVer: evidence FAIL, process exit 0.
const ORACLE: Record<string, [GateStatus, string | null]> = {
  parity: ['PASS', '3.40.0'], mismatch: ['FAIL', null], behind: ['FAIL', '3.39.0'],
  ahead: ['PASS', '3.41.0'], prerelease: ['WARN', '3.41.0-rc.1'],
  'prerelease-behind': ['FAIL', '3.40.0-rc.1'], 'build-mismatch': ['FAIL', null],
  'build-parity': ['PASS', '3.40.0+ci.1'], 'no-tag': ['PASS', '3.40.0'],
  invalid: ['FAIL', '3.40'], empty: ['N/A', null],
};
test('every exposed scenario matches the real Python evidence and return value', () => {
  for (const scenario of GATE_SCENARIOS) {
    const state = releaseGate(scenario.input);
    assert.deepEqual([state.status, state.manifest], ORACLE[scenario.id], scenario.id);
  }
});
test('missing fields do not introduce a mismatch, and no fields is N/A', () => {
  const state = releaseGate({versions: [null, '3.40.0', null], tag: 'v3.40.0'});
  assert.deepEqual([state.status, state.manifest], ['PASS', '3.40.0']);
  assert.equal(state.fields[0]!.normalized, null);
});
test('field equality retains build metadata but tag parity drops it', () => {
  const mismatch = releaseGate(GATE_SCENARIOS.find(s => s.id === 'build-mismatch')!.input);
  assert.equal(mismatch.agreement, false);
  assert.deepEqual(mismatch.fieldPositions, [0, 22, 0]);
  const parity = releaseGate(GATE_SCENARIOS.find(s => s.id === 'build-parity')!.input);
  assert.equal(parity.comparison, 'same');
  assert.deepEqual(parity.parsed, {core: ['3', '40', '0'], prerelease: null, build: 'ci.1'});
});
test('prerelease validation rejects numeric leading zeros; large core numbers stay exact', () => {
  assert.equal(parseVersion('3.40.0-rc.01'), null);
  assert.equal(parseVersion('03.40.0'), null);
  assert.equal(parseVersion('vv3.40.0'), null);
  assert.deepEqual(parseVersion('V3.40.0-rc.1+ci.2'), {core: ['3', '40', '0'], prerelease: 'rc.1', build: 'ci.2'});
  const large = '9007199254740993.0.0';
  assert.equal(releaseGate({versions: [large, large, large], tag: 'v9007199254740992.0.0'}).comparison, 'ahead');
});
