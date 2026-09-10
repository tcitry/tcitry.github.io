import { TRAIL_CAP, hash, type Body, type Camera, type Particle, type ThrowState } from "./orbit-types";

const BG = "#07080c";

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r | 0},${g | 0},${b | 0},${a})`;
}

export function screenToWorld(
  cam: Camera,
  sx: number,
  sy: number,
  w: number,
  h: number,
): { x: number; y: number } {
  return {
    x: cam.x + (sx - w / 2 - cam.shakeX) / cam.zoom,
    y: cam.y + (sy - h / 2 - cam.shakeY) / cam.zoom,
  };
}

export function applyCamera(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, dpr = 1): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(w / 2 + cam.shakeX, h / 2 + cam.shakeY);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  dpr: number,
  cam: Camera,
  bodies: Body[],
  particles: Particle[],
  throwState: ThrowState,
  predict: Float32Array,
  predictLen: number,
  trailsOn: boolean,
  now: number,
  alpha: number,
  reduced: boolean,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, cssW, cssH);

  drawNebula(ctx, cam, cssW, cssH);
  drawStars(ctx, cam, cssW, cssH);

  applyCamera(ctx, cam, cssW, cssH, dpr);

  if (trailsOn) {
    for (let i = 0; i < bodies.length; i++) {
      if (bodies[i].alive) drawTrail(ctx, bodies[i], cam.zoom);
    }
  }

  if (throwState.active && predictLen > 1) {
    drawPredict(ctx, predict, predictLen, cam.zoom);
  }

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.alive) drawParticle(ctx, p, cam.zoom);
  }

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (!b.alive) continue;
    const x = b.px + (b.x - b.px) * alpha;
    const y = b.py + (b.y - b.py) * alpha;
    drawBody(ctx, b, x, y, now, cam.zoom, reduced);
  }

  if (throwState.active) {
    drawThrowGhost(ctx, throwState, cam.zoom, now);
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawVignette(ctx, cssW, cssH);
}

function drawStars(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number): void {
  const layers = [
    { count: 70, par: 0.12, size: 1.0, alpha: 0.38 },
    { count: 50, par: 0.28, size: 1.25, alpha: 0.55 },
    { count: 28, par: 0.5, size: 1.6, alpha: 0.7 },
  ];
  for (let L = 0; L < layers.length; L++) {
    const layer = layers[L];
    for (let i = 0; i < layer.count; i++) {
      const n = i * 17 + L * 101;
      const hx = hash(n);
      const hy = hash(n + 3);
      const hb = hash(n + 9);
      const sx = ((hx + cam.x * layer.par * 0.0013) % 1) * w;
      const sy = ((hy + cam.y * layer.par * 0.0013) % 1) * h;
      const x = sx < 0 ? sx + w : sx;
      const y = sy < 0 ? sy + h : sy;
      const a = layer.alpha * (0.45 + hb * 0.55);
      ctx.fillStyle = rgba(214, 220, 230, a);
      const s = layer.size * (0.6 + hb * 0.8);
      ctx.fillRect(x, y, s, s);
    }
  }
}

function drawNebula(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number): void {
  const blobs = [
    { hx: 0.28, hy: 0.4, r: 0.55, cr: 42, cg: 58, cb: 78, a: 0.07, par: 0.08 },
    { hx: 0.72, hy: 0.62, r: 0.48, cr: 72, cg: 56, cb: 40, a: 0.045, par: 0.11 },
    { hx: 0.5, hy: 0.18, r: 0.4, cr: 50, cg: 70, cb: 82, a: 0.05, par: 0.06 },
  ];
  for (const blob of blobs) {
    const x = blob.hx * w - cam.x * blob.par;
    const y = blob.hy * h - cam.y * blob.par;
    const rad = blob.r * Math.max(w, h);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, rgba(blob.cr, blob.cg, blob.cb, blob.a));
    g.addColorStop(1, rgba(blob.cr, blob.cg, blob.cb, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function drawTrail(ctx: CanvasRenderingContext2D, b: Body, zoom: number): void {
  const n = b.trailCount;
  if (n < 3) return;
  const start = b.trailCount === TRAIL_CAP ? b.trailHead : 0;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(0.8, (b.radius * 0.22) ) / zoom * 0.9;

  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const idx = (start + k) % TRAIL_CAP;
    const x = b.trailX[idx];
    const y = b.trailY[idx];
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = rgba(b.r, b.g, b.b, 0.16);
  ctx.stroke();

  const tail = Math.min(n, 48);
  ctx.beginPath();
  for (let k = n - tail; k < n; k++) {
    const idx = (start + k) % TRAIL_CAP;
    if (k === n - tail) ctx.moveTo(b.trailX[idx], b.trailY[idx]);
    else ctx.lineTo(b.trailX[idx], b.trailY[idx]);
  }
  ctx.strokeStyle = rgba(b.r, b.g, b.b, 0.42);
  ctx.lineWidth = Math.max(1, (b.radius * 0.28)) / zoom;
  ctx.stroke();
}

function drawPredict(ctx: CanvasRenderingContext2D, pts: Float32Array, len: number, zoom: number): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < len; i++) {
    ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  }
  ctx.strokeStyle = "rgba(196, 214, 226, 0.55)";
  ctx.lineWidth = 1.6 / zoom;
  ctx.setLineDash([6 / zoom, 5 / zoom]);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.setLineDash([]);

  const last = len - 1;
  ctx.beginPath();
  ctx.arc(pts[last * 2], pts[last * 2 + 1], 2.4 / zoom, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(232, 236, 242, 0.7)";
  ctx.fill();
}

function drawBody(
  ctx: CanvasRenderingContext2D,
  b: Body,
  x: number,
  y: number,
  now: number,
  zoom: number,
  reduced: boolean,
): void {
  const rad = b.radius;

  if (b.kind === "star" || b.kind === "giant") {
    const halo = ctx.createRadialGradient(x, y, rad * 0.2, x, y, rad * (b.kind === "star" ? 4.2 : 2.6));
    halo.addColorStop(0, rgba(b.r, b.g, b.b, b.kind === "star" ? 0.28 : 0.14));
    halo.addColorStop(1, rgba(b.r, b.g, b.b, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, rad * (b.kind === "star" ? 4.2 : 2.6), 0, Math.PI * 2);
    ctx.fill();
  }

  const atmo = ctx.createRadialGradient(x, y, rad * 0.85, x, y, rad * 1.55);
  atmo.addColorStop(0, rgba(b.r, b.g, b.b, 0.18));
  atmo.addColorStop(1, rgba(b.r, b.g, b.b, 0));
  ctx.fillStyle = atmo;
  ctx.beginPath();
  ctx.arc(x, y, rad * 1.55, 0, Math.PI * 2);
  ctx.fill();

  const lx = x - rad * 0.32;
  const ly = y - rad * 0.34;
  const sphere = ctx.createRadialGradient(lx, ly, rad * 0.08, x, y, rad);
  sphere.addColorStop(0, rgba(Math.min(255, b.r + 48), Math.min(255, b.g + 44), Math.min(255, b.b + 40), 1));
  sphere.addColorStop(0.45, rgba(b.r, b.g, b.b, 1));
  sphere.addColorStop(1, rgba(b.r * 0.28, b.g * 0.3, b.b * 0.34, 1));
  ctx.fillStyle = sphere;
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(lx, ly, rad * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = rgba(255, 255, 255, b.kind === "star" ? 0.45 : 0.18);
  ctx.fill();

  if (b.kind === "star" && !reduced) {
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.0022 + b.id);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = rgba(b.r, b.g, b.b, 0.12 + pulse * 0.1);
    ctx.lineWidth = 1.2 / zoom;
    const rays = 6;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + now * 0.00012;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * rad * 1.15, y + Math.sin(a) * rad * 1.15);
      ctx.lineTo(x + Math.cos(a) * rad * (2.4 + pulse * 0.4), y + Math.sin(a) * rad * (2.4 + pulse * 0.4));
      ctx.stroke();
    }
    ctx.restore();
  }

  if (b.pinned) {
    ctx.beginPath();
    ctx.arc(x, y, rad + 3.2 / zoom, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(196, 214, 226, 0.35)";
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([3 / zoom, 3 / zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawThrowGhost(ctx: CanvasRenderingContext2D, t: ThrowState, zoom: number, now: number): void {
  const pulse = 0.65 + 0.35 * Math.sin(now * 0.008);
  ctx.beginPath();
  ctx.arc(t.x, t.y, 10, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(210, 222, 232, 0.35 * pulse);
  ctx.lineWidth = 1.4 / zoom;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(t.x, t.y, 4.2, 0, Math.PI * 2);
  ctx.fillStyle = rgba(232, 236, 242, 0.85);
  ctx.fill();

  const speed = Math.hypot(t.vx, t.vy);
  if (speed < 4) return;
  const ang = Math.atan2(t.vy, t.vx);
  const len = Math.min(90, 16 + speed * 0.18);
  const ex = t.x + Math.cos(ang) * len;
  const ey = t.y + Math.sin(ang) * len;
  ctx.beginPath();
  ctx.moveTo(t.x, t.y);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = "rgba(232, 236, 242, 0.7)";
  ctx.lineWidth = 1.8 / zoom;
  ctx.lineCap = "round";
  ctx.stroke();
  const ah = 8;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(ang - 0.45) * ah, ey - Math.sin(ang - 0.45) * ah);
  ctx.lineTo(ex - Math.cos(ang + 0.45) * ah, ey - Math.sin(ang + 0.45) * ah);
  ctx.closePath();
  ctx.fillStyle = "rgba(232, 236, 242, 0.8)";
  ctx.fill();
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, zoom: number): void {
  const t = p.life / p.maxLife;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  ctx.fillStyle = rgba(p.r, p.g, p.b, 0.15 + t * 0.7);
  ctx.fill();
  void zoom;
}

function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, "rgba(7,8,12,0)");
  g.addColorStop(1, "rgba(7,8,12,0.55)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

export function drawSelectedRing(ctx: CanvasRenderingContext2D, b: Body, alpha: number, zoom: number): void {
  const x = b.px + (b.x - b.px) * alpha;
  const y = b.py + (b.y - b.py) * alpha;
  ctx.beginPath();
  ctx.arc(x, y, b.radius + 5 / zoom, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(232, 236, 242, 0.7)";
  ctx.lineWidth = 1.4 / zoom;
  ctx.stroke();
}
