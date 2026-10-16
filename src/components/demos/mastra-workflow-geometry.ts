import {
  boxCorners, corners, cylinder, depthOf, fitProjection, haloOf, sideSeam, slabOf, topMatrix,
  type Plan, type Point3, type SolidPaths, type Tone,
} from './anatomy-iso-kit';

/** A three-station ticket press with a shallow snapshot drawer. Figure: 68 solids. */
export const WIDTH = 680;
export const HEIGHT = 400;
const BASE: Plan = {x: -158, y: -78, w: 316, d: 179, r: 8};
export const PROJECTION = fitProjection([
  ...boxCorners(BASE, -17, 0),
  ...boxCorners({x: -42, y: -61, w: 84, d: 22, r: 1}, 0, 103),
], WIDTH, HEIGHT, {pad: 25, azimuth: 57, elevation: 48});
export const SHADOW = haloOf(BASE, -17, 2, PROJECTION);
export type MachineShape =
  | {kind: 'slab'; plan: Plan; z: number; height: number; steps: number}
  | {kind: 'cylinder'; x: number; y: number; radius: number; z: number; height: number};
export interface WorkflowPart {
  name: string;
  purpose: string;
  paths: SolidPaths;
  shape: MachineShape;
  center: Point3;
  tone: Tone;
  depthKey: number;
  line?: string;
}
const parts: WorkflowPart[] = [];
function slab(name: string, purpose: string, plan: Plan, z: number, height: number, tone: Tone = 'mid') {
  const steps = 8;
  const center: Point3 = [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2];
  const part: WorkflowPart = {name, purpose, paths: slabOf(plan, z, height, PROJECTION, steps, height >= 3 ? 0.5 : 0), shape: {kind: 'slab', plan, z, height, steps}, center, tone, depthKey: depthOf(center, PROJECTION)};
  parts.push(part);
  return part;
}
function round(name: string, purpose: string, x: number, y: number, radius: number, z: number, height: number, tone: Tone = 'mid') {
  const center: Point3 = [x, y, z + height / 2];
  const part: WorkflowPart = {name, purpose, paths: cylinder(x, y, radius, z, height, PROJECTION, 64, height >= 3 ? 0.3 : 0), shape: {kind: 'cylinder', x, y, radius, z, height}, center, tone, depthKey: depthOf(center, PROJECTION)};
  parts.push(part);
  return part;
}

// Base: four feet + four risers, milled plate, seam, four corner fasteners.
for (const [i, [x, y]] of corners(BASE, 17).entries()) {
  round(`foot-${i}`, 'Rubber foot rests on the bench', x, y, 7, -17, 2, 'lo');
  round(`riser-${i}`, 'Riser joins foot to base underside', x, y, 5, -15, 5, 'mid');
}
const base = slab('base', 'Milled bed carries every station', BASE, -10, 10, 'lo');
base.line = sideSeam(BASE, -5, PROJECTION, 8);
for (const [i, [x, y]] of corners(BASE, 9).entries()) round(`base-bolt-${i}`, 'Retains base plate', x, y, 1.6, 0, 0.8, 'hi');

// Each ticket rests on its platen; rear/side registration fences touch the platen face.
export const TICKETS: Record<'input' | 'approval' | 'receipt', {name: string; matrix: string; width: number; height: number}> = {} as Record<'input' | 'approval' | 'receipt', {name: string; matrix: string; width: number; height: number}>;
for (const [index, [name, x]] of (['input', 'approval', 'receipt'] as const).map((name, i) => [i, [name, -143 + i * 99]] as const)) {
  slab(`${name}-platen`, 'Supports the ticket in this workflow station', {x, y: -26, w: 88, d: 73, r: 3}, 0, 5, 'mid');
  slab(`${name}-backstop`, 'Registers the ticket rear edge', {x, y: -26, w: 88, d: 3, r: 0.5}, 5, 5, 'hi');
  slab(`${name}-fence`, 'Registers the ticket left edge', {x, y: -23, w: 3, d: 70, r: 0.5}, 5, 3, 'mid');
  for (const [j, dx] of [8, 80].entries()) round(`${name}-platen-bolt-${j}`, 'Fixes platen to bed', x + dx, -19, 1.2, 5, 0.7, 'hi');
  slab(`${name}-ticket`, 'Paper carries amount and the resulting decision', {x: x + 6, y: -13, w: 75, d: 53, r: 0.4}, 5, 0.8, 'hi');
  for (const [j, y] of [2, 28].entries()) {
    slab(`${name}-tab-${j}`, 'Retains the paper edge', {x: x + 3, y, w: 5, d: 7, r: 0.5}, 5.8, 1, 'mid');
    round(`${name}-tab-bolt-${j}`, 'Fixes the paper retainer', x + 5.5, y + 3.5, 0.8, 6.8, 0.6, 'hi');
  }
  TICKETS[name] = {name: `${name}-ticket`, matrix: topMatrix([x + 6, -13], 5.84, PROJECTION), width: 75, height: 53};
  // Narrow bridges connect platen edges without crossing either paper.
  if (index < 2) slab(`transfer-bridge-${index}`, 'Bridges adjacent platens', {x: x + 88, y: 12, w: 11, d: 12, r: 0}, 0, 5, 'lo');
}

// Press: two uprights stand on the bed, a crosshead rests on their tops.
for (const [i, x] of [-44, 30].entries()) {
  slab(`press-foot-${i}`, 'Seats the press upright on the bed', {x, y: -64, w: 14, d: 21, r: 2}, 0, 4);
  for (const [j, y] of [-61, -46].entries()) round(`press-foot-bolt-${i}-${j}`, 'Bolts upright foot to bed', x + 7, y, 1.2, 4, 0.7, 'hi');
  slab(`press-upright-${i}`, 'Holds the boolean stamp above the ticket', {x: x + 3, y: -58, w: 8, d: 9, r: 1}, 4, 84);
}
slab('press-crosshead', 'Carries the external decision cartridge', {x: -44, y: -61, w: 88, d: 18, r: 2}, 88, 8, 'hi');
for (const [i, x] of [-37, 37].entries()) round(`crosshead-bolt-${i}`, 'Fastens the crosshead', x, -52, 1.4, 96, 0.8, 'hi');
slab('decision-cartridge', 'External resumeData enters the press here', {x: -21, y: -59, w: 42, d: 14, r: 2}, 96, 6, 'hi');
// Arm is a genuine bridge from the crosshead to the stamp over the central paper.
slab('press-arm', 'Carries the stamp over the saved amount', {x: -7, y: -43, w: 14, d: 39, r: 0.5}, 88, 5);
slab('stamp-shaft', 'Connects the die to the press arm', {x: -4, y: -12, w: 8, d: 8, r: 0.5}, 23, 65);
slab('stamp-die', 'Imprints the new boolean field on the amount record', {x: -17, y: -17, w: 34, d: 18, r: 2}, 17, 6, 'hi');

// Snapshot drawer: floor, three low sides, front and a handle; deliberately open.
const drawer = slab('snapshot-floor', 'Holds the saved run record', {x: -64, y: 61, w: 128, d: 32, r: 2}, 0, 3, 'lo');
slab('snapshot-left', 'Drawer wall protects the saved ticket', {x: -64, y: 61, w: 3, d: 32, r: 0.5}, 3, 6);
slab('snapshot-right', 'Drawer wall protects the saved ticket', {x: 61, y: 61, w: 3, d: 32, r: 0.5}, 3, 6);
slab('snapshot-front', 'Drawer front retains the saved ticket', {x: -61, y: 90, w: 122, d: 3, r: 0.5}, 3, 6, 'hi');
slab('snapshot-ticket', 'Saved approval payload, independent of the slider', {x: -54, y: 65, w: 108, d: 20, r: 0.3}, 3, 0.8, 'hi');
for (const [i, x] of [-13, 10].entries()) slab(`handle-standoff-${i}`, 'Offsets drawer handle from its face', {x, y: 93, w: 3, d: 3, r: 0.3}, 3, 3);
slab('drawer-handle', 'Lets the saved record be inspected', {x: -13, y: 96, w: 26, d: 3, r: 0.6}, 3, 3, 'hi');
export const SNAPSHOT_MATRIX = topMatrix([-54, 65], 3.84, PROJECTION);
export const DECISION_MATRIX = topMatrix([-21, -59], 102.05, PROJECTION);
// Painter order solved from the recorded true shapes with Anatomy settle().
const DEPTH_KEYS: Record<string, number> = {"foot-0":-97.50759142541143,"riser-0":-94.90658453624056,"foot-1":5.262979239047564,"riser-1":7.863986128218443,"foot-2":-16.136470304037243,"riser-2":-13.535463414866364,"foot-3":86.63410036042175,"riser-3":89.23510724959263,"base":89.25510724959263,"base-bolt-0":89.27510724959262,"base-bolt-1":89.27510724959262,"base-bolt-2":89.27510724959262,"base-bolt-3":106.22659384553869,"input-platen":89.27510724959262,"input-backstop":89.29510724959262,"input-fence":89.31510724959261,"input-platen-bolt-0":89.29510724959262,"input-platen-bolt-1":89.29510724959262,"input-ticket":89.29510724959262,"input-tab-0":89.33510724959261,"input-tab-bolt-0":89.3551072495926,"input-tab-1":89.33510724959261,"input-tab-bolt-1":89.3551072495926,"transfer-bridge-0":89.29510724959262,"approval-platen":89.31510724959261,"approval-backstop":89.33510724959261,"approval-fence":89.3551072495926,"approval-platen-bolt-0":89.33510724959261,"approval-platen-bolt-1":89.33510724959261,"approval-ticket":89.33510724959261,"approval-tab-0":89.3751072495926,"approval-tab-bolt-0":89.3951072495926,"approval-tab-1":89.3751072495926,"approval-tab-bolt-1":89.3951072495926,"transfer-bridge-1":89.33510724959261,"receipt-platen":89.3551072495926,"receipt-backstop":89.3751072495926,"receipt-fence":89.3951072495926,"receipt-platen-bolt-0":89.3751072495926,"receipt-platen-bolt-1":89.3751072495926,"receipt-ticket":89.3751072495926,"receipt-tab-0":89.4151072495926,"receipt-tab-bolt-0":89.43510724959259,"receipt-tab-1":89.4151072495926,"receipt-tab-bolt-1":89.43510724959259,"press-foot-0":89.27510724959262,"press-foot-bolt-0-0":89.29510724959262,"press-foot-bolt-0-1":89.29510724959262,"press-upright-0":89.31510724959261,"press-foot-1":89.27510724959262,"press-foot-bolt-1-0":89.29510724959262,"press-foot-bolt-1-1":89.29510724959262,"press-upright-1":89.31510724959261,"press-crosshead":89.33510724959261,"crosshead-bolt-0":89.3551072495926,"crosshead-bolt-1":89.3551072495926,"decision-cartridge":89.3551072495926,"press-arm":89.3951072495926,"stamp-shaft":89.3751072495926,"stamp-die":89.3551072495926,"snapshot-floor":89.27510724959262,"snapshot-left":89.29510724959262,"snapshot-right":89.33510724959261,"snapshot-front":89.31510724959261,"snapshot-ticket":89.29510724959262,"handle-standoff-0":89.33510724959261,"handle-standoff-1":89.33510724959261,"drawer-handle":89.3551072495926};
for (const part of parts) part.depthKey = DEPTH_KEYS[part.name] ?? part.depthKey;
export const UNSORTED_PARTS = parts;
export const PARTS = parts.slice().sort((a, b) => a.depthKey - b.depthKey);
export const PART_COUNT = PARTS.length;
void drawer;
