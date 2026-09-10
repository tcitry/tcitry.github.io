import { SimAudio } from "./orbit-audio";
import { allocBody, mixColor, recordTrail, resetBody } from "./orbit-body";
import {
  applyCamera,
  drawScene,
  drawSelectedRing,
  screenToWorld,
} from "./orbit-render";
import { populateScenario, SCENARIOS } from "./orbit-scenarios";
import { useOrbit, type OrbitApi } from "./orbit-store";
import {
  G,
  MASS_PRESETS,
  MAX_BODIES,
  PHYS_DT,
  PREDICT_STEPS,
  PREDICT_STRIDE,
  SOFTEN2,
  THROW_GAIN,
  kindFromMass,
  radiusFromMass,
  type Body,
  type Camera,
  type Particle,
  type ScenarioId,
  type ThrowState,
} from "./orbit-types";

type Pointer = {
  id: number;
  sx: number;
  sy: number;
  startSx: number;
  startSy: number;
};

export class OrbitEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private lastTs = 0;
  private acc = 0;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private bodies: Body[] = [];
  private pool: Body[] = [];
  private particles: Particle[] = [];
  private particlePool: Particle[] = [];
  private cam: Camera = { x: 0, y: 0, zoom: 0.7, shakeX: 0, shakeY: 0 };
  private trauma = 0;
  private throwState: ThrowState = {
    active: false,
    bodyId: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    kind: "planet",
  };
  private predict = new Float32Array(PREDICT_STEPS * 2);
  private predictLen = 0;
  private ghost: { x: number; y: number; vx: number; vy: number; ax: number; ay: number; mass: number; radius: number; alive: boolean; pinned: boolean }[] = [];
  private pointers = new Map<number, Pointer>();
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private panning = false;
  private panPointerId: number | null = null;
  private panLastX = 0;
  private panLastY = 0;
  private held: Body | null = null;
  private heldPrevPinned = false;
  private throwDragged = false;
  private audio = new SimAudio();
  private reduced = false;
  private uiClock = 0;
  private viewRadius = 520;
  private userPanned = false;
  private simTime = 0;
  private lastFollow = false;
  private ro: ResizeObserver | null = null;
  private api: OrbitApi;
  private onVis = () => {};
  private boundKey = (e: KeyboardEvent) => this.onKey(e);
  private boundDown = (e: PointerEvent) => this.onDown(e);
  private boundMove = (e: PointerEvent) => this.onMove(e);
  private boundUp = (e: PointerEvent) => this.onUp(e);
  private boundCancel = (e: PointerEvent) => this.onCancel(e);
  private boundBlur = () => this.resetGesture();
  private boundWheel = (e: WheelEvent) => this.onWheel(e);
  private boundContext = (e: Event) => e.preventDefault();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) throw new Error("Canvas 2D is unavailable");
    this.ctx = ctx;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.api = {
      loadScenario: (id) => this.loadScenario(id),
      clear: () => this.clear(true),
      deleteSelected: () => this.deleteSelected(),
      recenter: () => this.recenter(),
    };
    useOrbit.setState({ api: this.api });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.canvas.parentElement ?? this.canvas);
    this.canvas.addEventListener("pointerdown", this.boundDown);
    window.addEventListener("pointermove", this.boundMove);
    window.addEventListener("pointerup", this.boundUp);
    window.addEventListener("pointercancel", this.boundCancel);
    window.addEventListener("blur", this.boundBlur);
    this.canvas.addEventListener("wheel", this.boundWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.boundContext);
    window.addEventListener("keydown", this.boundKey);
    this.onVis = () => {
      this.acc = 0;
      this.lastTs = performance.now();
      if (document.hidden) this.resetGesture();
    };
    document.addEventListener("visibilitychange", this.onVis);
    this.loadScenario(useOrbit.getState().scenario);
    this.lastTs = performance.now();
    const loop = (ts: number) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (ts - this.lastTs) / 1000);
      this.lastTs = ts;
      this.tick(dt, ts);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
    this.canvas.removeEventListener("pointerdown", this.boundDown);
    window.removeEventListener("pointermove", this.boundMove);
    window.removeEventListener("pointerup", this.boundUp);
    window.removeEventListener("pointercancel", this.boundCancel);
    window.removeEventListener("blur", this.boundBlur);
    this.canvas.removeEventListener("wheel", this.boundWheel);
    this.canvas.removeEventListener("contextmenu", this.boundContext);
    window.removeEventListener("keydown", this.boundKey);
    document.removeEventListener("visibilitychange", this.onVis);
    this.resetGesture();
    this.audio.destroy();
    this.clear(false);
    if (useOrbit.getState().api === this.api) {
      useOrbit.setState({
        api: { loadScenario: () => {}, clear: () => {}, deleteSelected: () => {}, recenter: () => {} },
        bodyCount: 0, selectedId: null, selectedMass: 0, selectedSpeed: 0,
        simTime: 0, throwing: false, follow: false,
      });
    }
  }

  loadScenario(id: ScenarioId): void {
    this.clear(false);
    this.userPanned = false;
    this.simTime = 0;
    useOrbit.setState({ scenario: id, follow: false, selectedId: null, simTime: 0 });
    this.viewRadius = populateScenario(id, (x, y, vx, vy, mass, kind, pinned) =>
      this.spawn(x, y, vx, vy, mass, kind, pinned),
    );
    const def = SCENARIOS.find((s) => s.id === id);
    if (def) this.viewRadius = def.viewRadius;
    this.fitView(this.viewRadius);
    this.syncUi(true);
  }

  clear(syncScenario: boolean): void {
    this.resetGesture();
    this.acc = 0;
    for (const b of this.bodies) {
      b.alive = false;
      this.pool.push(b);
    }
    this.bodies.length = 0;
    for (const p of this.particles) {
      p.alive = false;
      this.particlePool.push(p);
    }
    this.particles.length = 0;
    this.held = null;
    this.throwState.active = false;
    this.predictLen = 0;
    this.simTime = 0;
    if (syncScenario) {
      useOrbit.setState({
        scenario: "empty",
        selectedId: null,
        selectedMass: 0,
        selectedSpeed: 0,
        bodyCount: 0,
        simTime: 0,
        throwing: false,
      });
    }
  }

  deleteSelected(): void {
    const id = useOrbit.getState().selectedId;
    if (id == null) return;
    const b = this.bodies.find((x) => x.id === id && x.alive);
    if (!b) return;
    if (this.held === b) this.resetGesture();
    this.kill(b);
    useOrbit.setState({ selectedId: null, selectedMass: 0, selectedSpeed: 0 });
  }

  recenter(): void {
    this.userPanned = false;
    this.fitView(this.viewRadius);
    useOrbit.setState({ follow: false });
  }

  private spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    mass: number,
    kind?: Body["kind"],
    pinned = false,
  ): Body {
    if (this.liveCount() >= MAX_BODIES) this.cullLightest();
    const b = this.pool.pop() ?? allocBody();
    resetBody(b, x, y, vx, vy, mass, kind, pinned);
    this.bodies.push(b);
    return b;
  }

  private liveCount(): number {
    let n = 0;
    for (const b of this.bodies) if (b.alive) n++;
    return n;
  }

  private cullLightest(): void {
    let best: Body | null = null;
    for (const b of this.bodies) {
      if (!b.alive || b.pinned) continue;
      if (!best || b.mass < best.mass) best = b;
    }
    if (best) this.kill(best);
  }

  private kill(b: Body): void {
    b.alive = false;
  }

  private compact(): void {
    let w = 0;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      if (b.alive) this.bodies[w++] = b;
      else this.pool.push(b);
    }
    this.bodies.length = w;
    w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.alive) this.particles[w++] = p;
      else this.particlePool.push(p);
    }
    this.particles.length = w;
  }

  private fitView(radius: number): void {
    const short = Math.max(Math.min(this.cssW, this.cssH), 1);
    this.cam.zoom = Math.max(0.14, Math.min(2.4, short / (radius * 2.35)));
    this.cam.x = 0;
    this.cam.y = 0;
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const rect = parent.getBoundingClientRect();
    this.cssW = Math.max(1, rect.width);
    this.cssH = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(this.cssW * this.dpr);
    this.canvas.height = Math.floor(this.cssH * this.dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
  }

  private tick(dt: number, now: number): void {
    const st = useOrbit.getState();
    if (!st.paused && !this.throwState.active) {
      this.acc += dt * st.timeScale;
      const maxSteps = 12;
      let steps = 0;
      while (this.acc >= PHYS_DT && steps < maxSteps) {
        this.physicsStep(PHYS_DT, st.trails, st.collide);
        this.acc -= PHYS_DT;
        steps++;
      }
      if (steps === maxSteps) this.acc = 0;
    } else {
      this.acc = 0;
    }

    this.stepParticles(dt);
    this.updateThrowPredict();
    this.updateCamera(dt, st.follow, st.selectedId);
    if (!this.reduced) {
      this.trauma = Math.max(0, this.trauma - dt * 2.4);
      const shake = this.trauma * this.trauma;
      this.cam.shakeX = (Math.random() * 2 - 1) * shake * 10;
      this.cam.shakeY = (Math.random() * 2 - 1) * shake * 10;
    } else {
      this.cam.shakeX = 0;
      this.cam.shakeY = 0;
    }

    const leftover = st.paused || this.throwState.active ? 1 : this.acc / PHYS_DT;
    drawScene(
      this.ctx,
      this.cssW,
      this.cssH,
      this.dpr,
      this.cam,
      this.bodies,
      this.particles,
      this.throwState,
      this.predict,
      this.predictLen,
      st.trails,
      now,
      leftover,
      this.reduced,
    );
    if (st.selectedId != null) {
      const sel = this.bodies.find((b) => b.id === st.selectedId && b.alive);
      if (sel) {
        applyCamera(this.ctx, this.cam, this.cssW, this.cssH, this.dpr);
        drawSelectedRing(this.ctx, sel, leftover, this.cam.zoom);
      }
    }

    this.uiClock += dt;
    if (this.uiClock > 0.12) {
      this.uiClock = 0;
      this.syncUi(false);
    }

    this.compact();
  }

  private physicsStep(dt: number, trails: boolean, collide: "merge" | "bounce"): void {
    const subs = this.neededSubsteps(dt);
    const h = dt / subs;
    for (let s = 0; s < subs; s++) {
      this.advance(h, collide, s === 0);
    }
    if (trails) {
      for (let i = 0; i < this.bodies.length; i++) {
        const b = this.bodies[i];
        if (b.alive) recordTrail(b, dt);
      }
    }
    this.simTime += dt;
  }

  private neededSubsteps(dt: number): number {
    let need = 1;
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      const a = this.bodies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.bodies[j];
        if (!b.alive) continue;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const rel = Math.hypot(a.vx - b.vx, a.vy - b.vy);
        const floor = Math.max(10, (a.radius + b.radius) * 0.6);
        const ratio = (rel * dt) / floor;
        if (ratio > need) need = ratio;
        if (dist < (a.radius + b.radius) * 3 && dist > 0) {
          const close = ((a.radius + b.radius) * 3) / dist;
          if (close > need) need = close;
        }
      }
    }
    return Math.max(1, Math.min(6, Math.ceil(need)));
  }

  private advance(dt: number, collide: "merge" | "bounce", capturePrev: boolean): void {
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      if (!b.alive) continue;
      if (capturePrev) {
        b.px = b.x;
        b.py = b.y;
      }
      b.ax = 0;
      b.ay = 0;
    }

    this.accumulateForces();

    for (let i = 0; i < n; i++) {
      const b = this.bodies[i];
      if (!b.alive || b.pinned || (this.held && this.held.id === b.id)) continue;
      b.vx += b.ax * dt;
      b.vy += b.ay * dt;
      const speed = Math.hypot(b.vx, b.vy);
      const cap = 1400;
      if (speed > cap) {
        b.vx = (b.vx / speed) * cap;
        b.vy = (b.vy / speed) * cap;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }

    this.resolveCollisions(collide);
  }

  private accumulateForces(): void {
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      const a = this.bodies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.bodies[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const r2 = dx * dx + dy * dy + SOFTEN2;
        const inv = 1 / Math.sqrt(r2);
        const inv3 = inv * inv * inv;
        const s = G * inv3;
        const ax = dx * s;
        const ay = dy * s;
        a.ax += ax * b.mass;
        a.ay += ay * b.mass;
        b.ax -= ax * a.mass;
        b.ay -= ay * a.mass;
      }
    }
  }

  private resolveCollisions(mode: "merge" | "bounce"): void {
    const n = this.bodies.length;
    for (let i = 0; i < n; i++) {
      const a = this.bodies[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.bodies[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const min = (a.radius + b.radius) * 0.92;
        if (dist >= min) continue;
        if (mode === "merge") {
          this.merge(a, b);
          if (!a.alive) break;
        } else this.bounce(a, b, dx, dy, dist, min);
      }
    }
  }

  private merge(a: Body, b: Body): void {
    const survivor = a.pinned ? a : b.pinned ? b : a.mass >= b.mass ? a : b;
    const other = survivor === a ? b : a;
    const m1 = survivor.mass;
    const m2 = other.mass;
    const m = m1 + m2;
    const energy = 0.5 * (m1 * m2) / m * ((a.vx - b.vx) ** 2 + (a.vy - b.vy) ** 2);
    const cx = (survivor.x * m1 + other.x * m2) / m;
    const cy = (survivor.y * m1 + other.y * m2) / m;
    if (!survivor.pinned) {
      survivor.vx = (survivor.vx * m1 + other.vx * m2) / m;
      survivor.vy = (survivor.vy * m1 + other.vy * m2) / m;
      survivor.x = cx;
      survivor.y = cy;
    }
    mixColor(survivor, other, m1, m2);
    survivor.mass = m;
    survivor.kind = kindFromMass(m);
    survivor.radius = radiusFromMass(m);
    other.alive = false;
    this.burst(cx, cy, survivor, Math.min(36, 8 + Math.sqrt(energy) * 0.08));
    this.trauma = Math.min(1, this.trauma + Math.min(0.55, 0.12 + Math.log(m) * 0.04));
    this.audio.thump(m);
    if (this.held && this.held.id === other.id) this.held = null;
  }

  private bounce(a: Body, b: Body, dx: number, dy: number, dist: number, min: number): void {
    // At exact overlap, use relative motion (or a deterministic axis) as the normal.
    const relativeSpeed = Math.hypot(a.vx - b.vx, a.vy - b.vy);
    const nx = dist > 1e-6 ? dx / dist : relativeSpeed > 1e-6 ? (a.vx - b.vx) / relativeSpeed : 1;
    const ny = dist > 1e-6 ? dy / dist : relativeSpeed > 1e-6 ? (a.vy - b.vy) / relativeSpeed : 0;
    const ima = a.pinned ? 0 : 1 / a.mass;
    const imb = b.pinned ? 0 : 1 / b.mass;
    const denom = ima + imb;
    if (denom === 0) return;
    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rel < 0) {
      const restitution = 0.72;
      const impulse = (-(1 + restitution) * rel) / denom;
      a.vx -= impulse * ima * nx;
      a.vy -= impulse * ima * ny;
      b.vx += impulse * imb * nx;
      b.vy += impulse * imb * ny;
      this.trauma = Math.min(1, this.trauma + 0.08);
      this.audio.tick();
    }
    const overlap = min - dist;
    if (denom > 0) {
      if (!a.pinned) {
        a.x -= nx * overlap * (ima / denom);
        a.y -= ny * overlap * (ima / denom);
      }
      if (!b.pinned) {
        b.x += nx * overlap * (imb / denom);
        b.y += ny * overlap * (imb / denom);
      }
    }
  }

  private burst(x: number, y: number, src: Body, count: number): void {
    const n = this.reduced ? Math.min(8, count * 0.4) : count;
    for (let i = 0; i < n; i++) {
      const p = this.particlePool.pop() ?? {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 0,
        size: 1,
        r: 0,
        g: 0,
        b: 0,
        alive: false,
      };
      const ang = Math.random() * Math.PI * 2;
      const sp = 20 + Math.random() * 90;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(ang) * sp;
      p.vy = Math.sin(ang) * sp;
      p.maxLife = 0.35 + Math.random() * 0.55;
      p.life = p.maxLife;
      p.size = 1.2 + Math.random() * 2.4;
      p.r = src.r;
      p.g = src.g;
      p.b = src.b;
      p.alive = true;
      this.particles.push(p);
    }
  }

  private stepParticles(dt: number): void {
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
    }
  }

  private updateCamera(dt: number, follow: boolean, selectedId: number | null): void {
    if (follow && !this.lastFollow) this.userPanned = false;
    this.lastFollow = follow;
    if (!follow || this.panning) return;
    let tx = 0;
    let ty = 0;
    const sel = selectedId != null ? this.bodies.find((b) => b.id === selectedId && b.alive) : null;
    if (sel) {
      tx = sel.x;
      ty = sel.y;
    } else {
      let m = 0;
      let sx = 0;
      let sy = 0;
      for (const b of this.bodies) {
        if (!b.alive) continue;
        sx += b.x * b.mass;
        sy += b.y * b.mass;
        m += b.mass;
      }
      if (m > 0) {
        tx = sx / m;
        ty = sy / m;
      }
    }
    const k = 1 - Math.exp(-3.2 * dt);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  }

  private updateThrowPredict(): void {
    if (!this.throwState.active) {
      this.predictLen = 0;
      return;
    }
    const ghosts = this.ghost;
    ghosts.length = 0;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      if (this.throwState.bodyId != null && b.id === this.throwState.bodyId) continue;
      ghosts.push({
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        ax: 0,
        ay: 0,
        mass: b.mass,
        radius: b.radius,
        alive: true,
        pinned: b.pinned,
      });
    }
    const preset = MASS_PRESETS.find((p) => p.kind === this.throwState.kind) ?? MASS_PRESETS[2];
    const mass = this.throwState.bodyId != null
      ? (this.bodies.find((b) => b.id === this.throwState.bodyId)?.mass ?? preset.mass)
      : preset.mass;
    ghosts.push({
      x: this.throwState.x,
      y: this.throwState.y,
      vx: this.throwState.vx,
      vy: this.throwState.vy,
      ax: 0,
      ay: 0,
      mass,
      radius: radiusFromMass(mass),
      alive: true,
      pinned: this.held !== null && this.heldPrevPinned && !this.throwDragged,
    });
    const probe = ghosts.length - 1;
    const dt = PHYS_DT * 2.2;
    let written = 0;
    this.predict[0] = ghosts[probe].x;
    this.predict[1] = ghosts[probe].y;
    written = 1;
    for (let step = 0; step < PREDICT_STEPS; step++) {
      const n = ghosts.length;
      for (let i = 0; i < n; i++) {
        ghosts[i].ax = 0;
        ghosts[i].ay = 0;
      }
      for (let i = 0; i < n; i++) {
        const a = ghosts[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < n; j++) {
          const b = ghosts[j];
          if (!b.alive) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const r2 = dx * dx + dy * dy + SOFTEN2;
          const inv = 1 / Math.sqrt(r2);
          const s = G * inv * inv * inv;
          a.ax += dx * s * b.mass;
          a.ay += dy * s * b.mass;
          b.ax -= dx * s * a.mass;
          b.ay -= dy * s * a.mass;
        }
      }
      for (let i = 0; i < n; i++) {
        const g = ghosts[i];
        if (!g.alive || g.pinned) continue;
        g.vx += g.ax * dt;
        g.vy += g.ay * dt;
        const speed = Math.hypot(g.vx, g.vy);
        if (speed > 1400) {
          g.vx = (g.vx / speed) * 1400;
          g.vy = (g.vy / speed) * 1400;
        }
        g.x += g.vx * dt;
        g.y += g.vy * dt;
      }
      const p = ghosts[probe];
      for (let i = 0; i < n; i++) {
        if (i === probe || !ghosts[i].alive) continue;
        const dx = ghosts[i].x - p.x;
        const dy = ghosts[i].y - p.y;
        const min = (ghosts[i].radius + p.radius) * 0.92;
        if (dx * dx + dy * dy < min * min) {
          this.predictLen = written;
          return;
        }
      }
      if (step % PREDICT_STRIDE === 0 && written < PREDICT_STEPS) {
        this.predict[written * 2] = p.x;
        this.predict[written * 2 + 1] = p.y;
        written++;
      }
    }
    this.predictLen = written;
  }

  private clientToLocal(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hitTest(wx: number, wy: number): Body | null {
    let best: Body | null = null;
    let bestD = Infinity;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - wx, b.y - wy);
      const pad = Math.max(10 / this.cam.zoom, b.radius * 1.15);
      if (d < pad && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best;
  }

  private onDown(e: PointerEvent): void {
    if (e.button === 2 || e.button === 1) {
      this.resetGesture();
      this.panPointerId = e.pointerId;
      this.panning = true;
      this.userPanned = true;
      useOrbit.setState({ follow: false });
      this.panLastX = e.clientX;
      this.panLastY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const st = useOrbit.getState();
    if (st.intro) {
      st.dismissIntro();
      return;
    }
    this.audio.unlock();
    const local = this.clientToLocal(e);
    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      sx: local.x,
      sy: local.y,
      startSx: local.x,
      startSy: local.y,
    });
    this.canvas.setPointerCapture(e.pointerId);

    if (this.pointers.size >= 2) {
      this.cancelThrow();
      if (this.pointers.size > 2) return;
      const pts = [...this.pointers.values()];
      this.pinchStartDist = Math.hypot(pts[0].sx - pts[1].sx, pts[0].sy - pts[1].sy);
      this.pinchStartZoom = this.cam.zoom;
      this.panning = true;
      this.userPanned = true;
      useOrbit.setState({ follow: false });
      this.panLastX = (pts[0].sx + pts[1].sx) / 2;
      this.panLastY = (pts[0].sy + pts[1].sy) / 2;
      return;
    }

    const world = screenToWorld(this.cam, local.x, local.y, this.cssW, this.cssH);
    const hit = this.hitTest(world.x, world.y);
    const kind = st.massKind;
    this.throwState.active = true;
    this.throwDragged = false;
    this.throwState.bodyId = hit ? hit.id : null;
    this.throwState.x = hit ? hit.x : world.x;
    this.throwState.y = hit ? hit.y : world.y;
    this.throwState.vx = hit ? hit.vx : 0;
    this.throwState.vy = hit ? hit.vy : 0;
    this.throwState.kind = hit ? hit.kind : kind;
    if (hit) {
      this.held = hit;
      this.heldPrevPinned = hit.pinned;
      useOrbit.setState({ selectedId: hit.id, throwing: true });
    } else {
      this.held = null;
      useOrbit.setState({ selectedId: null, throwing: true });
    }
  }

  private onMove(e: PointerEvent): void {
    if (this.panning && e.pointerId === this.panPointerId) {
      const dx = e.clientX - this.panLastX;
      const dy = e.clientY - this.panLastY;
      this.panLastX = e.clientX;
      this.panLastY = e.clientY;
      this.cam.x -= dx / this.cam.zoom;
      this.cam.y -= dy / this.cam.zoom;
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const local = this.clientToLocal(e);
    p.sx = local.x;
    p.sy = local.y;

    if (this.pointers.size >= 2) {
      const pts = [...this.pointers.values()];
      const before = screenToWorld(this.cam, this.panLastX, this.panLastY, this.cssW, this.cssH);
      const dist = Math.hypot(pts[0].sx - pts[1].sx, pts[0].sy - pts[1].sy);
      if (this.pinchStartDist > 4) {
        const factor = dist / this.pinchStartDist;
        this.cam.zoom = Math.max(0.12, Math.min(5, this.pinchStartZoom * factor));
      }
      const mx = (pts[0].sx + pts[1].sx) / 2;
      const my = (pts[0].sy + pts[1].sy) / 2;
      const after = screenToWorld(this.cam, mx, my, this.cssW, this.cssH);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
      this.panLastX = mx;
      this.panLastY = my;
      this.userPanned = true;
      return;
    }

    if (!this.throwState.active) return;
    this.throwDragged = Math.hypot(p.startSx - local.x, p.startSy - local.y) > 8;
    this.throwState.vx = this.throwDragged ? (p.startSx - local.x) / this.cam.zoom * THROW_GAIN : (this.held?.vx ?? 0);
    this.throwState.vy = this.throwDragged ? (p.startSy - local.y) / this.cam.zoom * THROW_GAIN : (this.held?.vy ?? 0);
  }

  private onUp(e: PointerEvent): void {
    if (e.pointerId === this.panPointerId) {
      this.panPointerId = null;
      this.panning = false;
      this.releasePointer(e.pointerId);
      return;
    }
    this.onMove(e);
    const p = this.pointers.get(e.pointerId);
    this.releasePointer(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) {
      this.panning = false;
      this.pinchStartDist = 0;
    } else {
      const pts = [...this.pointers.values()];
      this.pinchStartDist = Math.hypot(pts[0].sx - pts[1].sx, pts[0].sy - pts[1].sy);
      this.pinchStartZoom = this.cam.zoom;
      this.panLastX = (pts[0].sx + pts[1].sx) / 2;
      this.panLastY = (pts[0].sy + pts[1].sy) / 2;
    }
    if (!p || !this.throwState.active) return;
    const drag = Math.hypot(p.sx - p.startSx, p.sy - p.startSy);
    const vx = this.throwState.vx;
    const vy = this.throwState.vy;
    const speed = Math.hypot(vx, vy);

    if (this.held) {
      this.held.pinned = this.heldPrevPinned;
      if (drag > 8) {
        this.held.vx = vx;
        this.held.vy = vy;
        this.held.pinned = false;
        this.audio.whoosh(speed);
      }
      this.held = null;
    } else if (this.liveCount() < MAX_BODIES || drag > 8) {
      const preset = MASS_PRESETS.find((m) => m.kind === this.throwState.kind) ?? MASS_PRESETS[2];
      const placed = this.spawn(
        this.throwState.x,
        this.throwState.y,
        drag > 8 ? vx : 0,
        drag > 8 ? vy : 0,
        preset.mass,
        preset.kind,
        false,
      );
      if (drag <= 8) this.audio.tick();
      else this.audio.whoosh(speed);
      useOrbit.setState({ selectedId: placed.id });
    }
    this.throwState.active = false;
    this.predictLen = 0;
    useOrbit.setState({ throwing: false });
    this.syncUi(true);
  }

  private onCancel(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId) && e.pointerId !== this.panPointerId) return;
    this.resetGesture();
  }

  private releasePointer(id: number): void {
    if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
  }

  private resetGesture(): void {
    this.cancelThrow();
    for (const id of this.pointers.keys()) this.releasePointer(id);
    if (this.panPointerId !== null) this.releasePointer(this.panPointerId);
    this.pointers.clear();
    this.panPointerId = null;
    this.panning = false;
    this.pinchStartDist = 0;
  }

  private cancelThrow(): void {
    if (this.held) {
      this.held.pinned = this.heldPrevPinned;
      this.held = null;
    }
    this.throwState.active = false;
    this.predictLen = 0;
    if (useOrbit.getState().api === this.api) useOrbit.setState({ throwing: false });
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const local = this.clientToLocal(e);
    const before = screenToWorld(this.cam, local.x, local.y, this.cssW, this.cssH);
    const factor = Math.exp(-e.deltaY * 0.0014);
    this.cam.zoom = Math.max(0.12, Math.min(5, this.cam.zoom * factor));
    const after = screenToWorld(this.cam, local.x, local.y, this.cssW, this.cssH);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.userPanned = true;
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (t?.closest?.('input, textarea, select, button, a, [contenteditable="true"], [role="slider"], [role="switch"]')) return;
    const st = useOrbit.getState();
    if (e.code === "Space") {
      e.preventDefault();
      st.togglePaused();
    } else if (e.code === "KeyC") {
      this.clear(true);
    } else if (e.code === "KeyR") {
      this.recenter();
    } else if (e.code === "KeyF") {
      useOrbit.setState({ follow: !st.follow });
      this.userPanned = false;
    } else if (e.code === "KeyT") {
      useOrbit.setState({ trails: !st.trails });
    } else if (e.code === "KeyM") {
      useOrbit.setState({ collide: st.collide === "merge" ? "bounce" : "merge" });
    } else if (e.code === "Digit1") st.setMassKind("dust");
    else if (e.code === "Digit2") st.setMassKind("moon");
    else if (e.code === "Digit3") st.setMassKind("planet");
    else if (e.code === "Digit4") st.setMassKind("giant");
    else if (e.code === "Digit5") st.setMassKind("star");
    else if (e.code === "Escape") {
      if (st.intro) st.dismissIntro();
      else {
        this.resetGesture();
        useOrbit.setState({ selectedId: null });
      }
    } else if (e.code === "Delete" || e.code === "Backspace") {
      this.deleteSelected();
    }
  }

  private syncUi(_force: boolean): void {
    const count = this.liveCount();
    const selId = useOrbit.getState().selectedId;
    const sel = selId != null ? this.bodies.find((b) => b.id === selId && b.alive) : null;
    useOrbit.setState({
      bodyCount: count,
      selectedId: sel ? sel.id : null,
      selectedMass: sel ? sel.mass : 0,
      selectedSpeed: sel ? Math.hypot(sel.vx, sel.vy) : 0,
      simTime: this.simTime,
    });
  }
}
