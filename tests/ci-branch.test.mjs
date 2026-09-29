import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCTION_BRANCH,
  assertPreviewWorkersBranch,
  assertProductionWorkersBranch,
  previewAliasFromBranch,
  resolveWorkersBranch,
} from '../scripts/ci-branch.mjs';

test('resolveWorkersBranch prefers Workers Builds CI variables', () => {
  assert.equal(resolveWorkersBranch({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feature/foo' }), 'feature/foo');
});

test('production Workers Builds commands only run on main', () => {
  assert.throws(() => assertProductionWorkersBranch({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feature/foo' }), /only run on main/);
  assert.doesNotThrow(() => assertProductionWorkersBranch({ WORKERS_CI: '1', WORKERS_CI_BRANCH: PRODUCTION_BRANCH }));
});

test('preview Workers Builds commands refuse main', () => {
  assert.throws(() => assertPreviewWorkersBranch({ WORKERS_CI: '1', WORKERS_CI_BRANCH: PRODUCTION_BRANCH }), /must not run on main/);
  assert.doesNotThrow(() => assertPreviewWorkersBranch({ WORKERS_CI: '1', WORKERS_CI_BRANCH: 'feature/foo' }));
});

test('preview aliases sanitize branch names for wrangler versions upload', () => {
  assert.equal(previewAliasFromBranch('cursor/preview-workers-builds-c00b'), 'cursor-preview-workers-builds-c00b');
  assert.equal(previewAliasFromBranch('DEV-584_preview'), 'dev-584-preview');
  assert.throws(() => previewAliasFromBranch('123-invalid'), /valid Workers preview alias/);
});
