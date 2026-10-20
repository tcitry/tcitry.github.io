import {boxCorners, depthOf, fitProjection, haloOf, lineOnTop, slabOf, topMatrix, type Plan, type SolidPaths, type Tone} from './anatomy-iso-kit';

// A Figure: an index-card register and four comparators on one bench.
// The first stop truncates the recent-record rail; the last stop is a score
// threshold. Stops sit beside the tracks, never intersecting the runners.
export const WIDTH = 720;
export const HEIGHT = 420;
const base: Plan = {x: -183, y: -87, w: 366, d: 216, r: 7};
export const PROJECTION = fitProjection(boxCorners(base, -14, 20), WIDTH, HEIGHT, {pad: 22, azimuth: 72, elevation: 52});
export const SHADOW = haloOf(base, -14, 8, PROJECTION);
export const TRACK_START = -155;
export const TRAVEL = 300;
export const ROWS = [-60, -6, 40, 86] as const;
export type Motion = 'position' | 'a' | 'b' | 'c' | 'threshold';
export const MOTIONS: Motion[] = ['position', 'a', 'b', 'c'];
export interface MemoryPart {
  name: string; paths: SolidPaths; tone: Tone; key: number;
  shape: {kind: 'slab'; plan: Plan; z: number; height: number; steps: number};
  lines: string[]; motion?: Motion;
}
const parts: MemoryPart[] = [];
function slab(name: string, plan: Plan, z: number, height: number, tone: Tone = 'mid', motion?: Motion) {
  const item: MemoryPart = {name, paths: slabOf(plan, z, height, PROJECTION, 4, height > 2 ? 0.5 : 0), tone,
    key: depthOf([plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2], PROJECTION),
    shape: {kind: 'slab', plan, z, height, steps: 4}, lines: [], motion};
  parts.push(item);return item;
}
for (const x of [-166, 166]) for (const y of [-71, 111]) {
  slab(`foot-${x}-${y}`, {x: x - 5, y: y - 5, w: 10, d: 10, r: 2}, -14, 5, 'lo');
}
slab('bed', base, -9, 9, 'lo');
for (const x of [-173, 173]) for (const y of [-77, 119]) slab(`bed-fastener-${x}-${y}`, {x: x - 1.1, y: y - 1.1, w: 2.2, d: 2.2, r: 0.3}, 0, 0.6, 'mid');

export const LABELS: Array<{motion: Motion; transform: string; index: number}> = [];
for (const [index, y] of ROWS.entries()) {
  const motion = MOTIONS[index]!;
  slab(`${motion}-rail`, {x: -162, y: y - 2, w: 316, d: 11, r: 1}, 0, 3, 'mid');
  const scale = slab(`${motion}-scale`, {x: -162, y: y + 11, w: 316, d: 6, r: 0.4}, 0, 0.5, 'lo');
  for (let tick = 0; tick <= 10; tick++) {
    const x = TRACK_START + tick * TRAVEL / 10;
    scale.lines.push(lineOnTop([x, y + 11], [x, y + (tick % 5 === 0 ? 17 : 14)], 0.52, PROJECTION));
  }
  slab(`${motion}-end-new`, {x: -168, y: y - 4, w: 4, d: 14, r: 0.5}, 0, 6);
  slab(`${motion}-end-old`, {x: 156, y: y - 4, w: 4, d: 14, r: 0.5}, 0, 6);
  slab(`${motion}-runner`, {x: TRACK_START - 3, y: y - 2, w: 6, d: 11, r: 0.8}, 3, 6, 'hi', motion);
  slab(`${motion}-pointer`, {x: TRACK_START - 0.7, y: y + 9, w: 1.4, d: 8, r: 0}, 0.5, 2, 'hi', motion);
  const plate = slab(`${motion}-number`, {x: -177, y: y - 1, w: 8, d: 9, r: 0.6}, 0, 0.5, 'mid');
  LABELS.push({motion, index, transform: topMatrix([-176, y + 2], 0.55, PROJECTION)});
  void plate;
}

// Exactly 1000 of 1100 synthetic same-namespace records enter the first
// rail's scoring window. The inlay shows that interval as a physical strip.
const boundary = TRACK_START + 999 / 1099 * TRAVEL;
slab('window-inlay', {x: TRACK_START, y: ROWS[0] - 10, w: boundary - TRACK_START, d: 4, r: 0.4}, 0, 0.5, 'hi');
slab('window-limit-seat', {x: boundary - 3, y: ROWS[0] - 17, w: 6, d: 7, r: 0.5}, 0, 3);
slab('window-limit-flag', {x: boundary - 0.6, y: ROWS[0] - 17, w: 1.2, d: 7, r: 0}, 3, 12, 'hi');
for (const [index, y] of ROWS.slice(1).entries()) {
  slab(`threshold-seat-${index}`, {x: TRACK_START - 3, y: y - 10, w: 6, d: 7, r: 0.5}, 0, 3, 'mid', 'threshold');
  slab(`threshold-flag-${index}`, {x: TRACK_START - 0.6, y: y - 10, w: 1.2, d: 7, r: 0}, 3, 12, 'hi', 'threshold');
}

// Solved from actual slabs at five travel positions with Anatomy A.settle.
// Every moving group adds its projected travel to this painter key.
export const DEPTH_KEYS: Record<string, number> = {
  "foot--166--71": -82.21614911740095,
  "bed-fastener--173--77": 87.55305610206052,
  "position-number": 87.55305610206052,
  "position-end-new": 87.55305610206052,
  "position-runner": 87.57305610206052,
  "position-pointer": 87.57305610206052,
  "window-inlay": 87.55305610206052,
  "threshold-seat-0": 87.55305610206052,
  "a-number": 87.55305610206052,
  "position-rail": 87.55305610206052,
  "a-end-new": 87.57305610206052,
  "threshold-flag-0": 87.57305610206052,
  "position-scale": 87.55305610206052,
  "a-runner": 144.66801369933478,
  "a-pointer": 144.66801369933478,
  "window-limit-seat": 87.55305610206052,
  "foot-166--71": -19.053196043084114,
  "window-limit-flag": 87.57305610206052,
  "bed-fastener-173--77": 87.55305610206052,
  "threshold-seat-1": 87.55305610206052,
  "b-number": 87.55305610206052,
  "b-end-new": 87.55305610206052,
  "threshold-flag-1": 87.57305610206052,
  "a-rail": 144.64801369933477,
  "position-end-old": 87.55305610206052,
  "b-runner": 144.66801369933478,
  "b-pointer": 144.66801369933478,
  "a-scale": 87.55305610206052,
  "bed": 87.53305610206053,
  "threshold-seat-2": 87.55305610206052,
  "c-number": 87.55305610206052,
  "c-end-new": 87.55305610206052,
  "threshold-flag-2": 87.57305610206052,
  "foot--166-111": 24.350103027743714,
  "b-rail": 144.64801369933477,
  "c-runner": 144.66801369933478,
  "c-pointer": 144.66801369933478,
  "a-end-old": 87.55305610206052,
  "b-scale": 87.55305610206052,
  "bed-fastener--173-119": 87.55305610206052,
  "c-rail": 144.64801369933477,
  "b-end-old": 87.55305610206052,
  "c-scale": 87.55305610206052,
  "c-end-old": 87.55305610206052,
  "foot-166-111": 87.51305610206053,
  "bed-fastener-173-119": 102.82756286874576
};
for (const part of parts) part.key = DEPTH_KEYS[part.name]!;
export const PARTS = parts.sort((a, b) => a.key - b.key);
export const PART_COUNT = parts.length;
