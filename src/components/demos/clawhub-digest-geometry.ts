import {
  boxCorners, corners, cylinder, depthOf, fitProjection, haloOf,
  sideSeam, slabOf, sideMatrix, topMatrix,
  type Plan, type Point3, type SolidPaths, type Tone,
} from './anatomy-iso-kit';

export const DIGEST_WIDTH = 680;
export const DIGEST_HEIGHT = 360;
export const SELECTOR_TRAVEL: Point3 = [40, 0, 0];
const BASE: Plan = {x: -175, y: -67, w: 350, d: 148, r: 7};
export const DIGEST_PROJECTION = fitProjection([
  ...boxCorners(BASE, -17, 0), ...boxCorners({x: -34, y: -40, w: 78, d: 102, r: 0}, 0, 54),
], DIGEST_WIDTH, DIGEST_HEIGHT, {pad: 30, azimuth: 47, elevation: 38});
export const DIGEST_HALO = haloOf(BASE, -17, 2, DIGEST_PROJECTION);
const P = DIGEST_PROJECTION;
export interface SlabShape {kind: 'slab'; plan: Plan; z: number; height: number; steps: number}
export interface CylinderShape {kind: 'cylinder'; x: number; y: number; radius: number; z: number; height: number}
export interface CatalogPart {
  name: string; paths: SolidPaths; shape: SlabShape | CylinderShape; center: Point3;
  key: number; tone: Tone; family: 'fixed' | 'skill' | 'v1' | 'v2' | 'digest' | 'public' | 'selector';
  lines: Array<{d: string; faint?: boolean; free?: boolean}>;
  move?: Point3;
}
const parts: CatalogPart[] = [];
function slab(name: string, plan: Plan, z: number, height: number, tone: Tone = 'mid', family: CatalogPart['family'] = 'fixed') {
  const center: Point3 = [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2];
  const item: CatalogPart = {name, paths: slabOf(plan, z, height, P, 6, height >= 3 ? 0.5 : 0),
    shape: {kind: 'slab', plan, z, height, steps: 6}, center, tone, family,
    key: depthOf(center, P), lines: []};
  if (family === 'selector') item.move = SELECTOR_TRAVEL;
  parts.push(item);
  return item;
}
function round(name: string, x: number, y: number, radius: number, z: number, height: number, tone: Tone = 'hi') {
  const center: Point3 = [x, y, z + height / 2];
  const item: CatalogPart = {name, paths: cylinder(x, y, radius, z, height, P, 48),
    shape: {kind: 'cylinder', x, y, radius, z, height}, center, tone, family: 'fixed',
    key: depthOf(center, P), lines: []};
  parts.push(item);
  return item;
}
function seam(item: CatalogPart, plan: Plan, z: number) {item.lines.push({d: sideSeam(plan, z, P, 6), faint: true});}

// Figure: rubber feet, base and bolts; archival tray holding a thick Skill file
// and two bound version books; an open catalogue drawer with runners, handle,
// retainers and a thin standing index card; its three-position filing tab rides
// on the card's full-width rail; a shallow public reading tray holds an output
// sheet. Covers, pages, bindings and clamps are separate real supported solids.
for (const [i, [x, y]] of corners(BASE, 17).entries()) {
  round(`stand.rubber-foot-${i}`, x, y, 7, -17, 2, 'lo');
  round(`foot-riser-${i}`, x, y, 5, -15, 5, 'mid');
}
const base = slab('base.plate', BASE, -10, 10, 'lo');
seam(base, BASE, -5);
for (const [i, [x, y]] of corners(BASE, 9).entries()) round(`base.bolt-${i}`, x, y, 1.6, 0, 0.7);
const platePlan = {x: -161, y: 62, w: 54, d: 10, r: 0.7};
slab('base.label-plate', platePlan, 0, 0.7, 'lo');
for (const [i, x] of [-158, -110].entries()) round(`base.label-bolt-${i}`, x, 67, 0.9, 0.7, 0.5);

// The whole archive remains present when a version is withdrawn or a Skill is hidden.
for (const [i, [x, y]] of [[-156, -40], [-67, -40], [-156, 39], [-67, 39]].entries()) {
  slab(`archive.foot-${i}`, {x, y, w: 9, d: 9, r: 1}, 0, 5, 'lo');
}
slab('archive.floor', {x: -160, y: -44, w: 108, d: 98, r: 1}, 5, 2);
slab('archive.back', {x: -160, y: -44, w: 108, d: 3, r: 0}, 7, 12);
slab('archive.left', {x: -160, y: -41, w: 3, d: 95, r: 0}, 7, 12);
slab('archive.right', {x: -55, y: -41, w: 3, d: 95, r: 0}, 7, 12);
slab('archive.front', {x: -157, y: 51, w: 102, d: 3, r: 0}, 7, 5);
function book(name: 'skill' | 'v1' | 'v2', plan: Plan, pagesHeight: number) {
  slab(`${name}.bottom-cover`, plan, 7, 0.8, 'mid', name);
  const pages = {x: plan.x + 1.5, y: plan.y + 1.5, w: plan.w - 3, d: plan.d - 3, r: 0};
  const block = slab(`${name}.pages`, pages, 7.8, pagesHeight, 'hi', name);
  seam(block, pages, 7.8 + pagesHeight / 2);
  const top = slab(`${name}.top-cover`, plan, 7.8 + pagesHeight, 0.8, 'hi', name);
  slab(`${name}.binding`, {x: plan.x, y: plan.y, w: 1.5, d: plan.d, r: 0}, 7.8, pagesHeight, 'mid', name);
  return {partName: top.name, transform: topMatrix([plan.x + 4, plan.y + 5], 8.64 + pagesHeight, P), width: plan.w - 8, height: plan.d - 10};
}
export const SKILL_PRINT = book('skill', {x: -150, y: -32, w: 51, d: 72, r: 1}, 12);
export const V1_PRINT = book('v1', {x: -92, y: -32, w: 31, d: 30, r: 0.6}, 6);
export const V2_PRINT = book('v2', {x: -92, y: 8, w: 31, d: 30, r: 0.6}, 6);
for (const [i, y] of [-24, 29].entries()) {
  slab(`skill.clasp-${i}`, {x: -105, y, w: 7, d: 5, r: 0.5}, 20.6, 1, 'mid', 'skill');
  round(`skill.clasp-rivet-${i}`, -102, y + 2.5, 0.8, 21.6, 0.5);
}

// The drawer is open, exposing the materialized projection rather than a generic cache.
for (const [i, [x, y]] of [[-33, -40], [32, -40], [-33, 50], [32, 50]].entries()) {
  slab(`catalogue.foot-${i}`, {x, y, w: 10, d: 10, r: 1}, 0, 5, 'lo');
}
slab('catalogue.floor', {x: -34, y: -40, w: 78, d: 102, r: 0}, 5, 4);
slab('catalogue.back', {x: -34, y: -40, w: 78, d: 3, r: 0}, 9, 34);
slab('catalogue.left', {x: -34, y: -37, w: 4, d: 99, r: 0}, 9, 21);
slab('catalogue.right', {x: 40, y: -37, w: 4, d: 99, r: 0}, 9, 21);
slab('catalogue.front-sill', {x: -30, y: 58, w: 70, d: 4, r: 0}, 9, 3);
for (const [i, x] of [-29, 35].entries()) slab(`drawer.runner-${i}`, {x, y: -28, w: 4, d: 82, r: 0}, 9, 3);
slab('drawer.floor', {x: -29, y: -28, w: 68, d: 82, r: 0}, 12, 2);
slab('drawer.back', {x: -25, y: -28, w: 60, d: 2, r: 0}, 14, 8);
slab('drawer.left', {x: -25, y: -26, w: 2, d: 80, r: 0}, 14, 8);
slab('drawer.right', {x: 33, y: -26, w: 2, d: 80, r: 0}, 14, 8);
slab('drawer.front', {x: -23, y: 51, w: 56, d: 3, r: 0}, 14, 6);
for (const [i, x] of [-9, 16].entries()) {
  slab(`drawer.handle-foot-${i}`, {x, y: 54, w: 3, d: 4, r: 0}, 15, 3);
  round(`drawer.handle-bolt-${i}`, x + 1.5, 53, 0.9, 20, 0.6);
}
slab('drawer.handle', {x: -9, y: 58, w: 28, d: 3, r: 1}, 15, 3);
slab('digest.card', {x: -23, y: -16, w: 54, d: 1.4, r: 0}, 14, 30, 'hi', 'digest');
slab('digest.selector-rail', {x: -23, y: -16, w: 54, d: 1.4, r: 0}, 44, 0.6, 'mid', 'digest');
slab('selector.shoe', {x: -19, y: -17.3, w: 8, d: 4, r: 0.3}, 44.6, 1, 'hi', 'selector');
slab('selector.tab', {x: -17.5, y: -16.1, w: 5, d: 1.7, r: 0.2}, 45.6, 4, 'hi', 'selector');
slab('selector.cap', {x: -19, y: -17.3, w: 8, d: 4, r: 0.3}, 49.6, 0.7, 'mid', 'selector');
export const INDEX_PRINT = {partName: 'digest.card', transform: sideMatrix([-21, -14.56], 40, P, 'left'), width: 50, height: 24};

for (const [i, [x, y]] of [[78, 19], [146, 19], [78, 64], [146, 64]].entries()) slab(`public.foot-${i}`, {x, y, w: 9, d: 9, r: 1}, 0, 5, 'lo');
slab('public.tray-floor', {x: 75, y: 16, w: 85, d: 62, r: 1}, 5, 2);
slab('public.tray-back', {x: 75, y: 16, w: 85, d: 2, r: 0}, 7, 5);
slab('public.tray-left', {x: 75, y: 18, w: 2, d: 60, r: 0}, 7, 5);
slab('public.tray-right', {x: 158, y: 18, w: 2, d: 60, r: 0}, 7, 5);
slab('public.sheet', {x: 81, y: 24, w: 73, d: 48, r: 0.5}, 7, 0.7, 'hi', 'public');
for (const [i, x] of [80, 152].entries()) slab(`public.sheet-clip-${i}`, {x, y: 25, w: 3, d: 5, r: 0.3}, 7.7, 0.5);
export const PUBLIC_PRINT = {partName: 'public.sheet', transform: topMatrix([84, 29], 7.74, P), width: 66, height: 38};
export const PLATE_PRINT = {partName: 'base.label-plate', transform: topMatrix([-154, 69], 0.74, P)};

// Measured from the exact recorded shapes over the tab's complete 40-unit travel.
const AUDITED_KEYS: Record<string, number> = {
  "stand.rubber-foot-0": -123.57899526759081,
  "foot-riser-0": -121.42418010395102,
  "stand.rubber-foot-1": 46.246369900570926,
  "foot-riser-1": 48.40118506421073,
  "stand.rubber-foot-2": -57.87913296906816,
  "foot-riser-2": -55.724317805428356,
  "stand.rubber-foot-3": 111.94623219909357,
  "foot-riser-3": 114.10104736273337,
  "base.plate": 114.12104736273336,
  "base.bolt-0": 114.14104736273336,
  "base.bolt-1": 114.14104736273336,
  "base.bolt-2": 114.14104736273336,
  "base.bolt-3": 130.92219030656716,
  "base.label-plate": 114.14104736273336,
  "base.label-bolt-0": 114.16104736273336,
  "base.label-bolt-1": 114.16104736273336,
  "archive.foot-0": 114.14104736273336,
  "archive.foot-1": 114.14104736273336,
  "archive.foot-2": 114.14104736273336,
  "archive.foot-3": 114.14104736273336,
  "archive.floor": 114.16104736273336,
  "archive.back": 114.18104736273335,
  "archive.left": 114.20104736273335,
  "archive.right": 114.24104736273334,
  "archive.front": 114.22104736273334,
  "skill.bottom-cover": 114.18104736273335,
  "skill.pages": 114.24104736273334,
  "skill.top-cover": 114.26104736273334,
  "skill.binding": 114.22104736273334,
  "v1.bottom-cover": 114.18104736273335,
  "v1.pages": 114.22104736273334,
  "v1.top-cover": 114.24104736273334,
  "v1.binding": 114.20104736273335,
  "v2.bottom-cover": 114.18104736273335,
  "v2.pages": 114.22104736273334,
  "v2.top-cover": 114.24104736273334,
  "v2.binding": 114.20104736273335,
  "skill.clasp-0": 114.28104736273333,
  "skill.clasp-rivet-0": 114.30104736273333,
  "skill.clasp-1": 114.28104736273333,
  "skill.clasp-rivet-1": 114.30104736273333,
  "catalogue.foot-0": 114.14104736273336,
  "catalogue.foot-1": 114.14104736273336,
  "catalogue.foot-2": 114.14104736273336,
  "catalogue.foot-3": 114.14104736273336,
  "catalogue.floor": 114.16104736273336,
  "catalogue.back": 114.18104736273335,
  "catalogue.left": 114.26104736273334,
  "catalogue.right": 114.40104736273331,
  "catalogue.front-sill": 114.28104736273333,
  "drawer.runner-0": 114.28104736273333,
  "drawer.runner-1": 114.18104736273335,
  "drawer.floor": 114.30104736273333,
  "drawer.back": 114.32104736273332,
  "drawer.left": 114.34104736273332,
  "drawer.right": 114.38104736273331,
  "drawer.front": 114.36104736273332,
  "drawer.handle-foot-0": 114.38104736273331,
  "drawer.handle-bolt-0": 114.38104736273331,
  "drawer.handle-foot-1": 114.38104736273331,
  "drawer.handle-bolt-1": 114.38104736273331,
  "drawer.handle": 114.40104736273331,
  "digest.card": 114.36104736273332,
  "digest.selector-rail": 114.38104736273331,
  "selector.shoe": 114.40104736273331,
  "selector.tab": 114.4210473627333,
  "selector.cap": 114.4410473627333,
  "public.foot-0": 114.14104736273336,
  "public.foot-1": 114.14104736273336,
  "public.foot-2": 114.14104736273336,
  "public.foot-3": 121.89871979712973,
  "public.tray-floor": 121.91871979712973,
  "public.tray-back": 121.93871979712972,
  "public.tray-left": 121.95871979712972,
  "public.tray-right": 121.97871979712971,
  "public.sheet": 121.93871979712972,
  "public.sheet-clip-0": 121.95871979712972,
  "public.sheet-clip-1": 121.95871979712972
};
for (const part of parts) {
  const key = AUDITED_KEYS[part.name];
  if (!Number.isFinite(key)) throw new Error(`Missing audited depth for ${part.name}`);
  part.key = key;
}
export const DIGEST_PARTS = parts.slice().sort((a, b) => a.key - b.key);
export const DIGEST_UNSORTED_PARTS = parts;
export const DIGEST_PART_COUNT = parts.length;
export const selectorOffset = (x: number): Point3 => [Math.max(0, Math.min(40, x)), 0, 0];
