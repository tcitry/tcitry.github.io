import {boxCorners, corners, depthOf, fitProjection, haloOf, slabOf, type Plan, type Point3, type SolidPaths, type Tone} from './anatomy-iso-kit';
import type {StyleBridgeState} from './headless-style-bridge-model';

export const BRIDGE_WIDTH = 720;
export const BRIDGE_HEIGHT = 320;
const BASE: Plan = {x: -154, y: -59, w: 308, d: 118, r: 5};
export const BRIDGE_PROJECTION = fitProjection(boxCorners(BASE, -13, 35), BRIDGE_WIDTH, BRIDGE_HEIGHT, {pad: 25, azimuth: 67, elevation: 48});
export const BRIDGE_HALO = haloOf(BASE, -12, 6, BRIDGE_PROJECTION);

export interface BridgePart {
  name: string;
  paths: SolidPaths;
  tone: Tone;
  tier: number;
  depth: number;
  plan: Plan;
  z: number;
  height: number;
  signal?: 'checked' | 'mixed';
  stage?: 'input' | 'adapter' | 'output';
  moving?: boolean;
}

const parts: BridgePart[] = [];
function add(name: string, plan: Plan, z: number, height: number, tier: number, tone: Tone = 'mid', extra: Partial<BridgePart> = {}) {
  const center: Point3 = [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2];
  parts.push({name, paths: slabOf(plan, z, height, BRIDGE_PROJECTION, 5, height > 1 ? 0.4 : 0), tone, tier, depth: depthOf(center, BRIDGE_PROJECTION), plan, z, height, ...extra});
}
// 4 feet, base, edge rails and corner screws: every upper assembly sits on this deck.
for (const [i, [x, y]] of corners(BASE, 16).entries()) add(`base.foot-${i}`, {x: x - 6, y: y - 5, w: 12, d: 10, r: 2}, -12, 5, 0, 'lo');
add('base.deck', BASE, -7, 7, 1, 'lo');
for (const [i, y] of [-53, 49].entries()) add(`base.edge-${i}`, {x: -146, y, w: 292, d: 4, r: 1}, 0, 2, 2, 'lo');
for (const [i, [x, y]] of corners(BASE, 9).entries()) add(`base.screw-${i}`, {x: x - 1.3, y: y - 1.3, w: 2.6, d: 2.6, r: 0.6}, 2, 0.7, 3, 'hi');

// Two independent lanes: source terminal, conductive tracks, adapter contacts, receiver.
for (const [signal, y] of [['checked', -21], ['mixed', 21]] as const) {
  const channel = {signal};
  add(`${signal}.source-bed`, {x: -139, y: y - 15, w: 48, d: 30, r: 2}, 0, 4, 2, 'mid');
  add(`${signal}.source-shell`, {x: -132, y: y - 10, w: 34, d: 20, r: 2}, 4, 4, 3, 'hi');
  add(`${signal}.input-pad`, {x: -126, y: y - 5, w: 22, d: 10, r: 1}, 8, 2, 4, 'hi', {...channel, stage: 'input'});
  add(`${signal}.input-track`, {x: -91, y: y - 2, w: 56, d: 4, r: 0.5}, 0, 1.2, 2, 'hi', {...channel, stage: 'input'});
  for (const [i, x] of [-136, -96].entries()) add(`${signal}.source-screw-${i}`, {x, y: y + 10, w: 2, d: 2, r: 0.4}, 4, 0.7, 4, 'hi');
  for (const [i, x] of [-35, 22].entries()) {
    add(`${signal}.socket-${i}`, {x, y: y - 10, w: 13, d: 20, r: 1.5}, 0, 5, 2, 'mid');
    add(`${signal}.contact-${i}`, {x: x + 3, y: y - 5, w: 7, d: 10, r: 0.5}, 5, 2, 3, 'hi', {...channel, stage: i === 0 ? 'input' : 'adapter'});
  }
  // A flat removable jumper with contact shoes; its lift opens both contacts.
  add(`${signal}.jumper`, {x: -28, y: y - 3, w: 57, d: 6, r: 1}, 7, 2, 4, 'hi', {...channel, stage: 'adapter', moving: true});
  add(`${signal}.jumper-grip`, {x: -10, y: y - 7, w: 20, d: 14, r: 2}, 9, 5, 5, 'mid', {moving: true});
  add(`${signal}.grip-inlay`, {x: -7, y: y - 1, w: 14, d: 2, r: 0.5}, 14, 0.4, 6, 'lo', {moving: true});
  add(`${signal}.output-track`, {x: 35, y: y - 2, w: 55, d: 4, r: 0.5}, 0, 1.2, 2, 'hi', {...channel, stage: 'output'});
  add(`${signal}.receiver-bed`, {x: 90, y: y - 15, w: 49, d: 30, r: 2}, 0, 4, 2, 'mid');
  add(`${signal}.receiver-rim`, {x: 96, y: y - 10, w: 36, d: 20, r: 2}, 4, 3, 3, 'hi');
  add(`${signal}.receiver-contact`, {x: 102, y: y - 5, w: 24, d: 10, r: 1}, 7, 1, 4, 'hi', {...channel, stage: 'output'});
  for (const [i, x] of [93, 134].entries()) add(`${signal}.receiver-screw-${i}`, {x, y: y + 10, w: 2, d: 2, r: 0.4}, 4, 0.7, 4, 'hi');
}
// Four visible stops seat the removable jumpers; the scale rail identifies their two lanes.
for (const [i, [x, y]] of [[-17, -41], [12, -41], [-17, 35], [12, 35]].entries()) {
  add(`adapter.stop-${i}`, {x, y, w: 5, d: 6, r: 1}, 0, 8, 2, 'mid');
  add(`adapter.stop-screw-${i}`, {x: x + 1.5, y: y + 1.5, w: 2, d: 2, r: 0.3}, 8, 0.6, 3, 'hi');
}
add('nameplate.mount', {x: -39, y: 42, w: 78, d: 5, r: 1}, 0, 0.8, 2, 'lo');
for (const [i, x] of [-35, 33].entries()) add(`nameplate.rivet-${i}`, {x, y: 43, w: 2, d: 2, r: 0.4}, 0.8, 0.4, 3, 'hi');

export const BRIDGE_PARTS = parts.sort((a, b) => a.tier - b.tier || a.depth - b.depth);
export const BRIDGE_PART_COUNT = BRIDGE_PARTS.length;
export function bridgePartActive(part: BridgePart, state: StyleBridgeState) {
  const source = part.signal === 'checked' ? state.effectiveChecked : state.indeterminate;
  if (!part.stage) return false;
  if (part.stage === 'input') return source;
  if (part.stage === 'adapter') return source && state.mapping;
  return part.signal === 'checked' ? state.selectedMatch : state.mixedMatch;
}
