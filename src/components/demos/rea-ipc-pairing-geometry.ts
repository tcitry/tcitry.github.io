import {boxCorners, depthOf, fitProjection, haloOf, iso, pathOf, sideSeam, slabOf, topMatrix, translateAlong, type Plan, type Point3, type SolidPaths} from './anatomy-iso-kit';

export const REA_MACHINE_WIDTH = 650;
export const REA_MACHINE_HEIGHT = 320;
const basePlan: Plan = {x: -180, y: -85, w: 350, d: 170, r: 6};
export const REA_MACHINE_PROJECTION = fitProjection([
  ...boxCorners(basePlan, -15, 1),
  ...boxCorners({x: -85, y: -73, w: 95, d: 146, r: 0}, 1, 61),
], REA_MACHINE_WIDTH, REA_MACHINE_HEIGHT, {pad: 20, azimuth: 65, elevation: 47});
export const REA_MACHINE_SHADOW = haloOf(basePlan, -15, 1, REA_MACHINE_PROJECTION);
export const REA_LANES = [-44, 0, 44] as const;
export interface ReaMachinePart {
  name: string;
  paths: SolidPaths;
  center: Point3;
  depth: number;
  layer: 'base' | 'mechanism';
  seam?: string;
}
const parts: ReaMachinePart[] = [];
function slab(name: string, plan: Plan, z: number, height: number, layer: ReaMachinePart['layer'] = 'mechanism') {
  const center: Point3 = [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2];
  const part = {name, paths: slabOf(plan, z, height, REA_MACHINE_PROJECTION, 6, Math.min(0.45, height / 8)), center, depth: depthOf(center, REA_MACHINE_PROJECTION), layer};
  parts.push(part); return part;
}

// Figure: 70 purposeful solids including its three travelling tokens.
// Base: four feet, plate, four captive bolts (9). Three guide lanes: two rails
// and two end stops each (12). Two inspection gates: plinths, uprights, bridge,
// attachment blocks, guide sleeves, stems and lifting blades (32). Three tokens and
// their two key strips (9). Output bin: backing, three stops, tally strip,
// coupling latch and receiver (7). Engraved maker plate (1).
for (const [i, [x, y]] of [[-165, -68], [154, -68], [-165, 68], [154, 68]].entries()) {
  slab(`foot-${i}`, {x: x! - 6, y: y! - 6, w: 12, d: 12, r: 2}, -15, 5, 'base');
}
const base = slab('milled-base', basePlan, -10, 10, 'base') as ReaMachinePart;
base.seam = sideSeam(basePlan, -5, REA_MACHINE_PROJECTION, 6);
for (const [i, [x, y]] of [[-168, -72], [157, -72], [-168, 72], [157, 72]].entries()) slab(`captive-bolt-${i}`, {x: x! - 2, y: y! - 2, w: 4, d: 4, r: 0.5}, 0, 1, 'base');
for (const [i, y] of REA_LANES.entries()) {
  for (const [j, offset] of [-13, 13].entries()) slab(`lane-${i}-rail-${j}`, {x: -160, y: y + offset - 1.2, w: 314, d: 2.4, r: 0.8}, 0, 8, 'base');
  for (const [j, x] of [-161, 153].entries()) slab(`lane-${i}-end-stop-${j}`, {x, y: y - 14.5, w: 3, d: 29, r: 0.5}, 0, 9, 'base');
}
for (const [gateIndex, x] of [-78, 7].entries()) {
  for (const [side, y] of [-71, 71].entries()) {
    slab(`gate-${gateIndex}-plinth-${side}`, {x: x - 9, y: y - 8, w: 18, d: 16, r: 1}, 0, 4);
    slab(`gate-${gateIndex}-upright-${side}`, {x: x - 3, y: y - 3, w: 6, d: 6, r: 0.5}, 4, 50);
    slab(`gate-${gateIndex}-attachment-${side}`, {x: x - 5, y: y - 5, w: 10, d: 10, r: 1}, 54, 4);
  }
  slab(`gate-${gateIndex}-bridge`, {x: x - 4, y: -74, w: 8, d: 148, r: 1}, 58, 3);
  for (const [lane, y] of REA_LANES.entries()) {
    slab(`gate-${gateIndex}-guide-${lane}`, {x: x - 5, y: y - 5, w: 10, d: 10, r: 1}, 49, 9);
    slab(`gate-${gateIndex}-stem-${lane}`, {x: x - 1.5, y: y - 1.5, w: 3, d: 3, r: 0}, 26, 23);
  }
}
slab('output-bin-backing', {x: 146, y: -62, w: 4, d: 124, r: 1}, 0, 15, 'base');
for (const [i, y] of REA_LANES.entries()) slab(`output-bin-stop-${i}`, {x: 134, y: y - 11, w: 12, d: 22, r: 1}, 0, 3, 'base');
slab('output-tally-strip', {x: 96, y: -80, w: 45, d: 10, r: 1}, 0, 2, 'base');
slab('output-coupling-receiver', {x: 145, y: 70, w: 12, d: 8, r: 1}, 0, 8, 'base');
slab('engraved-maker-plate', {x: -164, y: -80, w: 58, d: 10, r: 1}, 0, 1.2, 'base');

export const REA_STATIC_PARTS = parts.sort((a, b) => a.depth - b.depth);
export const REA_BASE_PARTS = REA_STATIC_PARTS.filter(item => item.layer === 'base');
export const REA_FRAME_PARTS = REA_STATIC_PARTS.filter(item => item.layer === 'mechanism');

export function reaTokenParts(lane: number) {
  const y = REA_LANES[lane]!;
  return [
    {name: `handler-${lane}-token`, paths: slabOf({x: -155, y: y - 10, w: 26, d: 20, r: 2}, 3, 5, REA_MACHINE_PROJECTION, 8, 0.5)},
    {name: `handler-${lane}-channel-key`, paths: slabOf({x: -152, y: y - 7, w: 11, d: 14, r: 0.6}, 8, 1.5, REA_MACHINE_PROJECTION)},
    {name: `handler-${lane}-mode-key`, paths: slabOf({x: -138, y: y - 7, w: 6, d: 14, r: 0.6}, 8, 1.5, REA_MACHINE_PROJECTION)},
  ];
}
export const REA_TOKEN_PARTS = REA_LANES.map((_, lane) => reaTokenParts(lane));
export const REA_BLADE_PARTS = [-78, 7].flatMap((x, gate) => REA_LANES.map((y, lane) => ({
  gate, lane,
  name: `gate-${gate}-blade-${lane}`,
  paths: slabOf({x: x - 2, y: y - 10, w: 4, d: 20, r: 0.5}, 8, 18, REA_MACHINE_PROJECTION, 6, 0.3),
})));
export const REA_LATCH = slabOf({x: 110, y: 71, w: 27, d: 6, r: 0.6}, 3, 4, REA_MACHINE_PROJECTION);
export const REA_TOKEN_LABELS = REA_LANES.map(y => topMatrix([-147, y + 2], 9.6, REA_MACHINE_PROJECTION));
export const reaTranslate = (by: Point3) => translateAlong(REA_MACHINE_PROJECTION, by);
export const reaPoint = (point: Point3) => iso(point, REA_MACHINE_PROJECTION);
export const REA_GATE_MARKERS = [-78, 7, 116].map(x => reaPoint([x, -83, 0]));
export const REA_TALLY_MARKS = [0, 1, 2].map(index => pathOf([
  reaPoint([102 + index * 13, -79, 2.1]), reaPoint([102 + index * 13, -72, 2.1]),
]));
