/** Teaching-data adaptation of Lieflat Charts F2/F12 by 躺在废墟里.
 * PolyForm Noncommercial 1.0.0: https://polyformproject.org/licenses/noncommercial/1.0.0/
 * https://github.com/larashero3-dotcom/lieflat-charts/tree/eace082a317b696c5570c25826a53a7fa113e984
 */
export const TREND_SOURCE = 'https://github.com/larashero3-dotcom/lieflat-charts/blob/eace082a317b696c5570c25826a53a7fa113e984/templates/basics-gallery.html';
export const trendRnd = (i: number, k: number) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;
function inRange(value: number, min: number, max: number, integer = true) {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error('Value is outside the teaching example range.');
}

export function makeLineData(start: number, change: number, extra: number) {
  inRange(start, 0, 40); inRange(change, -2, 3); inRange(extra, 0, 30);
  const values = Array.from({length: 14}, (_, day) => Math.max(0, start + change * day + (day === 7 ? extra : 0)));
  const maximum = Math.max(...values);
  const highlighted: number[] = [];
  if (maximum > 0) for (const day of values.map((_, i) => i).sort((a, b) => values[b] - values[a])) {
    if (highlighted.every(other => Math.abs(other - day) >= 4)) highlighted.push(day);
    if (highlighted.length === 2) break;
  }
  return {values, maximum, highlighted, scale: Math.max(10, Math.ceil(maximum / 10) * 10), first: values[0], last: values[13]};
}

export function makeDumbbellData(after: readonly number[]) {
  if (after.length !== 3) throw new Error('Three after-values are required.');
  after.forEach(value => inRange(value, 0, 40));
  const before = [12, 18, 24];
  const names = ['邀请流程', '导入数据', '发布检查'];
  return before.map((was, i) => ({name: names[i], before: was, after: after[i], saved: was - after[i], beads: Math.abs(was - after[i])}));
}
