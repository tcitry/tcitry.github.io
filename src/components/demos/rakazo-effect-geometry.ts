import {boxCorners, corners, depthOf, fitProjection, haloOf, slabOf, topMatrix, translateAlong} from './anatomy-iso-kit';
import type {Plan, Point3, SolidPaths, Tone} from './anatomy-iso-kit';

/** Figure: 47 purposeful solids. An archive drawer, lifting approval gate and
 * receiving tray. Rectangular hardware keeps this small mechanism inspectable. */
export const WIDTH = 720;
export const HEIGHT = 390;
const BASE: Plan = {x: -173, y: -80, w: 346, d: 183, r: 7};
export const PROJECTION = fitProjection([
  ...boxCorners(BASE, -16, 0),
  ...boxCorners({x: -23, y: -26, w: 46, d: 51, r: 1}, 0, 72),
], WIDTH, HEIGHT, {pad: 24, azimuth: 55, elevation: 49});
export const SHADOW = haloOf(BASE, -16, 4, PROJECTION);
export type ReplayPart = {name: string; purpose: string; paths: SolidPaths; tone: Tone; center: Point3; plan: Plan; z: number; height: number; moving?: boolean};
const parts: ReplayPart[] = [];
function slab(name: string, purpose: string, plan: Plan, z: number, height: number, tone: Tone = 'mid', moving = false) {
  const part: ReplayPart = {name, purpose, paths: slabOf(plan, z, height, PROJECTION, 8, height > 2 ? 0.5 : 0), tone,
    center: [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2], plan, z, height, moving};
  parts.push(part);
  return part;
}
// Bench and fasteners: 13 solids, every foot meets a riser and the bed.
for (const [i, [x, y]] of corners(BASE, 15).entries()) {
  slab(`foot-${i}`, 'Rubber pad beneath the archive machine', {x: x - 7, y: y - 7, w: 14, d: 14, r: 2}, -16, 3, 'lo');
  slab(`riser-${i}`, 'Connects the pad to the bed underside', {x: x - 5, y: y - 5, w: 10, d: 10, r: 1}, -13, 5, 'lo');
}
slab('bed', 'Milled bed supports the archive, rails and tray', BASE, -8, 8, 'lo');
for (const [i, [x, y]] of corners(BASE, 9).entries()) slab(`bed-screw-${i}`, 'Square screw head secures the bed', {x: x - 1.2, y: y - 1.2, w: 2.4, d: 2.4, r: 0.2}, 0, 0.8, 'hi');

// Open drawer: the saved request never moves when the proposal changes.
slab('archive-floor', 'Open archive drawer holds the saved request', {x: -156, y: -42, w: 109, d: 80, r: 2}, 0, 4);
slab('archive-back', 'Rear wall retains the archived paper', {x: -156, y: -42, w: 109, d: 3, r: 0.4}, 4, 11);
slab('archive-left', 'Left drawer side locates the saved paper', {x: -156, y: -39, w: 3, d: 77, r: 0.4}, 4, 7);
slab('archive-right', 'Right drawer side locates the saved paper', {x: -50, y: -39, w: 3, d: 77, r: 0.4}, 4, 7);
slab('archive-front', 'Low drawer front keeps the request visible', {x: -153, y: 35, w: 103, d: 3, r: 0.4}, 4, 6, 'hi');
for (const [i, x] of [-119, -91].entries()) slab(`handle-mount-${i}`, 'Offsets the archive pull from the drawer front', {x, y: 38, w: 3, d: 4, r: 0.3}, 5, 3);
slab('archive-handle', 'Pull opens the saved-request drawer', {x: -119, y: 42, w: 31, d: 3, r: 0.5}, 5, 3, 'hi');
slab('saved-paper', 'Immutable request fields printed on archived paper', {x: -147, y: -31, w: 91, d: 59, r: 0.3}, 4, 0.8, 'hi');
for (const [i, y] of [-22, 14].entries()) slab(`archive-clip-${i}`, 'Clips touch the saved paper at its left edge', {x: -151, y, w: 6, d: 6, r: 0.4}, 4.8, 1, 'mid');

// Approval gate slides vertically in two guide posts; the route stays physical.
for (const [i, y] of [-24, 21].entries()) {
  slab(`rail-in-${i}`, 'Incoming guide rail meets the gate foot at its edge', {x: -47, y, w: 23, d: 4, r: 0.5}, 0, 4, 'lo');
  slab(`rail-out-${i}`, 'Outgoing guide rail meets the receiving tray at its edge', {x: -7, y, w: 72, d: 4, r: 0.5}, 0, 4, 'lo');
  slab(`gate-foot-${i}`, 'Foot seats the gate guide on the bed', {x: -24, y: y - 4, w: 17, d: 12, r: 1}, 0, 5);
  slab(`gate-post-${i}`, 'Guide constrains the approval gate to vertical travel', {x: -20, y: y - 1, w: 8, d: 6, r: 0.7}, 5, 57);
  slab(`gate-bolt-${i}`, 'Square fastener holds the gate guide foot', {x: -23, y: y - 2, w: 2, d: 2, r: 0.2}, 5, 0.8, 'hi');
}
slab('gate-crosshead', 'Crosshead ties both vertical guides together', {x: -23, y: -28, w: 14, d: 57, r: 1}, 62, 6, 'hi');
slab('approval-gate', 'Raised only when the saved approved request may be claimed', {x: -16, y: -19, w: 4, d: 39, r: 0.7}, 5, 21, 'hi', true);
slab('gate-handle', 'Grip moves together with the approval gate', {x: -19, y: -5, w: 10, d: 11, r: 0.8}, 26, 4, 'mid', true);

// Output tray receives either the original request or a saved result, never both.
slab('output-floor', 'Receiving platen supports the outgoing paper', {x: 65, y: -42, w: 92, d: 80, r: 2}, 0, 4);
slab('output-back', 'Rear fence registers the outgoing paper', {x: 65, y: -42, w: 92, d: 3, r: 0.4}, 4, 8);
for (const [i, x] of [65, 154].entries()) slab(`output-wall-${i}`, 'Side wall retains the request or receipt', {x, y: -39, w: 3, d: 77, r: 0.4}, 4, 6);
slab('output-paper', 'Shows the payload eligible for execution or returned result', {x: 73, y: -31, w: 76, d: 59, r: 0.3}, 4, 0.8, 'hi');
for (const [i, y] of [-20, 14].entries()) slab(`output-clip-${i}`, 'Retainer touches the receiving paper edge', {x: 69, y, w: 6, d: 6, r: 0.4}, 4.8, 1);

// Separate proposal rest makes the discarded model input visually inspectable.
slab('proposal-rest', 'Separate rest carries the new model proposal', {x: -148, y: 61, w: 269, d: 29, r: 2}, 0, 3, 'lo');
slab('proposal-backstop', 'Registers the new proposal without touching the archive', {x: -148, y: 61, w: 269, d: 2, r: 0.4}, 3, 3);
slab('proposal-paper', 'Newly proposed recipient stays outside the approved payload', {x: -139, y: 66, w: 249, d: 18, r: 0.3}, 3, 0.8, 'hi');
export const PAPER = {
  saved: topMatrix([-147, -31], 4.85, PROJECTION),
  output: topMatrix([73, -31], 4.85, PROJECTION),
  proposal: topMatrix([-139, 66], 3.85, PROJECTION),
};
export const GATE_OPEN = translateAlong(PROJECTION, [0, 0, 31]);
// Painter keys solved from these exact slabs at closed, open and three intermediate poses.
export const DEPTH_KEYS: Record<string, number> = {
  "foot-0": -105.3305,
  "riser-0": -102.3116,
  "bed-screw-0": 98.8632,
  "archive-clip-0": 98.9032,
  "archive-back": 98.8832,
  "archive-left": 98.9032,
  "archive-clip-1": 98.9032,
  "archive-floor": 98.8632,
  "saved-paper": 98.8832,
  "rail-in-0": 98.8832,
  "foot-2": -23.1064,
  "riser-2": -20.0876,
  "handle-mount-0": 98.9432,
  "gate-bolt-0": 98.9232,
  "gate-foot-0": 98.9032,
  "archive-front": 98.9232,
  "archive-right": 98.9432,
  "bed-screw-2": 98.8632,
  "archive-handle": 98.9632,
  "handle-mount-1": 98.9432,
  "rail-in-1": 98.8832,
  "rail-out-0": 98.9232,
  "bed": 98.8432,
  "gate-bolt-1": 98.9232,
  "approval-gate": 98.9632,
  "gate-post-0": 98.9432,
  "gate-foot-1": 98.9032,
  "foot-1": 13.5803,
  "gate-handle": 98.9832,
  "riser-1": 16.5992,
  "output-clip-0": 98.9832,
  "bed-screw-1": 98.8632,
  "rail-out-1": 98.9232,
  "output-back": 98.9632,
  "output-wall-0": 98.9832,
  "gate-post-1": 122.3792,
  "proposal-backstop": 98.8832,
  "proposal-rest": 98.8632,
  "proposal-paper": 98.8832,
  "output-clip-1": 98.9832,
  "output-floor": 98.9432,
  "gate-crosshead": 122.3992,
  "output-paper": 98.9632,
  "output-wall-1": 98.9832,
  "foot-3": 95.8044,
  "riser-3": 98.8232,
  "bed-screw-3": 112.5318
};
export const PARTS = parts.slice().sort((a, b) => DEPTH_KEYS[a.name]! - DEPTH_KEYS[b.name]!);
export function partsForGate(open: boolean) {
  const lift = depthOf([0, 0, 31], PROJECTION);
  return open ? PARTS.slice().sort((a, b) => (DEPTH_KEYS[a.name]! + (a.moving ? lift : 0)) - (DEPTH_KEYS[b.name]! + (b.moving ? lift : 0))) : PARTS;
}
export const PART_COUNT = PARTS.length;
