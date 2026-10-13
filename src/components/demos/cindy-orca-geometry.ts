import {boxCorners, corners, cylinder, depthOf, fitProjection, iso, onTop, slabOf, topTicks, type Plan, type Point3, type SolidPaths, type Tone} from './anatomy-iso-kit';

/** A Figure: a dispatch console and two independent reel recorders on one bench. */
export const CINDY_VIEW = {width: 720, height: 400};
const base: Plan = {x: 0, y: 0, w: 210, d: 126, r: 7};
export const CINDY_PROJECTION = fitProjection(boxCorners(base, 0, 42), CINDY_VIEW.width, CINDY_VIEW.height, {pad: 54, azimuth: 50, elevation: 36});
export type CindyPartShape =
  | {kind: 'slab'; plan: Plan; z: number; height: number}
  | {kind: 'cylinder'; x: number; y: number; radius: number; z: number; height: number};
export interface CindyPart {
  name: string;
  paths: SolidPaths;
  tone: Tone;
  shape: CindyPartShape;
  at: Point3;
  depth: number;
  motion?: 'selector' | 'ticket-A' | 'ticket-B' | 'progress-A' | 'progress-B';
  screws?: Array<[number, number]>;
  rules?: string;
  freeRules?: boolean;
}
const parts: CindyPart[] = [];
function plate(name: string, plan: Plan, z: number, height: number, tone: Tone = 'mid', options: Partial<Pick<CindyPart, 'motion' | 'rules' | 'freeRules'>> & {screws?: boolean} = {}) {
  const at: Point3 = [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2];
  parts.push({name, paths: slabOf(plan, z, height, CINDY_PROJECTION, 8, height > 1 ? 0.6 : 0), shape: {kind: 'slab', plan, z, height}, at, depth: depthOf(at, CINDY_PROJECTION), tone, ...options, screws: options.screws ? corners(plan, 2.2).map(([x, y]) => iso([x, y, z + height], CINDY_PROJECTION)) : undefined});
}
function round(name: string, x: number, y: number, radius: number, z: number, height: number, tone: Tone = 'mid', motion?: CindyPart['motion']) {
  const at: Point3 = [x, y, z + height / 2];
  parts.push({name, paths: cylinder(x, y, radius, z, height, CINDY_PROJECTION, 64, 0.3), shape: {kind: 'cylinder', x, y, radius, z, height}, at, depth: depthOf(at, CINDY_PROJECTION), tone, motion});
}
const p = (x: number, y: number, w: number, d: number, r = 1): Plan => ({x, y, w, d, r});
for (const [x, y] of [[9, 9], [189, 9], [9, 105], [189, 105]]) plate(`bench-foot-${x}-${y}`, p(x!, y!, 12, 12, 2), 0, 5, 'lo');
plate('bench-base', base, 5, 5, 'lo', {screws: true});
plate('lead-console-foot', p(12, 25, 41, 75, 3), 10, 4, 'lo', {screws: true});
plate('lead-console-housing', p(14, 30, 36, 19, 2), 14, 17, 'mid');
plate('lead-console-lid', p(14, 30, 36, 19, 2), 31, 2, 'hi', {screws: true});
plate('lead-writing-desk', p(15, 52, 35, 39, 2), 14, 3, 'mid');
plate('lead-summary-paper', p(19, 74, 25, 13, 0.4), 17, 0.5, 'hi', {rules: [77, 80, 83].map(y => onTop([[22, y], [40, y]], 17.5, CINDY_PROJECTION)).join(''), freeRules: true});
plate('lead-slider-socket', p(21, 53, 23, 5), 17, 2, 'hi');
plate('lead-slider-track', p(24, 54, 17, 3, 0.5), 19, 0.5, 'lo');
plate('lead-dispatch-lever', p(25, 54, 3, 3, 0.5), 19.5, 8, 'hi', {motion: 'selector'});
round('lead-lever-knob', 26.5, 55.5, 3.5, 27.5, 2.5, 'hi', 'selector');
plate('lead-inbox-floor', p(20, 63, 24, 8, 0.5), 17, 1, 'mid');
plate('lead-inbox-rim', p(20, 63, 2, 8, 0.4), 18, 2, 'mid');
plate('lead-inbox-stack', p(23, 64, 18, 6, 0.2), 18, 1.2, 'hi');
plate('lead-nameplate', p(19, 34, 25, 7, 0.5), 33, 0.5, 'mid');

for (const [index, laneY] of [34, 96].entries()) {
  const id = index === 0 ? 'A' : 'B';
  plate(`lane-${id}-support`, p(53, laneY, 3, 16), 10, 4, 'lo');
  plate(`lane-${id}-paper-bed`, p(53, laneY, 64, 16), 14, 1, 'mid');
  plate(`lane-${id}-back-guide`, p(53, laneY, 64, 2, 0.4), 15, 2, 'mid');
  plate(`lane-${id}-front-guide`, p(53, laneY + 14, 64, 2, 0.4), 15, 2, 'mid');
  plate(`lane-${id}-end-stop`, p(114, laneY + 2, 3, 12, 0.4), 15, 1.5, 'hi');
  plate(`lane-${id}-ticket`, p(59, laneY + 3, 14, 10, 0.3), 15, 0.5, 'hi', {motion: `ticket-${id}`, rules: [5.5, 8.5, 11.5].map(y => onTop([[61.5, laneY + y], [70.5, laneY + y]], 15.5, CINDY_PROJECTION)).join(''), freeRules: true});
}

for (const [index, y] of [8, 70].entries()) {
  const id = index === 0 ? 'A' : 'B';
  plate(`worker-${id}-desk`, p(110, y, 88, 49, 3), 10, 4, 'lo', {screws: true});
  plate(`worker-${id}-recorder`, p(117, y + 4, 54, 22, 2), 14, 5, 'mid', {screws: true});
  for (const [reel, x] of [129, 158].entries()) {
    round(`worker-${id}-reel-${reel}-lower-flange`, x, y + 15, 7.3, 19, 1, 'mid');
    round(`worker-${id}-reel-${reel}-tape`, x, y + 15, 5.8, 20, 3.5, 'hi');
    round(`worker-${id}-reel-${reel}-upper-flange`, x, y + 15, 7.3, 23.5, 1, 'mid');
    round(`worker-${id}-reel-${reel}-hub`, x, y + 15, 1.6, 24.5, 1.5, 'hi');
  }
  plate(`worker-${id}-tape-path`, p(136.3, y + 13, 14.4, 4, 0.3), 19, 0.5, 'lo');
  plate(`worker-${id}-write-head`, p(141, y + 10, 5, 10, 0.4), 19.5, 4, 'hi');
  plate(`worker-${id}-paper-platen`, p(117, y + 28, 56, 15), 14, 1.5, 'mid');
  plate(`worker-${id}-history-paper`, p(120, y + 29, 50, 12, 0.3), 15.5, 0.5, 'hi', {rules: [32, 35, 38].map(row => onTop([[122.5, y + row], [167.5, y + row]], 16, CINDY_PROJECTION)).join(''), freeRules: true});
  plate(`worker-${id}-paper-back-clamp`, p(118, y + 27, 54, 2, 0.4), 15.5, 2, 'mid');
  plate(`worker-${id}-paper-front-clamp`, p(118, y + 41, 54, 2, 0.4), 15.5, 2, 'mid');
  plate(`worker-${id}-ruler`, p(118, y + 45, 54, 2, 0.3), 14, 1, 'hi', {rules: topTicks(118, 172, 3, 3, y + 45, 15, [0.6, 1.4], CINDY_PROJECTION).minor + topTicks(118, 172, 3, 3, y + 45, 15, [0.6, 1.4], CINDY_PROJECTION).major});
  plate(`worker-${id}-progress-carriage`, p(119, y + 45, 4, 2, 0.3), 15, 2, 'hi', {motion: `progress-${id}`});
  plate(`worker-${id}-outbox-floor`, p(178, y + 29, 13, 14, 0.5), 14, 1, 'mid');
  plate(`worker-${id}-outbox-back`, p(178, y + 29, 13, 2, 0.4), 15, 3, 'mid');
  plate(`worker-${id}-outbox-side`, p(189, y + 31, 2, 12, 0.4), 15, 3, 'mid');
  plate(`worker-${id}-output-sheet`, p(180, y + 32, 8, 9, 0.2), 15, 0.5, 'hi');
}

/** Each shape is exported so the same drawn geometry can be recorded by Anatomy's audit. */
// Measured by Anatomy recorder/settle across seven transfer and progress poses.
const CINDY_DRAW_ORDER = [
  "bench-foot-9-9",
  "bench-foot-9-105",
  "bench-foot-189-9",
  "bench-foot-189-105",
  "bench-base",
  "lead-console-foot",
  "worker-A-desk",
  "worker-B-desk",
  "lead-console-housing",
  "lane-A-support",
  "lead-writing-desk",
  "worker-A-recorder",
  "lane-B-support",
  "worker-A-ruler",
  "worker-A-outbox-floor",
  "worker-B-recorder",
  "worker-B-ruler",
  "worker-B-outbox-floor",
  "lead-console-lid",
  "lead-slider-socket",
  "lead-inbox-floor",
  "lead-summary-paper",
  "lane-A-paper-bed",
  "worker-A-reel-0-lower-flange",
  "worker-A-tape-path",
  "lane-B-paper-bed",
  "worker-A-outbox-back",
  "worker-B-reel-0-lower-flange",
  "worker-A-output-sheet",
  "worker-B-tape-path",
  "worker-B-outbox-back",
  "worker-B-output-sheet",
  "lead-nameplate",
  "lead-slider-track",
  "lead-inbox-rim",
  "lead-inbox-stack",
  "lane-A-ticket",
  "lane-A-back-guide",
  "worker-A-reel-0-tape",
  "worker-A-write-head",
  "lane-B-ticket",
  "worker-A-reel-1-lower-flange",
  "worker-A-paper-platen",
  "lane-B-back-guide",
  "worker-B-reel-0-tape",
  "worker-A-outbox-side",
  "worker-B-write-head",
  "worker-B-reel-1-lower-flange",
  "worker-B-paper-platen",
  "lead-dispatch-lever",
  "lane-A-end-stop",
  "worker-A-reel-0-upper-flange",
  "worker-A-progress-carriage",
  "worker-A-paper-back-clamp",
  "worker-A-reel-1-tape",
  "worker-A-history-paper",
  "lane-B-end-stop",
  "worker-B-reel-0-upper-flange",
  "worker-B-progress-carriage",
  "worker-B-paper-back-clamp",
  "worker-B-reel-1-tape",
  "worker-B-history-paper",
  "lead-lever-knob",
  "worker-A-reel-0-hub",
  "worker-A-reel-1-upper-flange",
  "worker-B-reel-0-hub",
  "worker-B-reel-1-upper-flange",
  "worker-A-reel-1-hub",
  "worker-B-reel-1-hub",
  "worker-B-outbox-side",
  "lane-A-front-guide",
  "lane-B-front-guide",
  "worker-A-paper-front-clamp",
  "worker-B-paper-front-clamp"
];
export const CINDY_PARTS = parts.sort((a, b) => CINDY_DRAW_ORDER.indexOf(a.name) - CINDY_DRAW_ORDER.indexOf(b.name));
export const CINDY_LABEL_TRANSFORM = (() => {
  const origin = iso([22, 35.5, 33.5], CINDY_PROJECTION);
  const alongX = iso([23, 35.5, 33.5], CINDY_PROJECTION);
  const alongY = iso([22, 36.5, 33.5], CINDY_PROJECTION);
  return `matrix(${alongX[0] - origin[0]} ${alongX[1] - origin[1]} ${alongY[0] - origin[0]} ${alongY[1] - origin[1]} ${origin[0]} ${origin[1]})`;
})();
