import {boxCorners, corners, cylinder, depthOf, fitProjection, haloOf, lineOnTop, slabOf, topTicks, type Plan, type Point3, type SolidPaths, type Tone} from './anatomy-iso-kit';
import {DAY_START, availabilityAt, type AvailabilityInput, type MinuteRange} from './cal-diy-availability-model';

export const WIDTH = 720;
export const HEIGHT = 335;
const BASE: Plan = {x: -171, y: -68, w: 342, d: 146, r: 5};
export const PROJECTION = fitProjection(boxCorners(BASE, -16, 8), WIDTH, HEIGHT, {pad: 28, azimuth: 77, elevation: 59});
export const SHADOW = haloOf(BASE, -15, 1, PROJECTION);
export interface BoardPart {
  name: string; paths: SolidPaths; tone: Tone; center: Point3; depthKey: number; lit?: boolean;
  shape: {kind: 'slab'; plan: Plan; z: number; height: number; steps: number} | {kind: 'cylinder'; x: number; y: number; radius: number; z: number; height: number};
  line?: string; inactive?: boolean;
}
function slab(name: string, plan: Plan, z: number, height: number, tone: Tone = 'mid'): BoardPart {
  const center: Point3 = [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2];
  return {name, paths: slabOf(plan, z, height, PROJECTION, 6, height >= 2 ? 0.35 : 0), tone, center, depthKey: depthOf(center, PROJECTION), shape: {kind: 'slab', plan, z, height, steps: 6}};
}
function round(name: string, x: number, y: number, radius: number, z: number, height: number, tone: Tone = 'mid'): BoardPart {
  const center: Point3 = [x, y, z + height / 2];
  return {name, paths: cylinder(x, y, radius, z, height, PROJECTION, 48, 0), tone, center, depthKey: depthOf(center, PROJECTION), shape: {kind: 'cylinder', x, y, radius, z, height}};
}
export const ROWS = {source: -44, busyA: -16, busyB: 12, remaining: 40};
const fixed: BoardPart[] = [];
for (const [i, [x, y]] of corners(BASE, 16).entries()) {
  fixed.push(round(`stand.foot-${i}`, x, y, 5.5, -15, 3, 'lo'));
  fixed.push(round(`foot.riser-${i}`, x, y, 4, -12, 4, 'lo'));
}
fixed.push(slab('board.base', BASE, -8, 8, 'lo'));
for (const [i, [x, y]] of corners(BASE, 8).entries()) fixed.push(round(`board.bolt-${i}`, x, y, 1.4, 0, 0.7, 'hi'));
for (const [name, y] of Object.entries(ROWS)) {
  fixed.push(slab(`${name}.bed`, {x: -157, y: y - 10, w: 314, d: 20, r: 0}, 0, 1, 'lo'));
  for (const [i, offset] of [-10, 8.5].entries()) fixed.push(slab(`${name}.edge-${i}`, {x: -150, y: y + offset, w: 300, d: 1.5, r: 0}, 1, 1.2, 'mid'));
  for (const [i, x] of [-157, 150].entries()) {
    fixed.push(slab(`${name}.stop-${i}`, {x, y: y - 10, w: 7, d: 20, r: 0}, 1, 3, 'mid'));
    fixed.push(round(`${name}.stop-bolt-${i}`, x + 3.5, y, 1.2, 4, 0.6, 'hi'));
  }
}
const ruler = slab('ruler.strip', {x: -150, y: 61, w: 300, d: 7, r: 0}, 0, 0.5, 'hi');
const ticks = topTicks(-150, 150, 7.5, 4, 61, 0.5, [2.3, 5.5], PROJECTION);
ruler.line = `${ticks.minor}${ticks.major}${lineOnTop([-150, 61], [150, 61], 0.5, PROJECTION)}`;
fixed.push(ruler);
// Each wide surface precedes the solids it supports even when their centres
// are farther from the camera. These tiers follow the physical support tree.
const baseKey = Math.max(...fixed.filter(part => part.name.startsWith('foot.riser-')).map(part => part.depthKey)) + 0.02;
for (const part of fixed) {
  const tier = part.name === 'board.base' ? 0
    : part.name.endsWith('.bed') || part.name === 'ruler.strip' || part.name.startsWith('board.bolt-') ? 1
    : part.name.includes('.stop-bolt-') ? 3
    : part.name.includes('.edge-') || part.name.includes('.stop-') ? 2 : -1;
  if (tier >= 0) part.depthKey = Math.max(part.depthKey, baseKey + tier * 0.02);
}
export const STATIC_PARTS = fixed;
export const xAt = (minute: number) => -150 + (minute - DAY_START) / 2;
function strip(name: string, range: MinuteRange, row: number, lit = false) {
  const part = slab(name, {x: xAt(range.start), y: row - 7, w: (range.end - range.start) / 2, d: 14, r: 0}, 1, 3, 'hi');
  part.lit = lit;
  part.depthKey = Math.max(part.depthKey, baseKey + 0.04);
  return part;
}
/** Shared minutes produce both the strip positions and the printed readouts. */
export function boardAt(input: AvailabilityInput) {
  const frame = availabilityAt(input);
  const parts = [...STATIC_PARTS, strip('source.interval', frame.source, ROWS.source)];
  for (const busy of frame.busy) {
    if (busy.end <= busy.start) continue;
    const part = strip(`busy.${busy.id}`, busy, busy.id === 'A' ? ROWS.busyA : ROWS.busyB);
    part.inactive = !frame.applied.some(range => range.id === busy.id);
    parts.push(part);
  }
  for (const [i, range] of frame.remaining.entries()) parts.push(strip(`remaining.${i}`, range, ROWS.remaining, true));
  // Flat, separated rows never change their depth relationship. Parts sit on
  // the bed; height is only 3 units, so a strip cannot obscure another lane.
  parts.sort((a, b) => a.depthKey - b.depthKey);
  return {frame, parts};
}
