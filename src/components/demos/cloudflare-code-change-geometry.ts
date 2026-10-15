import {
  boxCorners, depthOf, fitProjection, haloOf, sideMatrix, sideSeam, slabOf, topMatrix,
  translateAlong, type Plan, type Point3, type SolidPaths, type Tone,
} from './anatomy-iso-kit';

export const SPLICE_WIDTH = 680;
export const SPLICE_HEIGHT = 440;
const BASE: Plan = {x: -192, y: -114, w: 384, d: 238, r: 0};
export const SPLICE_PROJECTION = fitProjection([
  ...boxCorners(BASE, -16, 0),
  ...boxCorners({x: 52, y: -96, w: 60, d: 42, r: 0}, 0, 41),
], SPLICE_WIDTH, SPLICE_HEIGHT, {pad: 26, azimuth: 60, elevation: 38});
const P = SPLICE_PROJECTION;
export const SPLICE_HALO = haloOf(BASE, -16, 2, P);
export type SpliceFamily = 'fixed' | 'source' | 'output' | 'deleted' | 'inserted' | 'cutter';
export interface SplicePart {
  name: string; paths: SolidPaths; shape: {kind: 'slab'; plan: Plan; z: number; height: number; steps: number};
  center: Point3; key: number; tone: Tone; family: SpliceFamily;
  index?: number; print?: {transform: string; width: number; height: number};
  lines: Array<{d: string; faint?: boolean}>;
}
const parts: SplicePart[] = [];
function slab(name: string, plan: Plan, z: number, height: number, tone: Tone = 'mid', family: SpliceFamily = 'fixed') {
  const center: Point3 = [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2];
  const part: SplicePart = {
    name, paths: slabOf(plan, z, height, P, 0, height >= 3 ? 0.35 : 0),
    shape: {kind: 'slab', plan, z, height, steps: 0},
    center, key: depthOf(center, P), tone, family, lines: [],
  };
  parts.push(part);
  return part;
}

// Figure / 80 supported rectangular solids. No round bodies, tubes or free connector lines.
// Four feet + a seamed base + two square bolt heads; two type rails with beds, edge guides
// and end stops; 19 source and 20 result type blocks; two three-sided material trays;
// two scrap blocks and three replacement blocks; a seven-part cutter with two blades;
// four engraved plates. Empty block slots remain visible, never inventing text characters.
for (const [index, [x, y]] of [[-174, -96], [160, -96], [-174, 100], [160, 100]].entries()) {
  slab(`base.foot-${index}`, {x, y, w: 14, d: 14, r: 0}, -16, 6, 'lo');
}
const base = slab('base.plate', BASE, -10, 10, 'lo');
base.lines.push({d: sideSeam(BASE, -5, P, 0), faint: true});
for (const [index, x] of [-179, 176].entries()) slab(`base.bolt-${index}`, {x, y: 110, w: 3, d: 3, r: 0}, 0, 1, 'hi');

function rail(family: 'source' | 'output', y: number) {
  const slots = family === 'output' ? 20 : 19;
  const width = slots * 16 + 8;
  slab(`${family}.bed`, {x: -170, y: y - 4, w: width, d: 32, r: 0}, 0, 3, 'lo');
  for (const [index, guideY] of [y - 6, y + 28].entries()) slab(`${family}.guide-${index}`, {x: -170, y: guideY, w: width, d: 2, r: 0}, 0, 8, 'mid');
  for (const [index, x] of [-174, -170 + width].entries()) slab(`${family}.end-stop-${index}`, {x, y: y - 6, w: 4, d: 36, r: 0}, 0, 8, 'mid');
  for (let index = 0; index < slots; index++) {
    const x = -166 + index * 16;
    const tile = slab(`${family}.unit-${index}`, {x, y, w: 14.6, d: 24, r: 0}, 3, 20, 'hi', family);
    tile.index = index;
    // Glyphs sit on the front face, inside a 14.6 × 20 type-block face.
    tile.print = {transform: sideMatrix([x, y + 24.04], 23, P, 'left'), width: 14.6, height: 20};
  }
}
rail('source', -84);
rail('output', 62);

function tray(name: 'deleted' | 'inserted', x: number, width: number, slots: number) {
  slab(`${name}.floor`, {x, y: -12, w: width, d: 38, r: 0}, 0, 3, 'lo');
  slab(`${name}.back`, {x, y: -14, w: width, d: 2, r: 0}, 0, 8);
  slab(`${name}.left`, {x: x - 2, y: -14, w: 2, d: 40, r: 0}, 0, 8);
  slab(`${name}.right`, {x: x + width, y: -14, w: 2, d: 40, r: 0}, 0, 8);
  for (let index = 0; index < slots; index++) {
    const tileX = x + 6 + index * 18;
    const tile = slab(`${name}.unit-${index}`, {x: tileX, y: -8, w: 14.6, d: 24, r: 0}, 3, 20, 'hi', name);
    tile.index = index;
    tile.print = {transform: sideMatrix([tileX, 16.04], 23, P, 'left'), width: 14.6, height: 20};
  }
}
tray('deleted', -150, 58, 2);
tray('inserted', -56, 72, 3);

// The cutter's two blades touch the type-block top at the prefix and suffix boundaries.
// Regeneration translates this entire supported assembly by one UTF-16 cell, without animation.
for (const [index, x] of [52, 90].entries()) slab(`cutter.post-${index}`, {x, y: -96, w: 6, d: 6, r: 0}, 0, 37, 'mid', 'cutter');
slab('cutter.bridge', {x: 52, y: -96, w: 44, d: 6, r: 0}, 37, 4, 'mid', 'cutter');
for (const [index, x] of [57, 89].entries()) {
  slab(`cutter.arm-${index}`, {x, y: -90, w: 2, d: 30, r: 0}, 34, 3, 'mid', 'cutter');
  slab(`cutter.blade-${index}`, {x: x + 0.5, y: -84, w: 1, d: 24, r: 0}, 23, 11, 'hi', 'cutter');
}

export const SPLICE_LABELS = [
  {name: 'plate.source', x: -168, y: -110, w: 104, text: 'BEFORE'},
  {name: 'plate.deleted', x: -150, y: 30, w: 58, text: 'CUT'},
  {name: 'plate.inserted', x: -56, y: 30, w: 72, text: 'INSERT'},
  {name: 'plate.output', x: -168, y: 102, w: 104, text: 'AFTER'},
].map(label => {
  const part = slab(label.name, {x: label.x, y: label.y, w: label.w, d: 12, r: 0}, 0, 0.7, 'lo');
  return {...label, partName: part.name, transform: topMatrix([label.x + 5, label.y + 3], 0.74, P)};
});

// Painter keys settled from the exact slab volumes at both prefix positions (14 and 15).
// 300 overlap constraints, no dropped rules or cycles. Recompute after changing any geometry.
const SETTLED_KEYS: Record<string, number> = {
  "base.foot-0": -134.53941957140282,
  "base.foot-1": -2.941623719080222,
  "base.foot-2": -0.7817026799695519,
  "base.foot-3": 130.81609317235305,
  "base.plate": 130.83609317235306,
  "base.bolt-0": 130.85609317235307,
  "base.bolt-1": 146.33554753553904,
  "source.bed": 137.20017920120685,
  "source.guide-0": 137.18017920120684,
  "source.guide-1": 137.60017920120706,
  "source.end-stop-0": 130.85609317235307,
  "source.end-stop-1": 137.62017920120707,
  "source.unit-0": 137.22017920120686,
  "source.unit-1": 137.24017920120687,
  "source.unit-2": 137.26017920120688,
  "source.unit-3": 137.2801792012069,
  "source.unit-4": 137.3001792012069,
  "source.unit-5": 137.3201792012069,
  "source.unit-6": 137.34017920120692,
  "source.unit-7": 137.36017920120693,
  "source.unit-8": 137.38017920120694,
  "source.unit-9": 137.40017920120695,
  "source.unit-10": 137.42017920120696,
  "source.unit-11": 137.44017920120697,
  "source.unit-12": 137.46017920120698,
  "source.unit-13": 137.480179201207,
  "source.unit-14": 137.500179201207,
  "source.unit-15": 137.52017920120701,
  "source.unit-16": 137.54017920120702,
  "source.unit-17": 137.56017920120703,
  "source.unit-18": 137.58017920120705,
  "output.bed": 130.87609317235308,
  "output.guide-0": 130.85609317235307,
  "output.guide-1": 131.23609317235326,
  "output.end-stop-0": 130.85609317235307,
  "output.end-stop-1": 131.25609317235327,
  "output.unit-0": 130.8960931723531,
  "output.unit-1": 130.9160931723531,
  "output.unit-2": 130.9360931723531,
  "output.unit-3": 130.95609317235312,
  "output.unit-4": 130.97609317235313,
  "output.unit-5": 130.99609317235314,
  "output.unit-6": 131.01609317235315,
  "output.unit-7": 131.03609317235316,
  "output.unit-8": 131.05609317235317,
  "output.unit-9": 131.07609317235318,
  "output.unit-10": 131.0960931723532,
  "output.unit-11": 131.1160931723532,
  "output.unit-12": 131.1360931723532,
  "output.unit-13": 131.15609317235322,
  "output.unit-14": 131.17609317235323,
  "output.unit-15": 131.19609317235324,
  "output.unit-16": 131.21609317235325,
  "output.unit-17": 131.23609317235326,
  "output.unit-18": 131.25609317235327,
  "output.unit-19": 131.27609317235328,
  "deleted.floor": 130.87609317235308,
  "deleted.back": 130.85609317235307,
  "deleted.left": 130.85609317235307,
  "deleted.right": 130.8960931723531,
  "deleted.unit-0": 130.8960931723531,
  "deleted.unit-1": 130.9160931723531,
  "inserted.floor": 130.8960931723531,
  "inserted.back": 130.87609317235308,
  "inserted.left": 130.85609317235307,
  "inserted.right": 130.9160931723531,
  "inserted.unit-0": 130.9160931723531,
  "inserted.unit-1": 130.9360931723531,
  "inserted.unit-2": 130.95609317235312,
  "cutter.post-0": 130.85609317235307,
  "cutter.post-1": 130.85609317235307,
  "cutter.bridge": 130.87609317235308,
  "cutter.arm-0": 137.52017920120701,
  "cutter.blade-0": 137.500179201207,
  "cutter.arm-1": 137.56017920120703,
  "cutter.blade-1": 137.54017920120702,
  "plate.source": 130.85609317235307,
  "plate.deleted": 130.85609317235307,
  "plate.inserted": 130.85609317235307,
  "plate.output": 130.85609317235307
};
for (const part of parts) part.key = SETTLED_KEYS[part.name]!;

export const SPLICE_PARTS = parts;
export const SPLICE_PART_COUNT = parts.length;
export function cutterOffset(prefix: 14 | 15): Point3 {return [(prefix - 14) * 16, 0, 0];}
export function splicePartOrder(prefix: 14 | 15) {
  const offset = cutterOffset(prefix);
  const delta = depthOf(offset, P);
  // A shared depth offset on the cutter keeps every part in the same assembly.
  // All slabs also record exact volumes for downstream overlap and support checks.
  return parts.slice().sort((a, b) => a.key + (a.family === 'cutter' ? delta : 0)
    - b.key - (b.family === 'cutter' ? delta : 0));
}
export const cutterTransform = (prefix: 14 | 15) => translateAlong(P, cutterOffset(prefix));
