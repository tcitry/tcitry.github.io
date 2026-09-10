export const MIN_SCALE = 8e-8;
export const MAX_SCALE = 6;
export const MIN_ITER = 64;
export const MAX_ITER = 1024;
export const DEFAULT_SCALE = 2.55;
export const DEFAULT_RE = -0.55;
export const DEFAULT_IM = 0;

export function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function clampScale(scale: number) {
  return clamp(scale, MIN_SCALE, MAX_SCALE);
}

export function clampIter(iter: number) {
  return Math.round(clamp(iter, MIN_ITER, MAX_ITER));
}

/** Suggested iteration count from zoom depth. */
export function iterForScale(scale: number) {
  const zoom = DEFAULT_SCALE / Math.max(scale, MIN_SCALE);
  return clampIter(100 + 55 * Math.log2(zoom + 1));
}

export function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function lerpLog(a: number, b: number, t: number) {
  const sa = Math.max(a, MIN_SCALE);
  const sb = Math.max(b, MIN_SCALE);
  return Math.exp(lerp(Math.log(sa), Math.log(sb), t));
}

export type View = {
  re: number;
  im: number;
  scale: number;
};

export function lerpView(from: View, to: View, t: number): View {
  return {
    re: lerp(from.re, to.re, t),
    im: lerp(from.im, to.im, t),
    scale: lerpLog(from.scale, to.scale, t),
  };
}

/**
 * Map-style fly: zoom out to a scale that contains both views, then zoom in.
 * Nearby jumps skip the outbound leg.
 */
export function createFlyTo(from: View, to: View): (t: number) => View {
  const dist = Math.hypot(to.re - from.re, to.im - from.im);
  const nearby = dist < Math.max(from.scale, to.scale) * 1.8;

  if (nearby) {
    return (t) => lerpView(from, to, easeInOutCubic(clamp(t, 0, 1)));
  }

  const midScale = Math.max(from.scale, to.scale, dist * 2.1, 0.9);
  const mid: View = {
    re: (from.re + to.re) / 2,
    im: (from.im + to.im) / 2,
    scale: midScale,
  };

  return (t) => {
    const u = clamp(t, 0, 1);
    if (u < 0.42) {
      return lerpView(from, mid, easeInOutCubic(u / 0.42));
    }
    return lerpView(mid, to, easeInOutCubic((u - 0.42) / 0.58));
  };
}

export function flyDuration(from: View, to: View) {
  const dist = Math.hypot(to.re - from.re, to.im - from.im);
  const nearby = dist < Math.max(from.scale, to.scale) * 1.8;
  const zoomDelta = Math.abs(Math.log(to.scale / from.scale));
  if (nearby) return clamp(280 + zoomDelta * 90, 280, 700);
  return clamp(720 + zoomDelta * 40, 720, 1100);
}

export function formatCoord(n: number) {
  const abs = Math.abs(n);
  if (abs === 0) return "0";
  if (abs >= 0.01 && abs < 100) return n.toFixed(6).replace(/\.?0+$/, "") || "0";
  return n.toExponential(4);
}

export function formatZoom(scale: number) {
  const z = DEFAULT_SCALE / scale;
  if (z < 10) return `${z.toFixed(2)}×`;
  if (z < 1000) return `${z.toFixed(0)}×`;
  return `${z.toExponential(2).replace("e+", "e")}×`;
}

export function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
