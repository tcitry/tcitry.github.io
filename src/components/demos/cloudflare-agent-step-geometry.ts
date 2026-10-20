import {
  boxCorners, depthOf, fitProjection, haloOf, sideMatrix, sideSeam, slabOf, topMatrix,
  type Plan, type Point3, type SolidPaths, type Tone,
} from './anatomy-iso-kit';

export const AGENT_STEP_WIDTH = 800;
export const AGENT_STEP_HEIGHT = 510;
const BASE: Plan = {x: -207, y: -182, w: 419, d: 311, r: 0};
export const AGENT_STEP_PROJECTION = fitProjection([
  ...boxCorners(BASE, -14, 0),
  ...boxCorners({x: -197, y: -18, w: 275, d: 20, r: 0}, 0, 81),
], AGENT_STEP_WIDTH, AGENT_STEP_HEIGHT, {pad: 24, azimuth: 62, elevation: 50});
const P = AGENT_STEP_PROJECTION;
export const AGENT_STEP_HALO = haloOf(BASE, -14, 4, P);

export type AgentStepFamily = 'fixed' | 'memory-transcript' | 'memory-change' | 'durable-transcript' | 'durable-change' | 'effect-receipt' | 'press';
export interface AgentStepPart {
  name: string;
  paths: SolidPaths;
  shape: {kind: 'slab'; plan: Plan; z: number; height: number; steps: number};
  center: Point3;
  key: number;
  tone: Tone;
  family: AgentStepFamily;
  print?: {transform: string; width: number; height: number; field: 'transcript' | 'change' | 'count' | 'effect' | 'label'; text?: string};
  lines: Array<{d: string; faint?: boolean}>;
}

function makeParts(stamped: boolean): AgentStepPart[] {
  const parts: AgentStepPart[] = [];
  function slab(name: string, plan: Plan, z: number, height: number, tone: Tone = 'mid', family: AgentStepFamily = 'fixed') {
    const center: Point3 = [plan.x + plan.w / 2, plan.y + plan.d / 2, z + height / 2];
    const part: AgentStepPart = {
      name, paths: slabOf(plan, z, height, P, 0, height >= 3 ? 0.35 : 0),
      shape: {kind: 'slab', plan, z, height, steps: 0},
      center, key: depthOf(center, P), tone, family, lines: [],
    };
    parts.push(part);
    return part;
  }
  for (const [index, [x, y]] of [[-192, -167], [182, -167], [-192, 103], [182, 103]].entries()) {
    slab(`base.foot-${index}`, {x, y, w: 16, d: 16, r: 0}, -14, 5, 'lo');
  }
  const base = slab('base.plate', BASE, -9, 9, 'lo');
  base.lines.push({d: sideSeam(BASE, -4.5, P, 0), faint: true});
  for (const [index, [x, y]] of [[-198, -172], [198, -172], [-198, 116], [198, 116]].entries()) {
    slab(`base.bolt-${index}`, {x, y, w: 3, d: 3, r: 0}, 0, 1, 'hi');
  }

  for (const [lane, x] of [[0, -180], [1, -56]] as const) {
    const field = lane === 0 ? 'transcript' : 'change';
    slab(`lane-${lane}.bed`, {x, y: -163, w: 110, d: 272, r: 0}, 0, 4, 'lo');
    for (const [index, guideX] of [x - 2, x + 110].entries()) {
      slab(`lane-${lane}.guide-${index}`, {x: guideX, y: -165, w: 2, d: 274, r: 0}, 0, 8);
    }
    for (const [index, y] of [-166, 109].entries()) {
      slab(`lane-${lane}.stop-${index}`, {x: x - 2, y, w: 114, d: 1, r: 0}, 0, 8);
    }
    slab(`lane-${lane}.transit`, {x: x + 6, y: -81, w: 98, d: 106, r: 0}, 4, 0.8, 'hi');
    slab(`memory-${lane}.tray`, {x: x + 4, y: -160, w: 102, d: 79, r: 0}, 4, 2, 'lo');
    for (const [index, edgeX] of [x + 4, x + 104].entries()) {
      slab(`memory-${lane}.edge-${index}`, {x: edgeX, y: -160, w: 2, d: 79, r: 0}, 6, 2, 'mid');
    }
    slab(`memory-${lane}.back`, {x: x + 6, y: -160, w: 98, d: 2, r: 0}, 6, 2, 'mid');
    const memory = slab(`memory-${lane}.paper`, {x: x + 9, y: -155, w: 92, d: 68, r: 0}, 6, 0.8, 'hi', lane === 0 ? 'memory-transcript' : 'memory-change');
    memory.print = {transform: topMatrix([x + 9, -155], 6.84, P), width: 92, height: 68, field};
    const ledger = slab(`durable-${lane}.ledger`, {x: x + 4, y: 25, w: 102, d: 79, r: 0}, 4, 1, 'lo');
    ledger.lines.push({d: sideSeam(ledger.shape.plan, 4.5, P, 0), faint: true});
    const durable = slab(`durable-${lane}.paper`, {x: x + 9, y: 30, w: 92, d: 68, r: 0}, 5, 0.8, 'hi', lane === 0 ? 'durable-transcript' : 'durable-change');
    durable.print = {transform: topMatrix([x + 9, 30], 5.84, P), width: 92, height: 68, field};
  }

  for (const [index, x] of [-197, 68].entries()) {
    slab(`press.mount-${index}`, {x: x - 3, y: -21, w: 16, d: 26, r: 0}, 0, 4);
    slab(`press.column-${index}`, {x, y: -18, w: 10, d: 20, r: 0}, 4, 62);
    slab(`press.cap-${index}`, {x: x - 1, y: -19, w: 12, d: 22, r: 0}, 76, 4);
    for (const [bolt, y] of [-17, -2].entries()) {
      slab(`press.cap-${index}.bolt-${bolt}`, {x: x + 3.5, y, w: 3, d: 3, r: 0}, 80, 1, 'hi');
    }
  }
  slab('press.bridge', {x: -197, y: -18, w: 275, d: 20, r: 0}, 66, 10);
  const headBottom = stamped ? 8.8 : 36;
  slab('press.rod', {x: -77, y: -11, w: 16, d: 8, r: 0}, headBottom + 8, 66 - headBottom - 8, 'mid', 'press');
  slab('press.head', {x: -176, y: -14, w: 222, d: 32, r: 0}, headBottom, 8, 'hi', 'press');
  for (const [index, x] of [-171, -47].entries()) {
    slab(`press.die-${index}`, {x, y: -10, w: 92, d: 24, r: 0}, headBottom - 4, 4, 'hi', 'press');
  }

  for (const {name, y, text} of [
    {name: 'memory', y: -178, text: 'PENDING / stepBuffer'},
    {name: 'durable', y: 114, text: 'DURABLE / commitAgentStep'},
  ]) {
    const label = slab(`label.${name}`, {x: -178, y, w: 228, d: 9, r: 0}, 0, 0.7, 'lo');
    label.print = {transform: topMatrix([-173, y + 1], 0.74, P), width: 218, height: 7, field: 'label', text};
  }

  slab('effect.base', {x: 112, y: -20, w: 83, d: 84, r: 0}, 0, 10, 'lo');
  slab('effect.case', {x: 117, y: -15, w: 73, d: 73, r: 0}, 10, 28);
  slab('effect.lid', {x: 116, y: -16, w: 75, d: 75, r: 0}, 38, 3);
  const counter = slab('effect.counter-window', {x: 123, y: 58, w: 61, d: 0.8, r: 0}, 17, 15, 'hi');
  counter.print = {transform: sideMatrix([123, 58.84], 32, P, 'left'), width: 61, height: 15, field: 'count'};
  slab('effect.knob-neck', {x: 190, y: 11, w: 3, d: 8, r: 0}, 20, 8);
  slab('effect.knob', {x: 193, y: 9, w: 5, d: 12, r: 0}, 18, 12, 'hi');
  const effectLabel = slab('effect.label', {x: 121, y: -9, w: 63, d: 12, r: 0}, 41, 0.7, 'lo');
  effectLabel.print = {transform: topMatrix([123, -7], 41.74, P), width: 59, height: 8, field: 'label', text: 'APP STORAGE'};
  slab('effect.receipt-tray', {x: 115, y: 80, w: 78, d: 38, r: 0}, 0, 2, 'lo');
  for (const [index, x] of [113, 193].entries()) {
    slab(`effect.receipt-side-${index}`, {x, y: 80, w: 2, d: 38, r: 0}, 0, 5);
  }
  slab('effect.receipt-back', {x: 115, y: 78, w: 78, d: 2, r: 0}, 0, 5);
  const receipt = slab('effect.receipt', {x: 120, y: 84, w: 68, d: 30, r: 0}, 2, 0.7, 'hi', 'effect-receipt');
  receipt.print = {transform: topMatrix([120, 84], 2.74, P), width: 68, height: 30, field: 'effect'};
  return parts;
}

// Exact volumes and settled painter keys are shared by the browser and the geometry audit.
// Only the press pose changes; record paper visibility is derived from the pure step model.
const UP_PARTS = makeParts(false);
const DOWN_PARTS = makeParts(true);
// Ray-cast order: 202 rules with the press up, 198 with it down; no cycles or dropped rules.
const ORDER_START = `base.foot-0 base.foot-1 base.foot-2 base.foot-3 base.plate base.bolt-0 base.bolt-1 base.bolt-2 press.mount-0 press.mount-1 label.memory label.durable effect.base effect.receipt-side-0 effect.receipt-back lane-0.stop-0 lane-1.stop-0 press.column-0 effect.case effect.receipt-tray lane-0.guide-0 lane-1.guide-0 effect.lid effect.counter-window effect.knob-neck effect.receipt lane-0.bed lane-1.bed effect.knob effect.label lane-0.guide-1 lane-0.transit memory-0.tray lane-1.guide-1 lane-1.transit memory-1.tray lane-0.stop-1 memory-0.edge-0 memory-0.paper durable-0.ledger lane-1.stop-1 memory-1.edge-0 memory-1.paper durable-1.ledger`;
const ORDER_END = `press.rod press.bridge press.cap-0 press.cap-1 press.cap-0.bolt-0 press.cap-0.bolt-1 press.cap-1.bolt-0 press.cap-1.bolt-1 effect.receipt-side-1 base.bolt-3`;
const UP_ORDER = `${ORDER_START} memory-0.back durable-0.paper memory-1.back durable-1.paper press.die-0 press.die-1 memory-0.edge-1 memory-1.edge-1 press.column-1 press.head ${ORDER_END}`.split(' ');
const DOWN_ORDER = `${ORDER_START} press.die-0 press.die-1 memory-0.back durable-0.paper memory-1.back durable-1.paper press.head memory-0.edge-1 memory-1.edge-1 press.column-1 ${ORDER_END}`.split(' ');
for (const [parts, order] of [[UP_PARTS, UP_ORDER], [DOWN_PARTS, DOWN_ORDER]] as const) {
  const rank = new Map(order.map((name, index) => [name, index]));
  for (const part of parts) part.key = rank.get(part.name)!;
}
export const AGENT_STEP_PART_COUNT = UP_PARTS.length;
export const AGENT_STEP_POSES = {up: UP_PARTS, down: DOWN_PARTS};
export function agentStepPartOrder(stamped: boolean): AgentStepPart[] {
  return (stamped ? DOWN_PARTS : UP_PARTS).slice().sort((a, b) => a.key - b.key);
}
