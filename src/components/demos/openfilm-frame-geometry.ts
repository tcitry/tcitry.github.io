import {
  boxCorners, corners, cylinder, depthOf, fitProjection, haloOf, knurl,
  sideSeam, slabOf, topMatrix,
  type Plan, type Point3, type SolidPaths, type Tone,
} from './anatomy-iso-kit';

/** A fixed multiplane animation stand; only the drawings on its glass change. */
export const WIDTH = 520;
export const HEIGHT = 390;
const BASE: Plan = {x: -128, y: -87, w: 256, d: 184, r: 7};
export const PROJECTION = fitProjection([
  ...boxCorners(BASE, -16, 0),
  ...boxCorners({x: -117, y: -70, w: 234, d: 8, r: 0}, 0, 209),
  ...boxCorners({x: -20, y: 6, w: 40, d: 28, r: 0}, 143, 199),
], WIDTH, HEIGHT, {pad: 26, azimuth: 42, elevation: 43});
export const SHADOW = haloOf(BASE, -16, 2, PROJECTION);

export interface SlabShape {kind: 'slab'; plan: Plan; z: number; height: number; steps: number}
export interface CylinderShape {kind: 'cylinder'; x: number; y: number; radius: number; z: number; height: number}
export interface FramePart {
  name: string;
  paths: SolidPaths;
  shape: SlabShape | CylinderShape;
  center: Point3;
  tone: Tone;
  depthKey: number;
  line?: string;
  /** Apply to the solid only: the picture painted on top keeps its own alpha. */
  opacity?: number;
}

const parts: FramePart[] = [];
function slab(name: string, plan: Plan, z: number, height: number, tone: Tone = 'mid') {
  const steps = 6;
  const center: Point3 = [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2];
  const part: FramePart = {
    name, paths: slabOf(plan, z, height, PROJECTION, steps, height >= 3 ? 0.55 : 0),
    shape: {kind: 'slab', plan, z, height, steps}, center, tone,
    depthKey: depthOf(center, PROJECTION),
  };
  parts.push(part);
  return part;
}
function round(name: string, x: number, y: number, radius: number, z: number, height: number, tone: Tone = 'mid') {
  const center: Point3 = [x, y, z + height / 2];
  const part: FramePart = {
    name, paths: cylinder(x, y, radius, z, height, PROJECTION, 64, height >= 3 ? 0.4 : 0),
    shape: {kind: 'cylinder', x, y, radius, z, height}, center, tone,
    depthKey: depthOf(center, PROJECTION),
  };
  parts.push(part);
  return part;
}

// Figure parts list (75 solids): rubber feet and risers (8); milled base and
// fasteners (5); two rear plinths, bolts, columns and caps (12); two glass-stage
// assemblies, each with arms, edge supports, four frame bars and retainers (38);
// camera crossbar, forward arm, body, lid, lens stages and fasteners (12).
// Every attachment meets a real face; no plate floats or cuts through its frame.
for (const [i, [x, y]] of corners(BASE, 16).entries()) {
  round(`stand.rubber-foot-${i}`, x, y, 7.2, -16, 2, 'lo');
  round(`foot-riser-${i}`, x, y, 5.3, -14, 4, 'mid');
}
const base = slab('base.plate', BASE, -10, 10, 'lo');
base.line = sideSeam(BASE, -5, PROJECTION, 6);
for (const [i, [x, y]] of corners(BASE, 9).entries()) round(`base.fastener-${i}`, x, y, 1.8, 0, 0.8, 'hi');

for (const [i, x] of [-113, 113].entries()) {
  slab(`column.plinth-${i}`, {x: x - 11, y: -76, w: 22, d: 20, r: 2}, 0, 5);
  for (const [j, dx] of [-7, 7].entries()) round(`column.plinth-bolt-${i}-${j}`, x + dx, -73, 1.3, 5, 0.8, 'hi');
  slab(`column.upright-${i}`, {x: x - 4, y: -70, w: 8, d: 8, r: 0}, 5, 193);
  slab(`column.cap-${i}`, {x: x - 4, y: -70, w: 8, d: 8, r: 0}, 206, 2, 'hi');
  round(`column.cap-bolt-${i}`, x, -66, 1.4, 208, 0.8, 'hi');
}

const PICTURE_PLAN: Plan = {x: -96, y: -38, w: 192, d: 108, r: 0};
export interface PictureLayer {
  partName: string;
  pictureTransform: string;
  worldPlan: Plan;
  z: number;
  sourceWidth: 320;
  sourceHeight: 180;
}
function stage(name: 'background' | 'title', frameZ: number): PictureLayer {
  // Side arms join the front faces of the rear columns. Small shelf tabs bridge
  // the gap to the glass frame, keeping columns and arms outside the picture.
  for (const [i, x] of [-113, 113].entries()) {
    slab(`${name}.support-arm-${i}`, {x: x - 4, y: -62, w: 8, d: 140, r: 0}, frameZ - 3, 3);
    const tabX = i === 0 ? -109 : 102;
    for (const [j, y] of [-38, 64].entries()) {
      slab(`${name}.shelf-tab-${i}-${j}`, {x: tabX, y, w: 7, d: 10, r: 0}, frameZ - 3, 3);
    }
  }
  slab(`${name}.frame-rear`, {x: -106, y: -46, w: 212, d: 4, r: 0}, frameZ, 4, 'hi');
  slab(`${name}.frame-front`, {x: -106, y: 74, w: 212, d: 4, r: 0}, frameZ, 4, 'hi');
  slab(`${name}.frame-left`, {x: -106, y: -42, w: 4, d: 116, r: 0}, frameZ, 4, 'hi');
  slab(`${name}.frame-right`, {x: 102, y: -42, w: 4, d: 116, r: 0}, frameZ, 4, 'hi');
  const glass = slab(`${name}.glass`, {x: -102, y: -42, w: 204, d: 116, r: 0}, frameZ + 1.2, 1.6, 'hi');
  glass.opacity = 0.12;
  for (const [i, x] of [-103, 103].entries()) {
    for (const [j, y] of [-43, 75].entries()) {
      slab(`${name}.retainer-${i}-${j}`, {x: x - 3, y: y - 3, w: 6, d: 6, r: 0.5}, frameZ + 4, 0.8);
      round(`${name}.retainer-bolt-${i}-${j}`, x, y, 1.15, frameZ + 4.8, 0.8, 'hi');
    }
  }
  const z = frameZ + 2.84;
  return {
    partName: glass.name,
    // Both maps share exactly the same world x/y rectangle. Their different z
    // reveals the two stages; this separation never offsets source HTML pixels.
    pictureTransform: `${topMatrix([PICTURE_PLAN.x, PICTURE_PLAN.y], z, PROJECTION)} scale(0.6)`,
    worldPlan: {...PICTURE_PLAN}, z, sourceWidth: 320, sourceHeight: 180,
  };
}
export const PICTURE_LAYERS = {
  background: stage('background', 24),
  title: stage('title', 86),
} as const;

slab('camera.crossbar', {x: -117, y: -70, w: 234, d: 8, r: 0}, 198, 8);
slab('camera.forward-arm', {x: -8, y: -62, w: 16, d: 82, r: 0}, 198, 8);
const camera = slab('camera.body', {x: -20, y: 6, w: 40, d: 28, r: 1.4}, 178, 20);
camera.line = sideSeam({x: -20, y: 6, w: 40, d: 28, r: 1.4}, 188, PROJECTION, 6);
slab('camera.lid', {x: -20, y: 20, w: 40, d: 14, r: 0}, 198, 0.8, 'hi');
round('camera.lens-barrel', 0, 20, 13, 158, 20, 'mid');
round('camera.lens-seat', 0, 20, 15, 154, 4, 'hi');
const focus = round('camera.focus-ring', 0, 20, 11.5, 144, 10, 'mid');
focus.line = knurl(0, 20, 11.5, 144, 154, 36, PROJECTION, 0);
round('camera.optical-glass', 0, 20, 10, 143, 1, 'hi');
for (const [i, x] of [-14, 14].entries()) round(`camera.lid-screw-${i}`, x, 26, 1.1, 198.8, 0.8, 'hi');
for (const [i, x] of [-103, 103].entries()) round(`camera.crossbar-bolt-${i}`, x, -66, 1.5, 206, 0.9, 'hi');

// Generated by Anatomy settle against the exact slab/cylinder records above.
// Re-run the geometry audit after changing any dimensions.
const DEPTH_KEYS: Record<string, number> = {
  "stand.rubber-foot-0": -105.84751927729765,
  "foot-riser-0": -103.80152419711015,
  "stand.rubber-foot-1": 15.896865767955887,
  "foot-riser-1": 17.942860848143383,
  "stand.rubber-foot-2": -31.463105111558534,
  "foot-riser-2": -29.41711003137104,
  "stand.rubber-foot-3": 90.281279933695,
  "foot-riser-3": 92.3272750138825,
  "base.plate": 92.3472750138825,
  "base.fastener-0": 92.36727501388249,
  "base.fastener-1": 92.36727501388249,
  "base.fastener-2": 92.36727501388249,
  "base.fastener-3": 108.01416473211226,
  "column.plinth-0": 92.38727501388249,
  "column.plinth-bolt-0-0": 92.40727501388248,
  "column.plinth-bolt-0-1": 92.40727501388248,
  "column.upright-0": 92.42727501388248,
  "column.cap-0": 105.48517310802744,
  "column.cap-bolt-0": 105.50517310802744,
  "column.plinth-1": 92.38727501388249,
  "column.plinth-bolt-1-0": 92.40727501388248,
  "column.plinth-bolt-1-1": 92.40727501388248,
  "column.upright-1": 98.34003216332513,
  "column.cap-1": 170.29085914991873,
  "column.cap-bolt-1": 171.24565685400623,
  "background.support-arm-0": 92.44727501388248,
  "background.shelf-tab-0-0": 92.46727501388247,
  "background.shelf-tab-0-1": 92.46727501388247,
  "background.support-arm-1": 106.47100351292376,
  "background.shelf-tab-1-0": 92.36727501388249,
  "background.shelf-tab-1-1": 106.45100351292376,
  "background.frame-rear": 92.46727501388247,
  "background.frame-front": 106.49100351292375,
  "background.frame-left": 92.48727501388247,
  "background.frame-right": 106.47100351292376,
  "background.glass": 92.50727501388246,
  "background.retainer-0-0": 92.50727501388246,
  "background.retainer-bolt-0-0": 92.52727501388246,
  "background.retainer-0-1": 106.51100351292375,
  "background.retainer-bolt-0-1": 106.53100351292375,
  "background.retainer-1-0": 106.49100351292375,
  "background.retainer-bolt-1-0": 106.51100351292375,
  "background.retainer-1-1": 112.05226641487582,
  "background.retainer-bolt-1-1": 112.59786510292582,
  "title.support-arm-0": 92.44727501388248,
  "title.shelf-tab-0-0": 92.46727501388247,
  "title.shelf-tab-0-1": 92.46727501388247,
  "title.support-arm-1": 148.75490183679867,
  "title.shelf-tab-1-0": 98.8190449624211,
  "title.shelf-tab-1-1": 148.73490183679866,
  "title.frame-rear": 92.46727501388247,
  "title.frame-front": 148.77490183679868,
  "title.frame-left": 92.48727501388247,
  "title.frame-right": 148.75490183679867,
  "title.glass": 92.54727501388246,
  "title.retainer-0-0": 92.50727501388246,
  "title.retainer-bolt-0-0": 92.52727501388246,
  "title.retainer-0-1": 148.7949018367987,
  "title.retainer-bolt-0-1": 148.8149018367987,
  "title.retainer-1-0": 148.77490183679868,
  "title.retainer-bolt-1-0": 148.7949018367987,
  "title.retainer-1-1": 154.3361647387507,
  "title.retainer-bolt-1-1": 154.88176342680072,
  "camera.crossbar": 105.46517310802744,
  "camera.forward-arm": 138.02311460829435,
  "camera.body": 138.00311460829434,
  "camera.lid": 148.52149557373494,
  "camera.lens-barrel": 124.36314740704435,
  "camera.lens-seat": 116.17916708629437,
  "camera.focus-ring": 111.40517856585689,
  "camera.optical-glass": 107.65418758551314,
  "camera.lid-screw-0": 148.54149557373495,
  "camera.lid-screw-1": 156.18674718128605,
  "camera.crossbar-bolt-0": 105.48517310802744,
  "camera.crossbar-bolt-1": 164.4807428623641
};
for (const part of parts) part.depthKey = DEPTH_KEYS[part.name] ?? part.depthKey;
export const PARTS = parts.slice().sort((a, b) => a.depthKey - b.depthKey);
export const PART_COUNT = PARTS.length;
export const UNSORTED_PARTS = parts;

// Compatibility aliases for the existing Figure import during its replacement.
export const FILM_WIDTH = WIDTH;
export const FILM_HEIGHT = HEIGHT;
export const FILM_PROJECTION = PROJECTION;
export const FILM_SHADOW = SHADOW;
export const FILM_PARTS = PARTS;
export const FILM_STATIC_PARTS = PARTS;
export const FILM_MOVING_PARTS: FramePart[] = [];
export const FILM_PART_COUNT = PART_COUNT;
