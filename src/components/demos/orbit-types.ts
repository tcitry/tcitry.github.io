export type MassKind = "dust" | "moon" | "planet" | "giant" | "star";
export type CollideMode = "merge" | "bounce";
export type ScenarioId = "garden" | "binary" | "figure8" | "slingshot" | "empty";

export type Body = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  px: number;
  py: number;
  mass: number;
  radius: number;
  kind: MassKind;
  pinned: boolean;
  alive: boolean;
  r: number;
  g: number;
  b: number;
  trailX: Float32Array;
  trailY: Float32Array;
  trailHead: number;
  trailCount: number;
  trailAcc: number;
};

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  r: number;
  g: number;
  b: number;
  alive: boolean;
};

export type Camera = {
  x: number;
  y: number;
  zoom: number;
  shakeX: number;
  shakeY: number;
};

export type ThrowState = {
  active: boolean;
  bodyId: number | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: MassKind;
};

export type MassPreset = {
  kind: MassKind;
  label: string;
  mass: number;
  r: number;
  g: number;
  b: number;
};

export const TRAIL_CAP = 220;

export const MASS_PRESETS: readonly MassPreset[] = [
  { kind: "dust", label: "尘埃", mass: 1.4, r: 176, g: 184, b: 196 },
  { kind: "moon", label: "卫星", mass: 10, r: 198, g: 210, b: 222 },
  { kind: "planet", label: "行星", mass: 52, r: 122, g: 176, b: 188 },
  { kind: "giant", label: "巨星", mass: 240, r: 196, g: 168, b: 132 },
  { kind: "star", label: "恒星", mass: 2200, r: 242, g: 228, b: 196 },
] as const;

export const G = 2700;
export const SOFTEN2 = 196;
export const PHYS_DT = 1 / 96;
export const THROW_GAIN = 1.55;
export const MAX_BODIES = 48;
export const PREDICT_STEPS = 220;
export const PREDICT_STRIDE = 2;

export function radiusFromMass(mass: number): number {
  return Math.max(3.2, 2.55 * Math.cbrt(mass));
}

export function kindFromMass(mass: number): MassKind {
  if (mass >= 1400) return "star";
  if (mass >= 160) return "giant";
  if (mass >= 28) return "planet";
  if (mass >= 5) return "moon";
  return "dust";
}

export function colorForKind(kind: MassKind, salt: number): [number, number, number] {
  const preset = MASS_PRESETS.find((p) => p.kind === kind) ?? MASS_PRESETS[2];
  const j = ((salt * 17) % 13) - 6;
  return [
    clampByte(preset.r + j * 3),
    clampByte(preset.g + j * 2),
    clampByte(preset.b - j),
  ];
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, n | 0));
}

export function hash(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}
