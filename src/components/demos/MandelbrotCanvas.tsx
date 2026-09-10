import { useEffect, useRef, useState } from "react";
import {
  clampScale,
  createFlyTo,
  DEFAULT_IM,
  DEFAULT_RE,
  DEFAULT_SCALE,
  easeOutCubic,
  flyDuration,
  iterForScale,
  prefersReducedMotion,
} from "./mandelbrot-math";
import { getPalette, nextPaletteId } from "./mandelbrot-palettes";
import {
  MandelbrotRenderer,
  panByPixels,
  screenToWorld,
} from "./mandelbrot-renderer";
import { persistExplorer, useExplorer } from "./mandelbrot-store";

const DRAG_THRESHOLD = 6;
const SETTLE_MS = 140;
const CLICK_ZOOM = 2.2;
const WHEEL_ZOOM_IN = 1.12;
const INTERACT_ITER_CAP = 160;
const INTERACT_DPR = 0.75;
const FULL_DPR_CAP = 2;

type Anim = {
  start: number;
  duration: number;
  sample: (t: number) => { re: number; im: number; scale: number };
  endIter?: number;
};

export function MandelbrotCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MandelbrotRenderer | null>(null);
  const animRef = useRef<Anim | null>(null);
  const interactingRef = useRef(false);
  const settleTimer = useRef(0);
  const persistTimer = useRef(0);
  const sizeRef = useRef({ w: 1, h: 1 });
  const viewRef = useRef({
    re: useExplorer.getState().re,
    im: useExplorer.getState().im,
    scale: useExplorer.getState().scale,
    maxIter: useExplorer.getState().maxIter,
    paletteId: useExplorer.getState().paletteId,
    autoIter: useExplorer.getState().autoIter,
  });
  const [error, setError] = useState<string | null>(null);
  const [hintVisible, setHintVisible] = useState(true);
  const hintRef = useRef(true);

  const drawRef = useRef<() => void>(() => {});
  const zoomAtRef = useRef<(x: number, y: number, factor: number, animate: boolean) => void>(
    () => {},
  );
  const zoomCenterRef = useRef<(factor: number) => void>(() => {});
  const markRef = useRef<() => void>(() => {});

  drawRef.current = () => {
    const renderer = rendererRef.current;
    const wrap = wrapRef.current;
    if (!renderer || !wrap) return;

    const v = viewRef.current;
    const interacting = interactingRef.current || animRef.current !== null;
    const dpr = interacting
      ? INTERACT_DPR
      : Math.min(window.devicePixelRatio || 1, FULL_DPR_CAP);
    const { w, h } = sizeRef.current;
    renderer.resize(w, h, dpr);

    const palette = getPalette(v.paletteId);
    const iter = interacting ? Math.min(v.maxIter, INTERACT_ITER_CAP) : v.maxIter;
    renderer.render({
      re: v.re,
      im: v.im,
      scale: v.scale,
      maxIter: iter,
      palette,
    });
  };

  function schedulePersist() {
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => persistExplorer(), 400);
  }

  markRef.current = () => {
    interactingRef.current = true;
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      interactingRef.current = false;
      drawRef.current();
      schedulePersist();
    }, SETTLE_MS);
  };

  zoomAtRef.current = (cssX, cssY, factor, animate) => {
    const { w, h } = sizeRef.current;
    const v = viewRef.current;
    const world = screenToWorld(cssX, cssY, w, h, v.re, v.im, v.scale);
    const nextScale = clampScale(v.scale / factor);
    const k = nextScale / v.scale;
    const to = {
      re: world.re + (v.re - world.re) * k,
      im: world.im + (v.im - world.im) * k,
      scale: nextScale,
    };
    if (!animate || prefersReducedMotion()) {
      const maxIter = v.autoIter ? iterForScale(to.scale) : v.maxIter;
      markRef.current();
      useExplorer.getState().setView({ ...to, maxIter });
      return;
    }
    const from = { re: v.re, im: v.im, scale: v.scale };
    animRef.current = {
      start: performance.now(),
      duration: 280,
      sample: (t) => {
        const e = easeOutCubic(t);
        return {
          re: from.re + (to.re - from.re) * e,
          im: from.im + (to.im - from.im) * e,
          scale: Math.exp(
            Math.log(from.scale) + Math.log(to.scale / from.scale) * e,
          ),
        };
      },
    };
    interactingRef.current = true;
  };

  zoomCenterRef.current = (factor) => {
    const { w, h } = sizeRef.current;
    zoomAtRef.current(w / 2, h / 2, factor, true);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    let renderer: MandelbrotRenderer;
    try {
      renderer = new MandelbrotRenderer(canvas);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法初始化渲染器");
      return;
    }
    rendererRef.current = renderer;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const cr = entry.contentRect;
      sizeRef.current = { w: Math.max(1, cr.width), h: Math.max(1, cr.height) };
      drawRef.current();
    });
    ro.observe(wrap);

    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const anim = animRef.current;
      if (!anim) return;
      const t = Math.min(1, (now - anim.start) / anim.duration);
      const sample = anim.sample(t);
      const autoIter = viewRef.current.autoIter;
      const maxIter = autoIter
        ? iterForScale(sample.scale)
        : (anim.endIter ?? viewRef.current.maxIter);
      viewRef.current = { ...viewRef.current, ...sample, maxIter };
      useExplorer.getState().setView({
        re: sample.re,
        im: sample.im,
        scale: sample.scale,
        maxIter,
      });
      if (t >= 1) {
        animRef.current = null;
        interactingRef.current = false;
        schedulePersist();
      }
      drawRef.current();
    };
    raf = requestAnimationFrame(tick);

    const unsub = useExplorer.subscribe((s) => {
      viewRef.current = {
        re: s.re,
        im: s.im,
        scale: s.scale,
        maxIter: s.maxIter,
        paletteId: s.paletteId,
        autoIter: s.autoIter,
      };
      if (hintRef.current) {
        const moved =
          Math.abs(s.re - DEFAULT_RE) > 1e-9 ||
          Math.abs(s.im - DEFAULT_IM) > 1e-9 ||
          Math.abs(s.scale - DEFAULT_SCALE) > 1e-9;
        if (moved) {
          hintRef.current = false;
          setHintVisible(false);
        }
      }
      if (!animRef.current) drawRef.current();
    });

    const onLost = (ev: Event) => {
      ev.preventDefault();
      setError("图形上下文已丢失，请刷新页面。");
    };
    canvas.addEventListener("webglcontextlost", onLost);

    drawRef.current();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub();
      canvas.removeEventListener("webglcontextlost", onLost);
      renderer.dispose();
      rendererRef.current = null;
      window.clearTimeout(settleTimer.current);
      window.clearTimeout(persistTimer.current);
    };
  }, []);

  const flightId = useExplorer((s) => s.flight?.id ?? 0);
  useEffect(() => {
    const flight = useExplorer.getState().flight;
    if (!flight) return;
    const from = {
      re: viewRef.current.re,
      im: viewRef.current.im,
      scale: viewRef.current.scale,
    };
    if (prefersReducedMotion()) {
      const iter = viewRef.current.autoIter
        ? iterForScale(flight.to.scale)
        : (flight.maxIter ?? viewRef.current.maxIter);
      useExplorer.getState().setView({ ...flight.to, maxIter: iter });
      useExplorer.getState().clearFlight();
      schedulePersist();
      return;
    }
    animRef.current = {
      start: performance.now(),
      duration: flyDuration(from, flight.to),
      sample: createFlyTo(from, flight.to),
      endIter: flight.maxIter,
    };
    interactingRef.current = true;
    useExplorer.getState().clearFlight();
  }, [flightId]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const drag = {
      pointerId: -1,
      downX: 0,
      downY: 0,
      lastX: 0,
      lastY: 0,
      moved: false,
      shift: false,
    };

    const dismissHint = () => {
      if (!hintRef.current) return;
      hintRef.current = false;
      setHintVisible(false);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dismissHint();
      animRef.current = null;
      drag.pointerId = e.pointerId;
      drag.downX = e.clientX;
      drag.downY = e.clientY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      drag.moved = false;
      drag.shift = e.shiftKey;
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic / lost pointer */
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      const total = Math.hypot(e.clientX - drag.downX, e.clientY - drag.downY);
      if (total > DRAG_THRESHOLD) drag.moved = true;
      if (!drag.moved || pinch) return;
      const { w, h } = sizeRef.current;
      const delta = panByPixels(dx, dy, w, h, viewRef.current.scale);
      markRef.current();
      useExplorer.getState().setView({
        re: viewRef.current.re + delta.dre,
        im: viewRef.current.im + delta.dim,
      });
      markRef.current();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (drag.pointerId !== e.pointerId) return;
      drag.pointerId = -1;
      if (e.type === "pointercancel" || pinch) return;
      if (drag.moved) {
        markRef.current();
        return;
      }
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      zoomAtRef.current(x, y, drag.shift ? 1 / CLICK_ZOOM : CLICK_ZOOM, true);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      dismissHint();
      animRef.current = null;
      const rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dir = e.deltaY > 0 ? 1 / WHEEL_ZOOM_IN : WHEEL_ZOOM_IN;
      zoomAtRef.current(x, y, dir, false);
    };

    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      dismissHint();
      const rect = wrap.getBoundingClientRect();
      zoomAtRef.current(
        e.clientX - rect.left,
        e.clientY - rect.top,
        1 / CLICK_ZOOM,
        true,
      );
    };

    let pinch: { dist: number; midX: number; midY: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        dismissHint();
        drag.pointerId = -1;
        animRef.current = null;
        const a = e.touches[0]!;
        const b = e.touches[1]!;
        pinch = {
          dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          midX: (a.clientX + b.clientX) / 2,
          midY: (a.clientY + b.clientY) / 2,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch) return;
      e.preventDefault();
      const a = e.touches[0]!;
      const b = e.touches[1]!;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const factor = dist / Math.max(pinch.dist, 1);
      const rect = wrap.getBoundingClientRect();
      zoomAtRef.current(midX - rect.left, midY - rect.top, factor, false);
      const { w, h } = sizeRef.current;
      const pan = panByPixels(
        midX - pinch.midX,
        midY - pinch.midY,
        w,
        h,
        viewRef.current.scale,
      );
      useExplorer.getState().setView({
        re: viewRef.current.re + pan.dre,
        im: viewRef.current.im + pan.dim,
      });
      pinch = { dist, midX, midY };
      markRef.current();
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };

    wrap.addEventListener("pointerdown", onPointerDown);
    wrap.addEventListener("pointermove", onPointerMove);
    wrap.addEventListener("pointerup", onPointerUp);
    wrap.addEventListener("pointercancel", onPointerUp);
    wrap.addEventListener("wheel", onWheel, { passive: false });
    wrap.addEventListener("contextmenu", onContext);
    wrap.addEventListener("touchstart", onTouchStart, { passive: true });
    wrap.addEventListener("touchmove", onTouchMove, { passive: false });
    wrap.addEventListener("touchend", onTouchEnd);

    return () => {
      wrap.removeEventListener("pointerdown", onPointerDown);
      wrap.removeEventListener("pointermove", onPointerMove);
      wrap.removeEventListener("pointerup", onPointerUp);
      wrap.removeEventListener("pointercancel", onPointerUp);
      wrap.removeEventListener("wheel", onWheel);
      wrap.removeEventListener("contextmenu", onContext);
      wrap.removeEventListener("touchstart", onTouchStart);
      wrap.removeEventListener("touchmove", onTouchMove);
      wrap.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.ctrlKey || e.metaKey || e.altKey || tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON" || tag === "SELECT" || (e.target as HTMLElement)?.isContentEditable) return;
      const s = useExplorer.getState();
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomCenterRef.current(CLICK_ZOOM);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomCenterRef.current(1 / CLICK_ZOOM);
      } else if (e.key === "0") {
        e.preventDefault();
        s.reset();
      } else if (e.key === "?" || e.key === "h" || e.key === "H") {
        e.preventDefault();
        s.setHelpOpen(!s.helpOpen);
      } else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        s.setPalette(nextPaletteId(s.paletteId));
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = 0.12 * s.scale;
        const dre = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dim = e.key === "ArrowDown" ? -step : e.key === "ArrowUp" ? step : 0;
        s.setView({ re: s.re + dre, im: s.im + dim });
        markRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing">
      <canvas
        ref={canvasRef}
        className="block size-full bg-[#101415]"
        aria-label="曼德勃罗分形画布"
        tabIndex={0}
      />
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#101415] px-6 text-center">
          <p className="max-w-sm text-sm text-white/80">{error}</p>
        </div>
      ) : null}
      {hintVisible && !error ? (
        <p className="pointer-events-none absolute left-1/2 top-24 z-10 w-max max-w-sm -translate-x-1/2 rounded-full bg-[#101415]/55 px-3 py-1 text-center text-xs tracking-wide text-white/80 backdrop-blur-sm md:top-auto md:bottom-36">
          点击放大 · 拖动平移 · 滚轮缩放
        </p>
      ) : null}
    </div>
  );
}
