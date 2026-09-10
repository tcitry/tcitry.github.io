/**
 * Teaching adaptation of Lieflat Charts L14 Hundred Field by 躺在废墟里.
 * Source commit: eace082a317b696c5570c25826a53a7fa113e984.
 * Template-derived geometry: PolyForm Noncommercial License 1.0.0.
 * https://polyformproject.org/licenses/noncommercial/1.0.0/
 */
const random = (i: number, k: number) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;
const polar = (cx: number, cy: number, radius: number, angle: number) => {
  const radians = angle * Math.PI / 180;
  return {x: cx + Math.cos(radians) * radius, y: cy + Math.sin(radians) * radius};
};
const integer = (value: number, minimum: number, maximum: number) => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`Expected an integer from ${minimum} to ${maximum}`);
};

export const HUNDRED_DEFAULTS = [41, 35, 12];

export function buildHundredField(first: number[]) {
  if (first.length !== 3) throw new RangeError('Three explicit shares are required');
  first.forEach(value => integer(value, 0, 100));
  const remainder = 100 - first.reduce((sum, value) => sum + value, 0);
  if (remainder < 0) throw new RangeError('Composition cannot exceed 100%');
  const shares = [...first, remainder];
  const names = ['已完成', '进行中', '待开始', '已取消'];
  const shades = ['#1C1C1A', '#55554F', '#8F8E88', '#B0AFA9'];
  const centers = [[91, 67], [269, 67], [91, 192], [269, 192]];
  const clusters = shares.map((value, i) => {
    const [cx, cy] = centers[i];
    let edge = 0;
    const dots = Array.from({length: value}, (_, k) => {
      const radius = 4 + Math.sqrt(k) * 4.3 + random(k + 1, i + 2) * 2;
      edge = Math.max(edge, radius);
      return {...polar(cx, cy, radius, k * 137.508 + i * 55), radius: 1.5 + random(k + 2, i + 3) * 1.3, spoke: k % 5 === 0, delay: i * 140 + k * 12};
    });
    return {name: names[i], value, shade: shades[i], cx, cy, dots, labelY: cy + Math.max(edge, 13) + 22};
  });
  const maximum = Math.max(...shares);
  const leaders = clusters.filter(cluster => cluster.value === maximum).map(cluster => cluster.name);
  return {unit: 'percentage-point' as const, total: 100, clusters, leaders, maximum};
}
