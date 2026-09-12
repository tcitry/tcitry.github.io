import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle = await build({
  entryPoints: [new URL('../src/components/consultations/consultation-membership-note.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {consultationMembershipNote} = await import(
  'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64')
);

const ready = {ready: true};
const closed = {ready: false};
const pro = {configured: true, isPro: true};
const free = {configured: true, isPro: false};
const unconfigured = {configured: false, isPro: false};

test('consultation copy stays loading until the role and membership checks finish', () => {
  assert.equal(consultationMembershipNote(undefined, null, false, ''), '正在加载咨询…');
  assert.equal(consultationMembershipNote(closed, null, false, ''), '私人咨询尚未开放。');
  assert.equal(consultationMembershipNote(ready, null, true, ''), '正在核验会员状态…');
  assert.equal(consultationMembershipNote(ready, null, false, ''), '正在核验会员状态…');
  assert.equal(consultationMembershipNote(ready, pro, true, ''), '正在核验会员状态…');
});

test('a failed membership read is not treated as a free account', () => {
  assert.equal(consultationMembershipNote(ready, null, false, '会员状态暂时无法读取，请稍后重试。'), '');
  assert.equal(consultationMembershipNote(ready, free, false, '会员状态暂时无法读取，请稍后重试。'), '');
  assert.equal(consultationMembershipNote(ready, pro, true, '会员状态暂时无法读取，请稍后重试。'), '正在核验会员状态…');
});

test('Pro and free members keep the Pro-only consultation copy', () => {
  assert.equal(consultationMembershipNote(ready, unconfigured, false, ''), '私人咨询尚未开放。');
  assert.equal(consultationMembershipNote(ready, pro, false, ''), '等待博主回复。');
  assert.equal(consultationMembershipNote(ready, free, false, ''), '私人咨询仅 Pro 会员可用。已有记录始终可查看。');
});
