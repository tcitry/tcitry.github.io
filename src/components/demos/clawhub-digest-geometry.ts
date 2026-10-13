import {
  slabOf, fitProjection, boxCorners, depthOf, iso, onTop, planOutline,
  corners, topTicks, type Plan, type SolidPaths, type Point3, type Tone,
} from './anatomy-iso-kit';

export const DIGEST_WIDTH = 720;
export const DIGEST_HEIGHT = 410;
export const PRESS_STROKE = 27;
export type MachineAssembly = 'fixed' | 'press' | 'digest' | 'receipt' | 'candidate';
export interface MachinePart {
  name: string;
  plan: Plan;
  z: number;
  height: number;
  tone: Tone;
  assembly: MachineAssembly;
  key: number;
  paths: SolidPaths;
  lines: Array<{d: string; free?: boolean; faint?: boolean}>;
  dots: Array<[number, number]>;
}

const base = {x: -137, y: -52, w: 282, d: 144, r: 7};
export const DIGEST_PROJECTION = fitProjection([
  ...boxCorners(base, -17, 0), [-57, -31, 84], [27, -31, 84],
], DIGEST_WIDTH, DIGEST_HEIGHT, {pad: 28, elevation: 34, azimuth: 58});
const P = DIGEST_PROJECTION;
const parts: MachinePart[] = [];

function part(name: string, x: number, y: number, w: number, d: number, z: number, height: number,
  tone: Tone = 'mid', assembly: MachineAssembly = 'fixed', r = 0.8): MachinePart {
  const plan = {x, y, w, d, r};
  const item: MachinePart = {
    name, plan, z, height, tone, assembly,
    key: depthOf([x + w / 2, y + d / 2, z + height / 2], P),
    paths: slabOf(plan, z, height, P, 5, Math.min(0.5, height / 3)),
    lines: [], dots: [],
  };
  parts.push(item);
  return item;
}

function screws(item: MachinePart, inset = 2): void {
  item.dots.push(...corners(item.plan, inset).map(([x, y]) => iso([x, y, item.z + item.height], P)));
}
function insetOutline(item: MachinePart, inset = 1): void {
  item.lines.push({d: planOutline({
    x: item.plan.x + inset, y: item.plan.y + inset,
    w: item.plan.w - inset * 2, d: item.plan.d - inset * 2, r: Math.max(0, item.plan.r - inset),
  }, item.z + item.height, P), faint: true});
}

// Every item has a support and a purpose: no floating "architecture layers".
for (const [i, [x, y]] of corners(base, 19).entries()) part(`foot-${i}`, x - 6, y - 6, 12, 12, -17, 7, 'lo', 'fixed', 2);
const plate = part('bench-base', base.x, base.y, base.w, base.d, -10, 10, 'lo', 'fixed', base.r);
insetOutline(plate, 4);
screws(plate, 10);
const badge = part('engraved-plate', -124, 68, 33, 12, 0, 0.8, 'lo');
insetOutline(badge, 1.6);
badge.dots.push(iso([-121, 74, 0.8], P), iso([-94, 74, 0.8], P));
badge.lines.push(...[71, 74, 77].map((y, i) => ({d: onTop([[-117, y], [-100 + i * 2, y]], 0.8, P), free: true})));
const ruler = part('alignment-ruler', -62, 51, 94, 2.2, 0, 0.4, 'lo', 'fixed', 0.2);
const rulerTicks = topTicks(-58, 27, 4, 5, 51, 0.4, [2.2, 2.2], P);
ruler.lines.push({d: rulerTicks.minor, faint: true}, {d: rulerTicks.major});

// A narrow stock-paper hopper, fixed to the left side of the bench.
for (const [i, x] of [-122, -86].entries()) part(`stock-support-${i}`, x, -30, 9, 48, 0, 8, 'lo');
const stockFloor = part('stock-hopper-floor', -129, -39, 62, 66, 8, 2, 'mid');
screws(stockFloor, 4);
part('stock-hopper-back', -129, -39, 62, 2, 10, 15, 'mid');
part('stock-hopper-left', -129, -37, 2, 64, 10, 15, 'mid');
part('stock-hopper-right', -69, -37, 2, 64, 10, 15, 'mid');
part('stock-paper', -124, -31, 52, 48, 10, 0.7, 'hi');
part('stock-clamp-left', -126, -11, 2, 8, 10, 2, 'mid');
part('stock-clamp-right', -72, -11, 2, 8, 10, 2, 'mid');

// The press is mounted on two square posts; its carriage slides between guide jaws.
for (const [i, x] of [-56, 19].entries()) {
  const foot = part(`gantry-shoe-${i}`, x - 3, -35, 16, 19, 0, 4, 'mid');
  screws(foot, 2.5);
  const post = part(`gantry-post-${i}`, x, -31, 9, 9, 4, 70, 'mid');
  post.lines.push({d: onTop([[x + 2, -31], [x + 2, -22]], 74, P), faint: true});
}
const bridge = part('gantry-crossbeam', -56, -31, 84, 9, 74, 9, 'mid');
screws(bridge, 3);
for (const [i, x] of [-45, 13].entries()) {
  part(`guide-lower-mount-${i}`, x - 3, 7, 11, 13, 0, 10, 'mid');
  part(`vertical-guide-${i}`, x, 10, 5, 7, 10, 57, 'mid');
  part(`guide-top-bracket-${i}`, x - 3, -22, 11, 39, 67, 7, 'mid');
  // Three-sided guide bearings embrace a square rail without occupying its interior.
  part(`sliding-jaw-outer-${i}`, x - 5, 10, 5, 7, 40, 12, 'mid', 'press');
  part(`sliding-jaw-inner-${i}`, x + 5, 10, 5, 7, 40, 12, 'mid', 'press');
  const jawFront = part(`sliding-jaw-front-${i}`, x - 5, 17, 15, 3, 40, 12, 'mid', 'press');
  screws(jawFront, 0.8);
}
for (const [i, [x, y]] of [[-34, -2], [-1, -2], [-34, 16], [-1, 16]].entries()) {
  part(`work-bed-foot-${i}`, x, y, 6, 6, 0, 10, 'lo');
}
const bed = part('work-bed', -35, -5, 43, 29, 10, 4, 'hi');
screws(bed, 2);
part('candidate-paper', -30, -1, 34, 20, 14, 0.7, 'hi', 'candidate');
const head = part('press-carriage', -35, 0, 43, 17, 44, 6, 'hi', 'press');
screws(head, 3);
part('press-die', -32, 1, 37, 15, 41.7, 2.3, 'hi', 'press');
part('press-handle-neck', -19, -6, 12, 6, 44, 6, 'mid', 'press');
const handle = part('press-handle', -25, -11, 24, 5, 44, 6, 'mid', 'press');
for (let x = -22; x < -3; x += 3) {
  handle.lines.push({d: onTop([[x, -11], [x, -6]], 50, P), faint: true});
}

// Three field comparison feelers sit in a bolted block in front of the platen.
const comparator = part('field-comparator-block', -39, 29, 62, 16, 0, 6, 'mid');
screws(comparator, 3);
for (let i = 0; i < 3; i++) {
  const x = -32 + i * 18;
  part(`field-stop-${i}`, x, 31, 9, 3, 6, 3, 'mid');
  const latch = part(`field-feeler-${i}`, x + 2, 34, 5, 9, 6, 3, 'hi');
  latch.dots.push(iso([x + 4.5, 38, 9], P));
}

// Persistent materialized projection: an open drawer, with the paper on its floor.
for (const [i, x] of [67, 112].entries()) part(`digest-drawer-support-${i}`, x, -26, 10, 61, 0, 7, 'lo');
const digestFloor = part('digest-drawer-floor', 60, -31, 72, 72, 7, 2, 'mid');
screws(digestFloor, 3.5);
part('digest-drawer-back', 60, -31, 72, 3, 9, 13, 'mid');
part('digest-drawer-left', 60, -28, 3, 69, 9, 13, 'mid');
part('digest-drawer-right', 129, -28, 3, 69, 9, 13, 'mid');
part('digest-paper', 68, -22, 54, 52, 9, 0.7, 'hi', 'digest');
part('digest-drawer-front', 63, 38, 66, 3, 9, 7, 'mid');
for (const [i, x] of [84, 106].entries()) part(`digest-pull-standoff-${i}`, x, 41, 3, 4, 9, 3, 'mid');
const pull = part('digest-drawer-pull', 84, 45, 25, 3, 9, 3, 'mid');
pull.lines.push({d: onTop([[87, 45], [87, 48]], 12, P), faint: true});

// A detached one-shot receipt rests in its own shallow output tray.
for (const [i, x] of [-13, 63].entries()) part(`receipt-tray-support-${i}`, x, 59, 8, 25, 0, 3, 'lo');
part('receipt-tray-floor', -17, 55, 96, 31, 3, 2, 'mid');
part('receipt-tray-back', -17, 55, 96, 2, 5, 7, 'mid');
part('receipt-tray-left', -17, 57, 2, 29, 5, 7, 'mid');
part('receipt-tray-right', 77, 57, 2, 29, 5, 7, 'mid');
part('one-shot-receipt', -7, 59, 74, 21, 5, 0.7, 'hi', 'receipt');

// Anatomy ray-cast order, solved over rest and 24 intermediate press/receipt poses.
// Moving parts add their projected depth at runtime; no hand-tuned painter bias.
const AUDITED_ORDER: Record<string, number> = {
  "foot-0": -82.59031915,
  "stock-hopper-back": 99.209244,
  "stock-clamp-left": 99.249244,
  "stock-support-0": 99.169244,
  "stock-hopper-left": 99.229244,
  "stock-hopper-floor": 99.189244,
  "stock-paper": 99.269244,
  "gantry-shoe-0": 99.169244,
  "stock-support-1": 99.169244,
  "stock-clamp-right": 99.289244,
  "stock-hopper-right": 99.309244,
  "gantry-post-0": 99.189244,
  "work-bed-foot-0": 99.169244,
  "foot-2": -8.06556323,
  "guide-lower-mount-0": 99.169244,
  "gantry-shoe-1": 99.169244,
  "work-bed-foot-2": 99.189244,
  "work-bed-foot-1": 99.169244,
  "engraved-plate": 99.169244,
  "work-bed": 114.36745239,
  "candidate-paper": 114.38745239,
  "vertical-guide-0": 114.30745239,
  "bench-base": 99.149244,
  "gantry-post-1": 99.189244,
  "sliding-jaw-outer-0": 114.28745239,
  "press-handle": 114.26745239,
  "field-stop-0": 99.209244,
  "work-bed-foot-3": 99.169244,
  "press-handle-neck": 129.48566079,
  "sliding-jaw-inner-0": 129.42566079,
  "guide-top-bracket-0": 114.32745239,
  "guide-lower-mount-1": 99.189244,
  "gantry-crossbeam": 99.209244,
  "field-feeler-0": 99.229244,
  "sliding-jaw-front-0": 129.44566079,
  "field-stop-1": 99.189244,
  "press-die": 129.50566079,
  "field-comparator-block": 99.169244,
  "foot-1": 24.60448809,
  "press-carriage": 129.52566079,
  "field-feeler-1": 99.209244,
  "digest-drawer-back": 99.209244,
  "alignment-ruler": 99.169244,
  "field-stop-2": 99.189244,
  "field-feeler-2": 99.209244,
  "digest-drawer-support-0": 99.169244,
  "vertical-guide-1": 129.56566079,
  "sliding-jaw-outer-1": 129.54566079,
  "digest-drawer-left": 99.229244,
  "sliding-jaw-inner-1": 144.68386918,
  "guide-top-bracket-1": 129.58566079,
  "sliding-jaw-front-1": 144.70386918,
  "receipt-tray-support-0": 99.169244,
  "receipt-tray-left": 99.229244,
  "digest-paper": 99.209244,
  "digest-drawer-floor": 99.189244,
  "digest-drawer-support-1": 99.169244,
  "receipt-tray-back": 99.209244,
  "one-shot-receipt": 100.2638396,
  "receipt-tray-floor": 99.189244,
  "digest-drawer-right": 99.269244,
  "digest-pull-standoff-0": 99.269244,
  "digest-drawer-front": 99.249244,
  "receipt-tray-support-1": 99.169244,
  "digest-drawer-pull": 99.289244,
  "digest-pull-standoff-1": 99.269244,
  "receipt-tray-right": 99.229244,
  "foot-3": 99.129244
};
for (const item of parts) item.key = AUDITED_ORDER[item.name] ?? item.key;

export const DIGEST_PARTS = parts.sort((a, b) => a.key - b.key);
export const DIGEST_PART_COUNT = parts.length;
export const DIGEST_HALO = slabOf({...base, x: base.x + 1, y: base.y + 1, w: base.w - 2, d: base.d - 2}, -18, 1, P, 5).fill;

/** These short strokes represent printed fields, so their ends are intentionally free. */
export function paperFields(name: 'stock-paper' | 'candidate-paper' | 'digest-paper' | 'one-shot-receipt',
  fields: {displayName: 'Alpha' | 'Beta'; downloads: number; updatedAt: number}): string[] {
  const paper = parts.find(item => item.name === name)!;
  const {x, y, w, d} = paper.plan;
  const inset = Math.min(5, d / 5);
  const width = w - inset * 2;
  const lengths = [fields.displayName === 'Alpha' ? 0.64 : 0.88,
    0.2 + Math.min(fields.downloads, 30) / 30 * 0.72,
    0.3 + ((fields.updatedAt / 60_000) % 5) / 5 * 0.5];
  return lengths.map((share, index) => onTop([[x + inset, y + inset + index * (d - inset * 2) / 3],
    [x + inset + width * share, y + inset + index * (d - inset * 2) / 3]], paper.z + paper.height, P));
}

export const pressOffset = (share: number): Point3 => [0, 0, -PRESS_STROKE * share];
