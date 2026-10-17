import {
  boxCorners, corners, cylinder, depthOf, fitProjection, haloOf, lineOnTop, sideSeam,
  slabOf, topMatrix, topTicks, type Plan, type Point3, type SolidPaths, type Tone,
} from './anatomy-iso-kit';

// Figure: a three-channel bench comparator. Each input socket carries its own
// ruled guide and sliding feeler. Equal normalized strings put the three
// feelers on the fixed datum; different strings occupy separate detents.
// The separate four-detent status indicator is driven by the same gate result.
export const WIDTH = 700;
export const HEIGHT = 340;
const BASE: Plan = {x: -179, y: -85, w: 358, d: 178, r: 8};
export const PROJECTION = fitProjection([
  ...boxCorners(BASE, -17, 0),
  ...boxCorners({x: 69, y: -64, w: 99, d: 110, r: 4}, 6, 21),
  ...boxCorners({x: -164, y: -67, w: 214, d: 118, r: 0}, 0, 13),
], WIDTH, HEIGHT, {pad: 14, azimuth: 68, elevation: 33});
export const SHADOW = haloOf(BASE, -17, 8, PROJECTION);
export type Motion = 'field0' | 'field1' | 'field2' | 'status';
export interface GatePart {
  name: string; paths: SolidPaths; center: Point3; key: number; tone: Tone;
  motion?: Motion;
  shape: {kind: 'slab'; plan: Plan; z: number; height: number; steps: number} | {kind: 'cylinder'; x: number; y: number; radius: number; z: number; height: number};
  lines: Array<{d: string; faint?: boolean; free?: boolean}>;
}
const parts: GatePart[] = [];
function slab(name: string, plan: Plan, z: number, height: number, tone: Tone = 'mid', motion?: Motion) {
  const center: Point3 = [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2];
  const part: GatePart = {name, paths: slabOf(plan, z, height, PROJECTION, 6, height >= 3 ? 0.5 : 0), center,
    key: depthOf(center, PROJECTION), tone, motion, shape: {kind: 'slab', plan, z, height, steps: 6}, lines: []};
  parts.push(part);return part;
}
function bolt(name: string, x: number, y: number, radius: number, z: number, height: number, motion?: Motion) {
  const center: Point3 = [x, y, z + height / 2];
  const part: GatePart = {name, paths: cylinder(x, y, radius, z, height, PROJECTION, 40), center,
    key: depthOf(center, PROJECTION), tone: 'mid', motion, shape: {kind: 'cylinder', x, y, radius, z, height}, lines: []};
  parts.push(part);return part;
}
for (const [i, [x, y]] of corners(BASE, 17).entries()) {
  bolt(`stand.rubber-${i}`, x, y, 6, -17, 3);
  bolt(`base.standoff-${i}`, x, y, 4.5, -14, 4);
}
const base = slab('base.plate', BASE, -10, 10, 'lo');
base.lines.push({d: sideSeam(BASE, -5, PROJECTION, 6), faint: true});
for (const [i, [x, y]] of corners(BASE, 9).entries()) bolt(`base.screw-${i}`, x, y, 1.5, 0, 0.7);
export const CHANNEL_Y = [-59, -13, 33] as const;
export const INPUT_PRINTS: Array<{name: string; transform: string}> = [];
for (const [i, y] of CHANNEL_Y.entries()) {
  const motion = `field${i}` as Motion;
  slab(`channel-${i}.socket`, {x: -164, y: y - 8, w: 80, d: 27, r: 2}, 0, 8);
  const screen = slab(`channel-${i}.input-window`, {x: -160, y: y - 4, w: 72, d: 17, r: 1}, 8, 0.6, 'hi');
  INPUT_PRINTS.push({name: screen.name, transform: topMatrix([-158, y - 1], 8.65, PROJECTION)});
  for (const [j, x] of [-159, -89].entries()) bolt(`channel-${i}.socket-bolt-${j}`, x, y + 16, 0.9, 8, 0.6);
  slab(`channel-${i}.guide`, {x: -76, y: y - 3, w: 126, d: 10, r: 1}, 0, 4);
  const rulerPlan = {x: -76, y: y + 10, w: 126, d: 5, r: 0.3};
  const ruler = slab(`channel-${i}.ruler`, rulerPlan, 0, 0.7, 'lo');
  const ticks = topTicks(-72, 46, 4, 5, y + 10, 0.72, [1.7, 3.8], PROJECTION);
  ruler.lines.push({d: ticks.minor, faint: true}, {d: ticks.major});
  for (const [j, x] of [-81, 50].entries()) {
    slab(`channel-${i}.end-stop-${j}`, {x, y: y - 5, w: 5, d: 14, r: 0.7}, 0, 7);
  }
  slab(`channel-${i}.carriage`, {x: -29, y: y - 3, w: 15, d: 10, r: 1}, 4, 5, 'hi', motion);
  slab(`channel-${i}.feeler`, {x: -24, y: y + 7, w: 3, d: 9, r: 0.3}, 0.7, 2.5, 'hi', motion);
  bolt(`channel-${i}.lock-neck`, -21.5, y + 2, 1.5, 9, 2, motion);
  bolt(`channel-${i}.lock-head`, -21.5, y + 2, 3.1, 11, 2, motion);
  slab(`channel-${i}.datum`, {x: -24, y: y + 15, w: 3, d: 3, r: 0}, 0, 0.7, 'hi');
}

// The status mechanism is physically separate: four positions report the
// decision after field agreement, SemVer parse and optional local-tag comparison.
for (const [i, [x, y]] of [[72, -60], [154, -60], [72, 32], [154, 32]].entries()) {
  slab(`meter.mount-${i}`, {x, y, w: 9, d: 9, r: 1}, 0, 6, 'lo');
}
slab('meter.housing', {x: 69, y: -64, w: 99, d: 110, r: 4}, 6, 9);
const window = slab('meter.window', {x: 75, y: -57, w: 87, d: 43, r: 2}, 15, 0.6, 'hi');
export const OUTPUT_PRINT = {name: window.name, transform: topMatrix([80, -51], 15.65, PROJECTION)};
const scale = slab('meter.detents', {x: 75, y: -3, w: 87, d: 12, r: 1}, 15, 0.7, 'lo');
scale.lines.push({d: [78, 102, 126, 150].map(x => lineOnTop([x, -3], [x, 9], 15.72, PROJECTION)).join('')});
slab('meter.runner', {x: 75, y: 12, w: 87, d: 6, r: 1}, 15, 2);
slab('meter.selector', {x: 75, y: 12, w: 6, d: 6, r: 0.7}, 17, 4, 'hi', 'status');
slab('meter.pointer', {x: 77, y: 4, w: 2, d: 8, r: 0.3}, 15.7, 1.3, 'hi', 'status');
const tagCard = slab('meter.tag-card', {x: 77, y: 24, w: 83, d: 15, r: 0.6}, 15, 0.5, 'mid');
export const TAG_PRINT = {name: tagCard.name, transform: topMatrix([80, 28], 15.55, PROJECTION)};
for (const [i, [x, y]] of [[73, -60], [164, -60], [73, 42], [164, 42]].entries()) bolt(`meter.screw-${i}`, x, y, 1.1, 15, 0.6);

// Filled by the Anatomy depth-order solver, from the exact shapes at all
// combinations of three field detents and four status detents. Values encode
// a topological painter order, not a guessed z bias.
const AUDITED_KEYS: Record<string, number> = {
  "stand.rubber-0": -131.89549096744844,
  "base.standoff-0": -129.50849670722968,
  "stand.rubber-1": 44.19906597300756,
  "base.standoff-1": 46.58606023322631,
  "stand.rubber-2": -61.42604596832717,
  "base.standoff-2": -59.03905170810843,
  "stand.rubber-3": 114.66851097212884,
  "base.standoff-3": 117.05550523234758,
  "base.plate": 117.07550523234758,
  "base.screw-0": 117.09550523234758,
  "base.screw-1": 117.09550523234758,
  "base.screw-2": 117.09550523234758,
  "base.screw-3": 133.74116789735348,
  "channel-0.socket": 117.09550523234758,
  "channel-0.input-window": 117.11550523234757,
  "channel-0.socket-bolt-0": 117.11550523234757,
  "channel-0.socket-bolt-1": 117.11550523234757,
  "channel-0.guide": 117.13550523234757,
  "channel-0.ruler": 117.09550523234758,
  "channel-0.end-stop-0": 117.11550523234757,
  "channel-0.end-stop-1": 117.15550523234756,
  "channel-0.carriage": 117.15550523234756,
  "channel-0.feeler": 117.15550523234756,
  "channel-0.lock-neck": 117.17550523234756,
  "channel-0.lock-head": 117.19550523234756,
  "channel-0.datum": 117.09550523234758,
  "channel-1.socket": 117.09550523234758,
  "channel-1.input-window": 117.11550523234757,
  "channel-1.socket-bolt-0": 117.11550523234757,
  "channel-1.socket-bolt-1": 117.11550523234757,
  "channel-1.guide": 117.13550523234757,
  "channel-1.ruler": 117.09550523234758,
  "channel-1.end-stop-0": 117.11550523234757,
  "channel-1.end-stop-1": 117.15550523234756,
  "channel-1.carriage": 117.15550523234756,
  "channel-1.feeler": 117.15550523234756,
  "channel-1.lock-neck": 117.17550523234756,
  "channel-1.lock-head": 117.19550523234756,
  "channel-1.datum": 117.09550523234758,
  "channel-2.socket": 117.09550523234758,
  "channel-2.input-window": 117.11550523234757,
  "channel-2.socket-bolt-0": 117.11550523234757,
  "channel-2.socket-bolt-1": 117.11550523234757,
  "channel-2.guide": 117.13550523234757,
  "channel-2.ruler": 117.09550523234758,
  "channel-2.end-stop-0": 117.11550523234757,
  "channel-2.end-stop-1": 117.15550523234756,
  "channel-2.carriage": 117.15550523234756,
  "channel-2.feeler": 117.15550523234756,
  "channel-2.lock-neck": 117.17550523234756,
  "channel-2.lock-head": 117.19550523234756,
  "channel-2.datum": 117.09550523234758,
  "meter.mount-0": 117.09550523234758,
  "meter.mount-1": 117.09550523234758,
  "meter.mount-2": 117.09550523234758,
  "meter.mount-3": 117.09550523234758,
  "meter.housing": 117.11550523234757,
  "meter.window": 117.13550523234757,
  "meter.detents": 117.13550523234757,
  "meter.runner": 139.79585499319566,
  "meter.selector": 139.81585499319567,
  "meter.pointer": 117.15550523234756,
  "meter.tag-card": 117.13550523234757,
  "meter.screw-0": 117.13550523234757,
  "meter.screw-1": 117.13550523234757,
  "meter.screw-2": 117.13550523234757,
  "meter.screw-3": 120.12244494183199
};
for (const part of parts) {
  const key = AUDITED_KEYS[part.name];
  if (!Number.isFinite(key)) throw new Error(`Missing audited depth for ${part.name}`);
  part.key = key!;
}
export const UNSORTED_PARTS = parts;
export const PARTS = parts.slice().sort((a, b) => a.key - b.key);
export const PART_COUNT = parts.length;
export const motionRange = (motion: Motion) => motion === 'status' ? 72 : 44;
