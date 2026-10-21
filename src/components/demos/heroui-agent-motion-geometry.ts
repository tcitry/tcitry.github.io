import {boxCorners, depthOf, fitProjection, iso, pathOf, planOutline, slabOf, topMatrix, translateAlong, type Plan, type SolidPaths, type Tone} from './anatomy-iso-kit';

/** A small typesetting rig. Every static solid has a support or a guide function. */
export const WIDTH = 800;
export const HEIGHT = 340;
export const BASE: Plan = {x: -254, y: -112, w: 514, d: 242, r: 10};
export const P = fitProjection(boxCorners(BASE, -18, 58), WIDTH, HEIGHT, {pad: 32, azimuth: 76, elevation: 39});
export const PAPER: Plan = {x: 50, y: -74, w: 182, d: 157, r: 1};
// All stations share the same bearing level. Strips slide across short seams
// instead of floating over the machine on an arbitrary vertical arc.
export const TRANSFER_Z = 32;
export const PAPER_Z = TRANSFER_Z + .2;
export const PAPER_MATRIX = topMatrix([PAPER.x, PAPER.y], PAPER_Z, P);
export const PROTOCOL_MATRIX = topMatrix([-88, -60], TRANSFER_Z + .2, P);
export const INPUT_MATRIX = topMatrix([-229, -63], TRANSFER_Z + .2, P);
export const at = (x: number, y: number, z: number) => iso([x, y, z], P);
export const move = (x = 0, y = 0, z = 0) => translateAlong(P, [x, y, z]);
export const line = (points: [number, number, number][], closed = false) => pathOf(points.map(point => iso(point, P)), closed);

export interface PlotterPart {name: string; plan: Plan; z: number; height: number; tone: Tone; paths: SolidPaths; depth: number}
const parts: PlotterPart[] = [];
function solid(name: string, x: number, y: number, w: number, d: number, z: number, h: number, r = 1.2, tone: Tone = 'mid') {
  const plan = {x, y, w, d, r};
  parts.push({name, plan, z, height: h, tone, paths: slabOf(plan, z, h, P, 5, Math.min(.5, h / 3)), depth: depthOf([x + w / 2, y + d / 2, z + h / 2], P)});
}
// Foundation: four bolted, two-piece feet and a bevelled bed.
for (const [index, [x, y]] of [[-237, -95], [237, -95], [-237, 110], [237, 110]].entries()) {
  solid(`foot-flange-${index}`, x - 9, y - 9, 18, 18, -18, 3, 4, 'lo');
  solid(`foot-pad-${index}`, x - 6, y - 6, 12, 12, -15, 5, 3);
}
solid('base', BASE.x, BASE.y, BASE.w, BASE.d, -10, 10, BASE.r);
// Source cassette and serial feeder. The four shallow pockets hold actual rows.
solid('source-plinth', -239, -80, 113, 181, 0, 10, 5);
solid('source-bed', -232, -73, 99, 167, 10, 22, 2, 'lo');
for (const x of [-239, -133]) solid(`source-rail-${x}`, x, -80, 7, 181, 10, 22, 1.5);
for (const y of [-80, 94]) solid(`source-stop-${y}`, -232, y, 99, 7, 10, 22, 1.5);
// Flush inlays distinguish records without introducing raised obstacles.
for (let index = 0; index < 4; index++) solid(`row-inlay-${index}`, -230, -65 + index * 35, 94, 28, 31, 1, 2, 'lo');
solid('total-inlay', -230, 74, 94, 20, 31, 1, 2, 'lo');
// The short transfer bridge meets both beds at z=32.
solid('feed-bridge-support', -126, -73, 32, 167, 0, 28, 1);
solid('feed-bridge-deck', -126, -73, 32, 167, 28, 4, 1, 'lo');
// Root/container fixture: a reference is a pin engaging a socket, not a state light.
solid('protocol-plinth', -94, -77, 100, 177, 0, 12, 5);
solid('protocol-bed', -94, -73, 100, 167, 12, 20, 2, 'lo');
for (const [index, y] of [-60, -22, 16, 54].entries()) {
  solid(`reference-inlay-${index}`, -81, y, 74, 28, 31, 1, 1, 'lo');
  solid(`reference-register-${index}`, -10, y, 3, 28, 31, 1, .5);
}
// A second bridge carries records underneath the open comb. Its front lip
// supports the rejected total strip without entering the front pedestal.
solid('validation-bridge', 6, -61, 37, 147, 0, 32, 1, 'lo');
solid('validation-front-lip', 6, 86, 3, 8, 0, 32, .4, 'lo');
// The validation comb sits on its own bearing blocks, between description and page.
solid('gauge-rear-pedestal', 10, -76, 16, 14, 0, 33, 2);
solid('gauge-front-pedestal', 10, 86, 16, 14, 0, 33, 2);
solid('gauge-back-bearing', 12, -72, 12, 8, 33, 21, 2, 'hi');
solid('gauge-front-bearing', 12, 89, 12, 8, 33, 21, 2, 'hi');
// A paper bed, feed rollers, platen and retaining clamps make the output concrete.
solid('paper-plinth', 36, -91, 210, 190, 0, 26, 6);
solid('paper-platen', 43, -83, 196, 174, 26, 6, 3, 'lo');
for (const y of [-90, 92]) {
  solid(`roller-seat-left-${y}`, 36, y, 7, 10, 26, 12, 2);
  solid(`roller-seat-right-${y}`, 239, y, 7, 10, 26, 12, 2);
  solid(`feed-roller-${y}`, 43, y + 2, 196, 6, 32, 6, 3, 'lo');
}
for (const [index, [x, y]] of [[43, -77], [232, -77], [43, 76], [232, 76]].entries()) solid(`paper-clamp-${index}`, x, y, 7, 12, 32, 5, 1.5, 'hi');
// Rails and adjustable stops guide a light registration head over the page.
solid('head-rear-guide', 36, -98, 210, 5, 30, 5, 1);
solid('head-front-guide', 36, 104, 210, 5, 30, 5, 1);
for (const [index, [x, y]] of [[36, -99], [236, -99], [36, 104], [236, 104]].entries()) solid(`head-guide-mount-${index}`, x, y, 10, 7, 0, 30, 1.2);
for (const [index, x] of [-227, -137, -83, -5, 48, 227].entries()) solid(`fixing-tab-${index}`, x, 112, 10, 6, 0, 2, 1, 'lo');

export const STATIC_PARTS = parts.sort((a, b) => a.depth - b.depth);
export const PART_COUNT = STATIC_PARTS.length + 8; // moving comb (5), registration head (2), source reader (1)
export const BASE_SEAM = planOutline({x: BASE.x + 5, y: BASE.y + 5, w: BASE.w - 10, d: BASE.d - 10, r: 6}, .15, P);
export const PAPER_PATH = planOutline(PAPER, PAPER_Z, P);
export const BASE_SHADOW = planOutline({x: BASE.x + 1, y: BASE.y + 2, w: BASE.w, d: BASE.d, r: 12}, -17, P);
export const FIXING_DOTS = [[-244, -102, .15], [250, -102, .15], [-244, 120, .15], [250, 120, .15], [-226, -72, 32.15], [-141, -72, 32.15], [47, -85, 26.15], [235, -85, 26.15]].map(([x, y, z]) => at(x, y, z));
export const GAUGE_PARTS = [
  slabOf({x: 12, y: -64, w: 12, d: 153, r: 2}, 36, 6, P, 5, .5),
  ...[0, 1, 2, 3].map(index => slabOf({x: 9, y: -53 + index * 35, w: 18, d: 13, r: 1.5}, 30, 6, P, 4, .4)),
];
export const HEAD_PARTS = [
  slabOf({x: 41, y: -94, w: 14, d: 202, r: 2}, 35, 5, P, 5, .5),
  slabOf({x: 38, y: -8, w: 20, d: 21, r: 3}, 40, 14, P, 5, .5),
  slabOf({x: 45, y: -3, w: 6, d: 10, r: 1}, 27, 13, P, 4, .4),
];
export const carrier = (index: number) => slabOf({x: -228, y: -61 + index * 35, w: 80, d: 18, r: 2}, 22, 2.2, P, 5, .35);

export const SOURCE_READER = slabOf({x: -238, y: -70, w: 111, d: 8, r: 2}, TRANSFER_Z, 5, P, 5, .4);
