/** Teaching slice of tw93/waza 2585ee0, release_gate.py::version_sync.
 * Inputs are already collected, safe ASCII version strings, in collection order.
 * Filesystem safety, JSON/TOML parsing and Git tag selection stay outside this model.
 */
export const WAZA_SOURCE = 'https://github.com/tw93/waza/blob/2585ee0f46bcefd9adb1b8f5d4ce19184a4d2929/skills/check/scripts/release_gate.py';
export const FIELD_NAMES = ['VERSION', 'package.json', 'Cargo.toml'] as const;
export type Versions = [string | null, string | null, string | null];
export interface GateInput {versions: Versions; tag: string | null}
export type GateStatus = 'PASS' | 'WARN' | 'FAIL' | 'N/A';
export interface ParsedVersion {core: [string, string, string]; prerelease: string | null; build: string | null}
export function parseVersion(value: string): ParsedVersion | null {
  const match = /^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value.trim());
  if (!match || match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0'))) return null;
  return {core: [match[1]!, match[2]!, match[3]!], prerelease: match[4] ?? null, build: match[5] ?? null};
}
export const stripPrefix = (value: string) => /^[vV]/.test(value) ? value.slice(1) : value;
function compareCore(a: ParsedVersion, b: ParsedVersion) {
  for (let i = 0; i < 3; i++) {
    const left = BigInt(a.core[i]!);const right = BigInt(b.core[i]!);
    if (left !== right) return left > right ? 1 : -1;
  }
  return 0;
}
export function releaseGate(input: GateInput) {
  const fields = FIELD_NAMES.map((name, index) => {
    const raw = input.versions[index]!;
    return {name, raw, normalized: raw === null ? null : stripPrefix(raw), parsed: raw === null ? null : parseVersion(raw)};
  });
  const present = fields.filter(field => field.raw !== null);
  const unique = [...new Set(present.map(field => field.normalized!))];
  const agreement = unique.length === 1;
  const manifest = agreement ? unique[0]! : null;
  const parsed = agreement ? present[0]!.parsed : null;
  let status: GateStatus = present.length ? 'PASS' : 'N/A';
  const reasons: string[] = [];
  let comparison: 'none' | 'blocked' | 'same' | 'behind' | 'ahead' = 'none';
  if (!present.length) reasons.push('没有收集到版本字段。');
  if (unique.length > 1) {status = 'FAIL';reasons.push('去掉一个 v/V 前缀后，字段仍不一致；不会选出单一 manifest。');comparison = 'blocked';}
  if (manifest && !parsed) {status = 'FAIL';reasons.push('单一 manifest 不是脚本认可的精确 SemVer。');comparison = 'blocked';}
  if (present.some(field => field.raw!.length > 128 || /[\x00-\x1f\x7f]/.test(field.raw!))) {
    status = 'FAIL';reasons.push('字段含控制字符或超过 128 字符。');
  }
  if (parsed?.prerelease) {
    reasons.push('manifest 是 prerelease；不能当作稳定版本与 Tag 持平。');
    if (status === 'PASS') status = 'WARN';
  }
  const parsedTag = input.tag ? parseVersion(input.tag) : null;
  if (parsed && parsedTag) {
    const coreOrder = compareCore(parsed, parsedTag);
    if (!coreOrder && parsed.prerelease === parsedTag.prerelease) {
      comparison = 'same';reasons.push('core 与 prerelease 和稳定 Tag 相同；这一比较忽略 build metadata。');
    } else if (coreOrder < 0 || (!coreOrder && parsed.prerelease !== null && parsedTag.prerelease === null)) {
      comparison = 'behind';status = 'FAIL';reasons.push('manifest 落后于可达稳定 Tag，版本发生回退。');
    } else if (coreOrder > 0) {
      comparison = 'ahead';reasons.push('manifest 高于稳定 Tag：允许表示正在准备的未发布版本。');
    }
  } else if (parsed && !input.tag) reasons.push('没有稳定 Tag；version_sync 不因此提高状态级别。');
  const fieldPositions = fields.map(field => field.normalized === null ? 0 : unique.indexOf(field.normalized) * 22);
  const statusPosition = {'N/A': 0, PASS: 24, WARN: 48, FAIL: 72}[status];
  return {fields, agreement, manifest, parsed, status, reasons, comparison, fieldPositions, statusPosition};
}
const same = (value: string): Versions => [value, value, value];
export const GATE_SCENARIOS: ReadonlyArray<{id: string; name: string; input: GateInput}> = [
  {id: 'parity', name: '前缀不同，版本相同', input: {versions: ['v3.40.0', '3.40.0', 'V3.40.0'], tag: 'v3.40.0'}},
  {id: 'mismatch', name: '一个字段漏升版', input: {versions: ['3.40.0', '3.39.0', '3.40.0'], tag: 'v3.40.0'}},
  {id: 'behind', name: '字段统一，但版本回退', input: {versions: same('3.39.0'), tag: 'v3.40.0'}},
  {id: 'ahead', name: '准备下一稳定版', input: {versions: same('3.41.0'), tag: 'v3.40.0'}},
  {id: 'prerelease', name: '准备下一预发布版', input: {versions: same('3.41.0-rc.1'), tag: 'v3.40.0'}},
  {id: 'prerelease-behind', name: '同 core 的预发布版回退', input: {versions: same('3.40.0-rc.1'), tag: 'v3.40.0'}},
  {id: 'build-mismatch', name: '只有 build 不同', input: {versions: ['3.40.0+ci.1', '3.40.0+ci.2', '3.40.0+ci.1'], tag: 'v3.40.0'}},
  {id: 'build-parity', name: 'build 一致，再比 Tag', input: {versions: same('3.40.0+ci.1'), tag: 'v3.40.0'}},
  {id: 'no-tag', name: '没有稳定可达 Tag', input: {versions: same('3.40.0'), tag: null}},
  {id: 'invalid', name: '无效 SemVer', input: {versions: same('3.40'), tag: 'v3.40.0'}},
  {id: 'empty', name: '没有版本字段', input: {versions: [null, null, null], tag: null}},
];
export const INITIAL_GATE: GateInput = GATE_SCENARIOS[0]!.input;
export const VERSION_OPTIONS = [null, 'v3.40.0', 'V3.40.0', '3.39.0', '3.40.0', '3.41.0', '3.40.0-rc.1', '3.41.0-rc.1', '3.40.0+ci.1', '3.40.0+ci.2', '3.40', '3.40.0-rc.01'] as const;
