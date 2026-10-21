import {boxCorners, corners, depthOf, extrude, fitProjection, haloOf, insetPlan, iso, pathOf, planOutline, slabOf, translateAlong} from './anatomy-iso-kit';
import type {Plan, Point3, SolidPaths, Tone} from './anatomy-iso-kit';

/** A read-only archive and a gantry making one working copy, not emptying storage. */
export const REPLAY_WIDTH = 760;
export const REPLAY_HEIGHT = 430;
const BED: Plan = {x: -174, y: -101, w: 348, d: 208, r: 9};
export const REPLAY_PROJECTION = fitProjection([
  ...boxCorners(BED, -16, 0),
  ...boxCorners({x: -151, y: -87, w: 302, d: 164, r: 2}, 0, 69),
], REPLAY_WIDTH, REPLAY_HEIGHT, {pad: 25, azimuth: 56, elevation: 40});
export const replayAt = (point: Point3) => iso(point, REPLAY_PROJECTION);
export const replayMove = (point: Point3) => translateAlong(REPLAY_PROJECTION, point);
export const REPLAY_HALO = haloOf(BED, -15, 7, REPLAY_PROJECTION);
export const REPLAY_BED_GROOVE = planOutline(insetPlan(BED, 5), .1, REPLAY_PROJECTION);
export type ReplayMotionPart = {name: string; purpose: string; paths: SolidPaths; tone: Tone; center: Point3; plan: Plan; z: number; height: number};
function makePart(name: string, purpose: string, plan: Plan, z: number, height: number, tone: Tone = 'mid'): ReplayMotionPart {
  return {name, purpose, plan, z, height, tone, center: [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2],
    paths: slabOf(plan, z, height, REPLAY_PROJECTION, 6, height > 2 ? 0.55 : 0)};
}
const parts: ReplayMotionPart[] = [];
const add = (name: string, purpose: string, plan: Plan, z: number, height: number, tone: Tone = 'mid') => parts.push(makePart(name, purpose, plan, z, height, tone));
for (const [index, [x, y]] of corners(BED, 16).entries()) {
  add(`foot-${index}`, 'Rubber foot grounds the archive mechanism', {x: x - 6, y: y - 6, w: 12, d: 12, r: 2}, -16, 4, 'lo');
  add(`standoff-${index}`, 'Bed standoff sits on the foot', {x: x - 4, y: y - 4, w: 8, d: 8, r: 1}, -12, 5, 'mid');
}
add('bed', 'Milled bed registers all four stations and the isolated proposal rail', BED, -7, 7, 'lo');
for (const [index, [x, y]] of corners(BED, 9).entries()) add(`bed-fastener-${index}`, 'Countersunk bed fastener', {x: x - 1.3, y: y - 1.3, w: 2.6, d: 2.6, r: .5}, 0, .8, 'hi');

// Two low archive readers retain their originals throughout the cycle.
for (const [label, cy] of [['request', -4], ['receipt', -66]] as const) {
  add(`${label}-reader-floor`, 'Read-only original rests in the archive bed', {x: -151, y: cy - 23, w: 69, d: 46, r: 3}, 0, 4, 'mid');
  add(`${label}-reader-back`, 'Back register aligns the original for scanning', {x: -151, y: cy - 25, w: 69, d: 2, r: .5}, 4, 9, 'lo');
  add(`${label}-reader-left`, 'Side register locates the retained original', {x: -151, y: cy - 23, w: 2, d: 46, r: .4}, 4, 6, 'mid');
  add(`${label}-reader-right`, 'Side register locates the retained original', {x: -84, y: cy - 23, w: 2, d: 46, r: .4}, 4, 6, 'mid');
  add(`${label}-reader-front`, 'Front edge supports the original without obscuring its identity', {x: -149, y: cy + 21, w: 65, d: 2, r: .4}, 4, 3, 'hi');
}

// A separate intake has its own end stop. It never meets either archive route.
add('proposal-bed', 'New model proposal has an independent input rail', {x: -151, y: 48, w: 116, d: 42, r: 3}, 0, 4, 'lo');
for (const [index, y] of [48, 88].entries()) add(`proposal-guide-${index}`, 'Guide holds the new proposal on its isolated rail', {x: -151, y, w: 116, d: 2, r: .5}, 4, 5, 'mid');
add('proposal-end-stop', 'Hard stop prevents a new proposal reaching an approved execution route', {x: -37, y: 50, w: 5, d: 38, r: 1}, 4, 16, 'hi');

// Gantry hardware: two x-rails, four supports, a translating bridge and a pick head.
for (const [index, y] of [-92, 97].entries()) {
  add(`travel-rail-${index}`, 'Linear guide supports the copy shuttle above the storage plane', {x: -158, y, w: 310, d: 5, r: .8}, 48, 4, 'hi');
  for (const [end, x] of [-158, 145].entries()) {
    add(`guide-support-${index}-${end}`, 'Upright supports the rail without intersecting request paths', {x, y: y - 2, w: 7, d: 9, r: .8}, 0, 48, 'lo');
    add(`guide-shoe-${index}-${end}`, 'Support foot bolts the upright to the bed', {x: x - 3, y: y - 5, w: 13, d: 15, r: 1.2}, 0, 4, 'mid');
  }
}

// Output bays are physically different paths: execution, direct return, review.
for (const [label, y] of [['execution', -4], ['return', -66], ['review', 66]] as const) {
  add(`${label}-platen`, 'Destination registers one read copy or saved receipt', {x: 87, y: y - 23, w: 66, d: 46, r: 3}, 0, 5, label === 'review' ? 'lo' : 'mid');
  add(`${label}-back`, 'Destination back register keeps the copy within the bay', {x: 87, y: y - 25, w: 66, d: 2, r: .5}, 5, 7, 'lo');
  for (const [side, x] of [87, 151].entries()) add(`${label}-fence-${side}`, 'Side fence aligns the outgoing copy', {x, y: y - 23, w: 2, d: 46, r: .5}, 5, 5, 'mid');
}

export const REPLAY_STATIC_PARTS = parts.sort((a, b) => depthOf(a.center, REPLAY_PROJECTION) - depthOf(b.center, REPLAY_PROJECTION));

export const REPLAY_CARRIAGE_PARTS = [
  makePart('bridge', 'Cross rail moves as one gantry bridge', {x: -7, y: -84, w: 14, d: 178, r: 2}, 52, 5, 'hi'),
  makePart('bridge-rear-shoe', 'Rear shoe follows the travel rail', {x: -10, y: -94, w: 20, d: 10, r: 1.5}, 52, 7, 'mid'),
  makePart('bridge-front-shoe', 'Front shoe follows the travel rail', {x: -10, y: 94, w: 20, d: 10, r: 1.5}, 52, 7, 'mid'),
];
export const REPLAY_HEAD_PARTS = [
  makePart('head-slider', 'Head slides across the gantry bridge to the selected source lane', {x: -12, y: -11, w: 24, d: 22, r: 2}, 57, 9, 'mid'),
  makePart('head-neck', 'Vertical drive lifts the read copy clear of the retained original', {x: -4, y: -4, w: 8, d: 8, r: 1}, 31, 26, 'hi'),
  makePart('head-tip', 'Pickup pad follows the copy during transport', {x: -8, y: -7, w: 16, d: 14, r: 1.5}, 28, 3, 'mid'),
];
export function replayPickupNeck(extension: number) {
  return slabOf({x: -4, y: -4, w: 8, d: 8, r: 1}, 31 - extension, 26 + extension, REPLAY_PROJECTION, 6, .55);
}
export const REPLAY_CLAMP_LEFT = makePart('pickup-left', 'Left pickup jaw closes around a working copy only', {x: -27, y: -5, w: 4, d: 10, r: 1}, 20, 8, 'hi');
export const REPLAY_CLAMP_RIGHT = makePart('pickup-right', 'Right pickup jaw closes around a working copy only', {x: 23, y: -5, w: 4, d: 10, r: 1}, 20, 8, 'hi');

// Same three-field carrier at origin. Notch identity is preserved on every copy.
export const REQUEST_TOKEN = [
  makePart('request-carrier', 'Read copy carries all saved request fields together', {x: -23, y: -14, w: 46, d: 28, r: 2}, 0, 3, 'hi'),
  ...[-8, 0, 8].map((y, index) => makePart(`request-field-${index}`, 'One of the three saved request fields; fixed dimensions do not encode string length', {x: -16, y: y - 2, w: 32, d: 4, r: .6}, 3, .8, 'mid')),
];
export const RECEIPT_TOKEN = [
  makePart('receipt-carrier', 'Smaller receipt is a saved result, not an executable request', {x: -18, y: -10, w: 36, d: 20, r: 1.5}, 0, 2, 'hi'),
  makePart('receipt-proof', 'Two marks identify the retained receipt', {x: -12, y: -4, w: 24, d: 3, r: .4}, 2, .7, 'mid'),
  makePart('receipt-id', 'Saved receipt identifier remains visible on its working copy', {x: -12, y: 3, w: 14, d: 3, r: .4}, 2, .7, 'mid'),
];
export const REVIEW_TOKEN = [
  makePart('review-carrier', 'Uncertain outcome marker is routed to verification, never into the tool', {x: -13, y: -11, w: 26, d: 22, r: 2}, 0, 3, 'hi'),
  {...makePart('review-marker', 'One embossed cross marks the outcome for verification', {x: -7, y: -7, w: 14, d: 14, r: 0}, 3, .8, 'mid'),
    paths: extrude([[-2,-7],[2,-7],[2,-2],[7,-2],[7,2],[2,2],[2,7],[-2,7],[-2,2],[-7,2],[-7,-2],[-2,-2]], 3, .8, REPLAY_PROJECTION, {convex:false})},
];
export const SOURCE_REQUEST: Point3 = [-117, -4, 4];
export const SOURCE_RECEIPT: Point3 = [-117, -66, 4];
export const SOURCE_PROPOSAL: Point3 = [-117, 69, 4];
export const SOURCE_REVIEW: Point3 = [-117, -4, 10];
export const DEST_EXECUTION: Point3 = [120, -4, 5];
export const DEST_RETURN: Point3 = [120, -66, 5];
export const DEST_REVIEW: Point3 = [120, 66, 5];
export const REPLAY_PART_COUNT = parts.length + REPLAY_CARRIAGE_PARTS.length + REPLAY_HEAD_PARTS.length + 2 + REQUEST_TOKEN.length * 3 + RECEIPT_TOKEN.length * 2 + REVIEW_TOKEN.length + 3;

/** Three hinged receiver lids; all vertices are reprojected at the actual angle. */
export function receiverCover(cy: number, openness: number) {
  const angle = Math.max(0, Math.min(1, openness)) * Math.PI * 70 / 180;
  const point = (x: number, d: number, thickness: number): Point3 => [x, cy - 23 + d * Math.cos(angle) - thickness * Math.sin(angle), 10 + d * Math.sin(angle) + thickness * Math.cos(angle)];
  const top = [point(86, 0, 1.2), point(154, 0, 1.2), point(154, 42, 1.2), point(86, 42, 1.2)];
  const lower = [point(86, 0, 0), point(154, 0, 0), point(154, 42, 0), point(86, 42, 0)];
  const poly = (points: Point3[]) => pathOf(points.map(replayAt), true);
  const topFacing = Math.cos(angle) * Math.sin(40 * Math.PI / 180) - Math.sin(angle) * Math.sin(56 * Math.PI / 180) * Math.cos(40 * Math.PI / 180) >= 0;
  return {top: poly(topFacing ? top : lower), front: poly([top[2], top[3], lower[3], lower[2]]), side: poly([top[1], top[2], lower[2], lower[1]])};
}
