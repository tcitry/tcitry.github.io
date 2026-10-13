import {
  boxCorners, corners, depthOf, fitProjection, haloOf, insetPlan, iso,
  lineOnTop, planOutline, sideSeam, slabOf, topMatrix, topTicks,
  type Plan, type Point3, type SolidPaths, type Tone,
} from './anatomy-iso-kit';

export const COMPOSER_WIDTH = 800;
export const COMPOSER_HEIGHT = 340;
const BASE: Plan = {x: -210, y: -64, w: 430, d: 144, r: 6};
export const COMPOSER_PROJECTION = fitProjection([
  ...boxCorners(BASE, -13, 0), ...boxCorners({x: -68, y: -48, w: 116, d: 104, r: 0}, 0, 49),
], COMPOSER_WIDTH, COMPOSER_HEIGHT, {pad: 25, azimuth: 70, elevation: 35});
const P = COMPOSER_PROJECTION;
export const COMPOSER_HALO = haloOf(BASE, -13, 2, P);
export interface ComposerPart {
  name: string; paths: SolidPaths; plan: Plan; z: number; height: number; key: number;
  tone: Tone; family: 'base' | 'input' | 'contract' | 'output' | 'selector';
  lines: Array<{d: string; faint?: boolean}>; screws: Array<[number, number]>;
}
const parts: ComposerPart[] = [];
function slab(name: string, plan: Plan, z: number, height: number, family: ComposerPart['family'], tone: Tone = 'mid') {
  const part: ComposerPart = {name, plan, z, height, family, tone,
    paths: slabOf(plan, z, height, P, 5, height > 2 ? 0.5 : 0),
    key: depthOf([plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2], P), lines: [], screws: []};
  parts.push(part);return part;
}
function bolts(part: ComposerPart, inset = 3) {
  part.screws.push(...corners(part.plan, inset).map(([x, y]) => iso([x, y, part.z + part.height + 0.03], P)));
}
function mountingFeet(name: string, plan: Plan) {
  for (const [i, [x, y]] of corners(plan, 8).entries()) slab(`${name}.mount-${i}`, {x: x - 3, y: y - 3, w: 6, d: 6, r: 1}, 0, 4, name as 'input' | 'contract' | 'output', 'lo');
}
for (const [i, [x, y]] of corners(BASE, 19).entries()) {
  slab(`base.foot-${i}`, {x: x - 7, y: y - 7, w: 14, d: 14, r: 3}, -13, 2, 'base', 'lo');
  slab(`base.riser-${i}`, {x: x - 5, y: y - 5, w: 10, d: 10, r: 2}, -11, 3, 'base', 'lo');
}
const base = slab('base.plate', BASE, -8, 8, 'base', 'lo');
base.lines.push({d: sideSeam(BASE, -4, P, 5), faint: true}, {d: planOutline(insetPlan(BASE, 5), 0.03, P, 5), faint: true});
for (const [i, [x, y]] of corners(BASE, 11).entries()) {
  const bolt = slab(`base.bolt-${i}`, {x: x - 1, y: y - 1, w: 2, d: 2, r: 0.3}, 0, 0.5, 'base', 'hi');
  bolt.lines.push({d: lineOnTop([x - 0.7, y], [x + 0.7, y], 0.53, P)});
}
const ruler = slab('base.ruler', {x: -185, y: 68, w: 377, d: 6, r: 0.3}, 0, 0.4, 'base', 'lo');
const ticks = topTicks(-181, 188, 5, 5, 68.05, 0.43, [1.8, 3.6], P);
ruler.lines.push({d: ticks.minor, faint: true}, {d: ticks.major});

// An input feed tray: every removable slip is held down by a spring clip.
const INPUT: Plan = {x: -195, y: -51, w: 104, d: 110, r: 2};
mountingFeet('input', INPUT);
const inputFloor = slab('input.floor', INPUT, 4, 2, 'input');bolts(inputFloor, 5);
slab('input.back', {x: -195, y: -51, w: 104, d: 3, r: 0}, 6, 5, 'input');
slab('input.left', {x: -195, y: -48, w: 3, d: 107, r: 0}, 6, 5, 'input');
slab('input.right', {x: -94, y: -48, w: 3, d: 107, r: 0}, 6, 5, 'input');
slab('input.front', {x: -192, y: 56, w: 98, d: 3, r: 0}, 6, 3, 'input');
export const INPUT_PRINTS = [-42, -20, 2, 24].map((y, index) => {
  slab(`input.slip-${index}`, {x: -188, y, w: 90, d: 18, r: 0.7}, 6, 0.6, 'input', 'hi');
  const clip = slab(`input.clip-${index}`, {x: -190, y: y + 5, w: 5, d: 7, r: 0.5}, 6.6, 1, 'input');
  clip.screws.push(iso([-187.5, y + 8.5, 7.63], P));
  return {name: `input.slip-${index}`, transform: topMatrix([-185, y + 2], 6.64, P), width: 84, height: 14};
});

// A small component die press: three registered dies, one selection carriage.
const CONTRACT: Plan = {x: -69, y: -48, w: 118, d: 106, r: 2};
mountingFeet('contract', CONTRACT);
const contractFloor = slab('contract.floor', CONTRACT, 4, 2, 'contract');bolts(contractFloor, 5);
for (const [i, [x, y]] of [[-64, -44], [42, -44], [-64, 47], [42, 47]].entries()) {
  slab(`contract.post-shoe-${i}`, {x: x - 3, y: y - 3, w: 6, d: 6, r: 1}, 6, 2, 'contract');
  slab(`contract.post-${i}`, {x: x - 1.5, y: y - 1.5, w: 3, d: 3, r: 0.5}, 8, 35, 'contract');
}
const beam = slab('contract.press-beam', {x: -68, y: -47, w: 114, d: 6, r: 1}, 43, 5, 'contract');bolts(beam, 3);
export const DIE_PRINTS = [-58, -24, 10].map((x, index) => {
  const die = slab(`contract.die-${index}`, {x, y: -32, w: 27, d: 45, r: 1}, 6, 2, 'contract');bolts(die, 2);
  slab(`contract.contract-card-${index}`, {x: x + 2, y: -28, w: 23, d: 35, r: 0.4}, 8, 0.5, 'contract', 'hi');
  return {name: `contract.contract-card-${index}`, transform: topMatrix([x + 4, -25], 8.55, P), width: 19, height: 29};
});
for (const [i, y] of [21, 34].entries()) {
  const rail = slab(`contract.rail-${i}`, {x: -61, y, w: 96, d: 3, r: 0.5}, 6, 3, 'contract');
  rail.lines.push({d: lineOnTop([-61, y + 1.5], [35, y + 1.5], 9.03, P), faint: true});
}
for (const [i, x] of [-66, 35].entries()) {
  const stop = slab(`contract.stop-${i}`, {x, y: 19, w: 5, d: 20, r: 0.4}, 6, 5, 'contract');bolts(stop, 1.8);
}
slab('selector.carriage', {x: -57, y: 20, w: 21, d: 18, r: 1}, 9, 2, 'selector', 'hi');
slab('selector.handle-neck', {x: -51, y: 38, w: 8, d: 3, r: 0.3}, 9, 2, 'selector');
const handle = slab('selector.handle', {x: -54, y: 41, w: 14, d: 4, r: 1}, 9, 2, 'selector', 'hi');
handle.lines.push({d: lineOnTop([-54, 43], [-40, 43], 11.03, P), faint: true});

// The output plate is an inset screen supported by a solid surround and clips.
const OUTPUT: Plan = {x: 76, y: -50, w: 128, d: 112, r: 2};
mountingFeet('output', OUTPUT);
const outputFloor = slab('output.floor', OUTPUT, 4, 2, 'output');bolts(outputFloor, 5);
for (const [i, [x, y]] of corners({x: 82, y: -44, w: 116, d: 100, r: 0}, 4).entries()) {
  slab(`output.screen-spacer-${i}`, {x: x - 2, y: y - 2, w: 4, d: 4, r: 0.5}, 6, 2, 'output');
}
slab('output.screen', {x: 82, y: -44, w: 116, d: 100, r: 1}, 8, 1, 'output', 'hi');
slab('output.back-frame', {x: 76, y: -50, w: 128, d: 6, r: 1}, 6, 5, 'output');
slab('output.left-frame', {x: 76, y: -44, w: 6, d: 100, r: 0}, 6, 5, 'output');
slab('output.right-frame', {x: 198, y: -44, w: 6, d: 100, r: 0}, 6, 5, 'output');
slab('output.front-frame', {x: 76, y: 56, w: 128, d: 6, r: 1}, 6, 5, 'output');
for (const [i, x] of [79, 198].entries()) {
  const clip = slab(`output.retain-clip-${i}`, {x, y: -8, w: 3, d: 12, r: 0.3}, 11, 0.7, 'output');
  clip.screws.push(iso([x + 1.5, -2, 11.74], P));
}
export const OUTPUT_PRINT = {name: 'output.screen', transform: topMatrix([87, -39], 9.05, P), width: 106, height: 90};
export const SELECTOR_OFFSET = (position: number): Point3 => [position * 34, 0, 0];
// Exact recorded slabs: Anatomy audit passed at 9 positions over the full 68-unit travel.
const AUDITED_DEPTHS: Record<string, number> = {
  "base.foot-0": -95.03351956792311,
  "base.riser-0": -93.5995784770455,
  "base.foot-1": 14.791748272625231,
  "base.riser-1": 16.225689363502845,
  "base.foot-2": -13.43989964799706,
  "base.riser-2": -12.005958557119445,
  "base.foot-3": 96.3853681925513,
  "base.riser-3": 97.81930928342891,
  "base.plate": 97.8393092834289,
  "base.bolt-0": 97.8593092834289,
  "base.bolt-1": 97.8593092834289,
  "base.bolt-2": 97.8593092834289,
  "base.bolt-3": 111.81102058515796,
  "base.ruler": 97.8593092834289,
  "input.mount-0": 97.8593092834289,
  "input.mount-1": 97.8593092834289,
  "input.mount-2": 97.8593092834289,
  "input.mount-3": 97.8593092834289,
  "input.floor": 97.8793092834289,
  "input.back": 97.89930928342889,
  "input.left": 97.91930928342889,
  "input.right": 97.95930928342888,
  "input.front": 97.93930928342888,
  "input.slip-0": 97.89930928342889,
  "input.clip-0": 97.91930928342889,
  "input.slip-1": 97.89930928342889,
  "input.clip-1": 97.91930928342889,
  "input.slip-2": 97.89930928342889,
  "input.clip-2": 97.91930928342889,
  "input.slip-3": 97.89930928342889,
  "input.clip-3": 97.91930928342889,
  "contract.mount-0": 97.8593092834289,
  "contract.mount-1": 97.8593092834289,
  "contract.mount-2": 97.8593092834289,
  "contract.mount-3": 97.8593092834289,
  "contract.floor": 97.8793092834289,
  "contract.post-shoe-0": 97.89930928342889,
  "contract.post-0": 97.91930928342889,
  "contract.post-shoe-1": 97.89930928342889,
  "contract.post-1": 97.91930928342889,
  "contract.post-shoe-2": 97.89930928342889,
  "contract.post-2": 97.91930928342889,
  "contract.post-shoe-3": 97.89930928342889,
  "contract.post-3": 117.0106312557689,
  "contract.press-beam": 97.93930928342888,
  "contract.die-0": 97.89930928342889,
  "contract.contract-card-0": 97.91930928342889,
  "contract.die-1": 97.89930928342889,
  "contract.contract-card-1": 97.91930928342889,
  "contract.die-2": 97.89930928342889,
  "contract.contract-card-2": 97.91930928342889,
  "contract.rail-0": 97.91930928342889,
  "contract.rail-1": 97.91930928342889,
  "contract.stop-0": 97.89930928342889,
  "contract.stop-1": 97.93930928342888,
  "selector.carriage": 97.93930928342888,
  "selector.handle-neck": 97.95930928342888,
  "selector.handle": 97.97930928342888,
  "output.mount-0": 97.8593092834289,
  "output.mount-1": 97.8593092834289,
  "output.mount-2": 97.8593092834289,
  "output.mount-3": 97.8593092834289,
  "output.floor": 97.8793092834289,
  "output.screen-spacer-0": 97.89930928342889,
  "output.screen-spacer-1": 97.89930928342889,
  "output.screen-spacer-2": 97.89930928342889,
  "output.screen-spacer-3": 98.394394804188,
  "output.screen": 98.41439480418799,
  "output.back-frame": 97.89930928342889,
  "output.left-frame": 97.91930928342889,
  "output.right-frame": 98.43439480418799,
  "output.front-frame": 98.45439480418798,
  "output.retain-clip-0": 97.93930928342888,
  "output.retain-clip-1": 98.45439480418798
};
for (const part of parts) {
  const measured = AUDITED_DEPTHS[part.name];
  if (!Number.isFinite(measured)) throw new Error(`Missing measured depth: ${part.name}`);
  part.key = measured;
}
export const COMPOSER_UNSORTED_PARTS = parts;
export const COMPOSER_PARTS = parts.slice().sort((a, b) => a.key - b.key);
export const COMPOSER_PART_COUNT = parts.length;
