import {
  TRAIL_CAP,
  colorForKind,
  kindFromMass,
  radiusFromMass,
  type Body,
  type MassKind,
} from "./orbit-types";

let nextId = 1;

export function allocBody(): Body {
  return {
    id: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ax: 0,
    ay: 0,
    px: 0,
    py: 0,
    mass: 1,
    radius: 4,
    kind: "dust",
    pinned: false,
    alive: false,
    r: 180,
    g: 180,
    b: 190,
    trailX: new Float32Array(TRAIL_CAP),
    trailY: new Float32Array(TRAIL_CAP),
    trailHead: 0,
    trailCount: 0,
    trailAcc: 0,
  };
}

export function resetBody(
  b: Body,
  x: number,
  y: number,
  vx: number,
  vy: number,
  mass: number,
  kind?: MassKind,
  pinned = false,
): Body {
  b.id = nextId++;
  b.x = x;
  b.y = y;
  b.vx = vx;
  b.vy = vy;
  b.ax = 0;
  b.ay = 0;
  b.px = x;
  b.py = y;
  b.mass = mass;
  b.kind = kind ?? kindFromMass(mass);
  b.radius = radiusFromMass(mass);
  b.pinned = pinned;
  b.alive = true;
  const [r, g, bl] = colorForKind(b.kind, b.id);
  b.r = r;
  b.g = g;
  b.b = bl;
  b.trailHead = 0;
  b.trailCount = 0;
  b.trailAcc = 0;
  return b;
}

export function recordTrail(b: Body, dt: number): void {
  b.trailAcc += dt;
  if (b.trailAcc < 0.028) return;
  b.trailAcc = 0;
  const i = b.trailHead;
  b.trailX[i] = b.x;
  b.trailY[i] = b.y;
  b.trailHead = (i + 1) % TRAIL_CAP;
  if (b.trailCount < TRAIL_CAP) b.trailCount++;
}

export function mixColor(a: Body, b: Body, massA: number, massB: number): void {
  const m = massA + massB;
  a.r = (a.r * massA + b.r * massB) / m;
  a.g = (a.g * massA + b.g * massB) / m;
  a.b = (a.b * massA + b.b * massB) / m;
}
