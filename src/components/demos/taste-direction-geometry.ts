import {
  boxCorners, corners, depthOf, fitProjection, haloOf, iso, lineOnTop,
  slabOf, topMatrix, type Plan, type SolidPaths,
} from './anatomy-iso-kit';
import {directionNumber, type DrawRound} from './taste-direction-model';

export const DRAW_WIDTH = 800;
export const DRAW_HEIGHT = 335;
const BASE: Plan = {x: -210, y: -85, w: 420, d: 174, r: 5};
export const DRAW_PROJECTION = fitProjection(boxCorners(BASE, -9, 13), DRAW_WIDTH, DRAW_HEIGHT, {pad: 22, azimuth: 83, elevation: 59});
const P = DRAW_PROJECTION;
export const DRAW_HALO = haloOf(BASE, -9, 1, P);
export const RANGE = {x: -190, width: 380};
export interface DrawPart {
  name: string; plan: Plan; z: number; height: number; paths: SolidPaths;
  depth: number; family: 'base' | 'register' | 'bin' | 'output' | 'pointer';
  bit?: boolean; selected?: boolean; print?: {transform: string; text: string; width: number};
  lines: string[]; bolts: Array<[number, number]>;
}
/** All the parts are exact, non-overlapping slabs seated on the support plate. */
export function drawGeometry(round: DrawRound, drawn: DrawRound[], selectedRound: number) {
  const parts: DrawPart[] = [];
  function add(name: string, plan: Plan, z: number, height: number, family: DrawPart['family']) {
    const part: DrawPart = {name, plan, z, height, family, paths: slabOf(plan, z, height, P, 4, height > 1 ? 0.3 : 0),
      depth: (name.startsWith('foot-') ? 0 : name === 'support-plate' ? 1 : family === 'base' ? 2 : 3) * 1000
        + depthOf([plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2], P), lines: [], bolts: []};
    parts.push(part);return part;
  }
  for (const [index, [x, y]] of corners(BASE, 16).entries()) {
    add(`foot-${index}`, {x: x - 7, y: y - 7, w: 14, d: 14, r: 2}, -9, 5, 'base');
  }
  const base = add('support-plate', BASE, -4, 4, 'base');
  base.bolts = corners(BASE, 8).map(([x, y]) => iso([x, y, 0.03], P));
  const register = add('binary-register-bed', {x: -194, y: -73, w: 388, d: 22, r: 1}, 0, 2, 'base');
  register.bolts = corners(register.plan, 3).map(([x, y]) => iso([x, y, 2.03], P));
  for (let bit = 31; bit >= 0; bit--) {
    const on = !!((round.unsigned >>> bit) & 1);
    const x = -188 + (31 - bit) * 11.9;
    const part = add(`bit-${bit}`, {x, y: -68, w: 8.8, d: 12, r: 0.35}, 2, on ? 3 : 0.8, 'register');
    part.bit = on;
  }
  const track = add('normalized-rule', {x: -194, y: -38, w: 388, d: 14, r: 1}, 0, 2, 'base');
  for (let i = 0; i <= 20; i++) {
    const x = RANGE.x + RANGE.width * i / 20;
    track.lines.push(lineOnTop([x, -24], [x, i % 5 ? -27 : -28], 2.03, P));
  }
  // Every equal-width bin covers [i/n, (i+1)/n). Its index is printed on the tile.
  const n = round.before.length;
  round.before.forEach((direction, index) => {
    const width = RANGE.width / n;
    const part = add(`bin-${direction.id}`, {x: RANGE.x + index * width + 0.6, y: -16, w: width - 1.2, d: 39, r: 0.5}, 0, 3.5, 'bin');
    part.selected = index === round.index;
    part.print = {transform: topMatrix([part.plan.x, -14], 3.55, P), text: String(directionNumber(direction.id)).padStart(2, '0'), width: part.plan.w};
  });
  const pointerX = RANGE.x + RANGE.width * round.random;
  // The carriage position uses the exact fraction, independent of the equal-width bins.
  const carriage = add('random-pointer', {x: pointerX - 1.1, y: -36, w: 2.2, d: 10, r: 0.3}, 2, 3.5, 'pointer');
  carriage.selected = true;
  // Output strips are separate seats, with the chosen catalogue numbers engraved.
  drawn.forEach((entry, index) => {
    const well = add(`output-seat-${index}`, {x: -190 + index * 130, y: 40, w: 120, d: 34, r: 1}, 0, 2, 'base');
    well.bolts = corners(well.plan, 3).map(([x, y]) => iso([x, y, 2.03], P));
    const slip = add(`output-${index}`, {x: -185 + index * 130, y: 45, w: 110, d: 24, r: 0.5}, 2, 0.6, 'output');
    slip.selected = index === selectedRound;
    slip.print = {transform: topMatrix([slip.plan.x, 46], 2.65, P), text: `${index + 1} / ${String(directionNumber(entry.chosen.id)).padStart(2, '0')}`, width: 110};
  });
  // A single plate spans the full board; group layers are seated without crossing.
  return {parts: parts.sort((a, b) => a.depth - b.depth), pointerX,
    marker: iso([pointerX, -18, 3.6], P), binWidth: RANGE.width / n,
    scaleStart: iso([RANGE.x, -39, 2.1], P), scaleEnd: iso([RANGE.x + RANGE.width, -39, 2.1], P)};
}
