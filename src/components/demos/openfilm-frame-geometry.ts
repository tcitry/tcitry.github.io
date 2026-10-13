import {
  boxCorners, corners, cylinder, fitProjection, haloOf, iso, knurl,
  lineOnTop, pathOf, planOutline, sideSeam, slabOf, topTicks,
  translateAlong, type Plan, type Point3, type SolidPaths, type Tone,
} from './anatomy-iso-kit';

export const FILM_WIDTH = 620;
export const FILM_HEIGHT = 380;
const BASE: Plan = {x: -130, y: -53, w: 260, d: 132, r: 7};
export const FILM_PROJECTION = fitProjection([
  ...boxCorners(BASE, -18, 0), ...boxCorners({x: -90, y: -39, w: 180, d: 9, r: 0}, 0, 140),
], FILM_WIDTH, FILM_HEIGHT, {pad: 32, azimuth: 42, elevation: 32});
export const FILM_SHADOW = haloOf(BASE, -18, 2, FILM_PROJECTION);

interface SlabShape {kind: 'slab'; plan: Plan; z: number; height: number; steps: number}
interface CylinderShape {kind: 'cylinder'; x: number; y: number; radius: number; z: number; height: number}
export interface FilmPart {
  name: string; paths: SolidPaths; shape: SlabShape | CylinderShape;
  center: Point3; tone: Tone; lit?: boolean; line?: string; move?: Point3;
}
const parts: FilmPart[] = [];
function slab(name: string, plan: Plan, z: number, height: number, tone: Tone = 'mid', lit = false, moving = false) {
  const part: FilmPart = {name, paths: slabOf(plan, z, height, FILM_PROJECTION, 5, height > 3 ? 0.45 : 0),
    shape: {kind: 'slab', plan, z, height, steps: 5}, center: [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2], tone, lit};
  if (moving) part.move = [206, 0, 0];
  parts.push(part);
  return part;
}
function round(name: string, x: number, y: number, radius: number, z: number, height: number, tone: Tone = 'mid', moving = false) {
  const part: FilmPart = {name, paths: cylinder(x, y, radius, z, height, FILM_PROJECTION, 40),
    shape: {kind: 'cylinder', x, y, radius, z, height}, center: [x, y, z + height / 2], tone};
  if (moving) part.move = [206, 0, 0];
  parts.push(part);
  return part;
}

// Parts list: 4 rubber feet + 4 metal pads; a milled base and 4 bolts;
// 2 screen plinths, 2 posts, backing, display, 4 rim bars and 4 screws;
// film bed, 2 rails, 2 end stops and 4 bolts; film strip with 7 windows;
// two bearing shoes, crosspiece, optical head, lens seat, dial and cap, 2 screws;
// an indicator tongue and drop leg land its pointer beside the time ruler;
// ruler with 2 screws; switch panel, dial, button, lamp collar and lens;
// engraved plate with 2 screws. Every solid is precomputed once.
for (const [i, [x, y]] of corners(BASE, 15).entries()) {
  round(`stand.rubber-foot-${i}`, x, y, 7, -18, 2, 'lo');
  round(`stand.foot-pad-${i}`, x, y, 5, -16, 4);
}
const base = slab('stand.base', BASE, -12, 12);
base.line = sideSeam(BASE, -6, FILM_PROJECTION, 5);
for (const [i, [x, y]] of corners(BASE, 9).entries()) round(`base-bolt-${i}`, x, y, 1.8, 0, 0.8, 'hi');

for (const [i, x] of [-78, 78].entries()) {
  slab(`screen-plinth-${i}`, {x: x - 10, y: -45, w: 20, d: 15, r: 2}, 0, 3);
  slab(`screen-post-${i}`, {x: x - 4, y: -39, w: 8, d: 4, r: 0.5}, 3, 32);
}
slab('screen-backing', {x: -90, y: -39, w: 180, d: 4, r: 0}, 35, 105, 'lo');
slab('screen-display', {x: -85, y: -35, w: 170, d: 4, r: 0}, 40, 95, 'hi');
slab('screen-rim-left', {x: -90, y: -35, w: 5, d: 5, r: 0}, 40, 95);
slab('screen-rim-right', {x: 85, y: -35, w: 5, d: 5, r: 0}, 40, 95);
slab('screen-rim-top', {x: -90, y: -35, w: 180, d: 5, r: 0}, 135, 5);
slab('screen-rim-bottom', {x: -90, y: -35, w: 180, d: 5, r: 0}, 35, 5);
for (const [i, x] of [-87.5, 87.5].entries()) {
  for (const [j, z] of [37, 137].entries()) {
    slab(`screen-fastener-${i}-${j}`, {x: x - 1, y: -30, w: 2, d: 0.65, r: 0}, z, 2, 'hi');
  }
}

slab('film-bed', {x: -119, y: 3, w: 238, d: 42, r: 2}, 0, 3);
for (const [i, y] of [7, 38].entries()) {
  const rail = slab(`guide-rail-${i}`, {x: -112, y, w: 224, d: 4, r: 0.5}, 3, 4, 'hi');
  rail.line = lineOnTop([-112, y + 2], [112, y + 2], 7, FILM_PROJECTION);
}
for (const [i, x] of [-119, 113].entries()) {
  slab(`end-stop-${i}`, {x, y: 3, w: 6, d: 42, r: 0.7}, 3, 7);
  for (const [j, y] of [10, 38].entries()) round(`stop-bolt-${i}-${j}`, x + 3, y, 1.4, 10, 0.8);
}
const strip = slab('film-strip', {x: -111, y: 15, w: 222, d: 20, r: 1}, 3, 0.5, 'lo');
strip.line = Array.from({length: 20}, (_, i) => {
  const x = -106 + i * 11;
  return [16.5, 32].map(y => planOutline({x, y, w: 3.5, d: 1.5, r: 0.4}, 3.5, FILM_PROJECTION)).join('');
}).join('');
for (let i = 0; i < 7; i++) slab(`film-window-${i}`, {x: -104 + i * 30, y: 20, w: 24, d: 10, r: 0}, 3.5, 0.12, 'hi');

for (const [i, y] of [7, 38].entries()) slab(`carriage-bearing-${i}`, {x: -110, y, w: 14, d: 4, r: 0.5}, 7, 4, 'mid', false, true);
slab('carriage-crosspiece', {x: -111, y: 7, w: 16, d: 35, r: 1}, 11, 3, 'hi', false, true);
slab('optical-head', {x: -109, y: 19, w: 12, d: 12, r: 1}, 14, 6, 'mid', true, true);
round('lens-seat', -103, 25, 4.2, 20, 1.2, 'hi', true);
const dial = round('index-dial', -103, 25, 3.6, 21.2, 4.8, 'hi', true);
dial.line = knurl(-103, 25, 3.6, 21.2, 26, 18, FILM_PROJECTION, 0);
round('dial-cap', -103, 25, 2.8, 26, 0.7, 'hi', true);
for (const [i, y] of [10, 39].entries()) round(`carriage-screw-${i}`, -103, y, 1.1, 14, 0.6, 'hi', true);
slab('pointer-tongue', {x: -104, y: 42, w: 2, d: 7.8, r: 0}, 11, 0.8, 'hi', false, true);
slab('pointer-drop-leg', {x: -103.8, y: 48.2, w: 1.6, d: 1.6, r: 0}, 0.9, 10.1, 'hi', false, true);

const rulerPlan = {x: -114, y: 50, w: 228, d: 8, r: 1};
const ruler = slab('time-ruler', rulerPlan, 0, 0.8, 'hi');
const ticks = topTicks(-103, 103, 206 / 30, 5, 50, 0.8, [3, 5.5], FILM_PROJECTION);
ruler.line = ticks.minor + ticks.major;
for (const [i, x] of [-110, 110].entries()) round(`ruler-screw-${i}`, x, 55, 1, 0.8, 0.5);
slab('switch-panel', {x: 72, y: 62, w: 43, d: 12, r: 2}, 0, 3);
round('power-dial', 80, 68, 3, 3, 2.5);
round('seek-button', 92, 68, 2.4, 3, 2);
round('ready-lamp-seat', 105, 68, 3, 3, 1);
const lamp = round('ready-lamp', 105, 68, 2, 4, 0.9, 'hi');
lamp.lit = true;
slab('engraved-plate', {x: -111, y: 63, w: 57, d: 11, r: 1}, 0, 0.7, 'lo');
for (const [i, x] of [-107, -58].entries()) round(`plate-screw-${i}`, x, 68.5, 0.8, 0.7, 0.4);

// Painter keys measured by Anatomy audit against the exact slab/cylinder shapes,
// at eleven times across the full seek travel. Re-run that audit after geometry changes.
const FILM_DEPTH_KEYS: Record<string, number> = {
  'pointer-tongue': 65,
  'pointer-drop-leg': 64,
  "stand.rubber-foot-0": 0,
  "stand.foot-pad-0": 1,
  "base-bolt-0": 50.04,
  "screen-plinth-0": 50.04,
  "stop-bolt-0-0": 50.08,
  "screen-post-0": 50.06,
  "end-stop-0": 50.06,
  "screen-fastener-0-0": 50.12,
  "stop-bolt-0-1": 50.08,
  "stand.rubber-foot-2": 9,
  "stand.foot-pad-2": 10,
  "film-window-0": 50.06,
  "ruler-screw-0": 50.06,
  "base-bolt-2": 50.04,
  "plate-screw-0": 50.06,
  "screen-rim-left": 50.12,
  "film-window-1": 50.06,
  "engraved-plate": 50.04,
  "film-window-2": 50.06,
  "screen-fastener-0-1": 50.2,
  "screen-rim-bottom": 50.1,
  "plate-screw-1": 50.06,
  "stand.base": 50.02,
  "guide-rail-0": 50.08,
  "film-bed": 50.04,
  "film-window-3": 50.06,
  "film-strip": 50.06,
  "guide-rail-1": 50.08,
  "screen-backing": 50.08,
  "screen-display": 50.14,
  "screen-plinth-1": 50.04,
  "time-ruler": 50.04,
  "film-window-4": 50.06,
  "screen-post-1": 50.06,
  "stand.rubber-foot-1": 34,
  "stand.foot-pad-1": 35,
  "base-bolt-1": 50.04,
  "film-window-5": 50.06,
  "screen-rim-top": 50.18,
  "screen-fastener-1-0": 50.12,
  "film-window-6": 50.06,
  "screen-rim-right": 50.16,
  "stop-bolt-1-0": 50.12,
  "end-stop-1": 50.1,
  "power-dial": 50.06,
  "switch-panel": 50.04,
  "seek-button": 50.06,
  "stand.rubber-foot-3": 47,
  "stop-bolt-1-1": 50.12,
  "ruler-screw-1": 50.06,
  "stand.foot-pad-3": 50,
  "ready-lamp-seat": 51,
  "ready-lamp": 52,
  "screen-fastener-1-1": 53,
  "base-bolt-3": 54,
  "carriage-bearing-0": 55,
  "carriage-screw-0": 56,
  "carriage-crosspiece": 61.02,
  "optical-head": 61.04,
  "lens-seat": 61.06,
  "index-dial": 61.08,
  "carriage-bearing-1": 61,
  "dial-cap": 62,
  "carriage-screw-1": 63,
};

export const FILM_PARTS = parts;
export const FILM_STATIC_PARTS = parts.filter(part => !part.move).sort((a, b) => FILM_DEPTH_KEYS[a.name]! - FILM_DEPTH_KEYS[b.name]!);
export const FILM_MOVING_PARTS = parts.filter(part => part.move).sort((a, b) => FILM_DEPTH_KEYS[a.name]! - FILM_DEPTH_KEYS[b.name]!);
export const FILM_PART_COUNT = parts.length;
// Screen coordinates are deliberately one fixed plane; the marker is a complete new frame.
export const FILM_SCREEN = pathOf([[-83, -30.9, 42], [83, -30.9, 42], [83, -30.9, 133], [-83, -30.9, 133]].map(point => iso(point as Point3, FILM_PROJECTION)), true);
export const FILM_SCREEN_BASELINE = pathOf([[-83, -30.85, 61], [83, -30.85, 61]].map(point => iso(point as Point3, FILM_PROJECTION)));
export const FILM_MARKER = pathOf([[-75, -30.8, 63], [-64, -30.8, 63], [-64, -30.8, 74], [-75, -30.8, 74]].map(point => iso(point as Point3, FILM_PROJECTION)), true);
export const filmTranslate = (travel: number) => translateAlong(FILM_PROJECTION, [travel, 0, 0]);
export const FILM_POINTER = pathOf([[-103, 49, 0.9], [-106, 46, 0.9], [-100, 46, 0.9]].map(point => iso(point as Point3, FILM_PROJECTION)), true);
export const FILM_PLATE_TEXT = pathOf([[-101, 68, 0.8], [-75, 68, 0.8], [-72, 68, 0.8], [-63, 68, 0.8]].map(point => iso(point as Point3, FILM_PROJECTION)));
