import { useSyncExternalStore } from "react";
import {
  clampIter,
  clampScale,
  DEFAULT_IM,
  DEFAULT_RE,
  DEFAULT_SCALE,
  iterForScale,
  type View,
} from "./mandelbrot-math";
import { DEFAULT_PALETTE_ID } from "./mandelbrot-palettes";

const STORAGE_KEY = "infinite-coast-v1";

export type Flight = {
  id: number;
  to: View;
  maxIter?: number;
};

export type ExplorerState = {
  re: number;
  im: number;
  scale: number;
  maxIter: number;
  autoIter: boolean;
  paletteId: string;
  helpOpen: boolean;
  flight: Flight | null;
  setView: (partial: Partial<Pick<ExplorerState, "re" | "im" | "scale" | "maxIter">>) => void;
  setPalette: (id: string) => void;
  setAutoIter: (on: boolean) => void;
  setMaxIter: (n: number) => void;
  setHelpOpen: (open: boolean) => void;
  beginFlight: (to: View, maxIter?: number) => void;
  clearFlight: () => void;
  reset: () => void;
};

function readStored(): Partial<ExplorerState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<ExplorerState>;
    if (!parsed || typeof parsed !== "object") return {};
    return {
      re: typeof parsed.re === "number" && Number.isFinite(parsed.re) ? parsed.re : undefined,
      im: typeof parsed.im === "number" && Number.isFinite(parsed.im) ? parsed.im : undefined,
      scale: typeof parsed.scale === "number" && Number.isFinite(parsed.scale) ? clampScale(parsed.scale) : undefined,
      maxIter: typeof parsed.maxIter === "number" && Number.isFinite(parsed.maxIter) ? clampIter(parsed.maxIter) : undefined,
      autoIter: typeof parsed.autoIter === "boolean" ? parsed.autoIter : undefined,
      paletteId: typeof parsed.paletteId === "string" ? parsed.paletteId : undefined,
    };
  } catch {
    return {};
  }
}

let flightSeq = 0;

const listeners = new Set<(state: ExplorerState) => void>();
const get = () => state;
const set = (partial: Partial<ExplorerState>) => {
  state = { ...state, ...partial };
  for (const listener of listeners) listener(state);
};
let state: ExplorerState = {
  re: DEFAULT_RE,
  im: DEFAULT_IM,
  scale: DEFAULT_SCALE,
  maxIter: iterForScale(DEFAULT_SCALE),
  autoIter: true,
  paletteId: DEFAULT_PALETTE_ID,
  helpOpen: false,
  flight: null,
  setView: (partial) => {
    const cur = get();
    const scale = partial.scale !== undefined ? clampScale(partial.scale) : cur.scale;
    const autoIter = cur.autoIter;
    const maxIter =
      partial.maxIter !== undefined
        ? clampIter(partial.maxIter)
        : autoIter
          ? iterForScale(scale)
          : cur.maxIter;
    set({
      re: partial.re ?? cur.re,
      im: partial.im ?? cur.im,
      scale,
      maxIter,
    });
  },
  setPalette: (id) => set({ paletteId: id }),
  setAutoIter: (on) => {
    const { scale, maxIter } = get();
    set({ autoIter: on, maxIter: on ? iterForScale(scale) : maxIter });
  },
  setMaxIter: (n) => set({ autoIter: false, maxIter: clampIter(n) }),
  setHelpOpen: (open) => set({ helpOpen: open }),
  beginFlight: (to, maxIter) => {
    flightSeq += 1;
    set({
      flight: {
        id: flightSeq,
        to: { re: to.re, im: to.im, scale: clampScale(to.scale) },
        maxIter,
      },
    });
  },
  clearFlight: () => set({ flight: null }),
  reset: () => {
    const to = { re: DEFAULT_RE, im: DEFAULT_IM, scale: DEFAULT_SCALE };
    flightSeq += 1;
    set({
      autoIter: true,
      flight: { id: flightSeq, to, maxIter: iterForScale(DEFAULT_SCALE) },
    });
  },
};
const initialState = state;
function subscribe(listener: (state: ExplorerState) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const useExplorer = Object.assign(
  <T,>(selector: (state: ExplorerState) => T): T => useSyncExternalStore(
    subscribe, () => selector(state), () => selector(initialState)),
  {getState: get, setState: set, subscribe},
);

export function hydrateExplorer() {
  const stored = readStored();
  if (
    stored.re === undefined &&
    stored.im === undefined &&
    stored.scale === undefined &&
    stored.paletteId === undefined
  ) {
    return;
  }
  const scale = stored.scale ?? DEFAULT_SCALE;
  const autoIter = stored.autoIter ?? true;
  useExplorer.setState({
    re: stored.re ?? DEFAULT_RE,
    im: stored.im ?? DEFAULT_IM,
    scale,
    autoIter,
    paletteId: stored.paletteId ?? DEFAULT_PALETTE_ID,
    maxIter: autoIter ? iterForScale(scale) : (stored.maxIter ?? iterForScale(scale)),
  });
}

export function persistExplorer() {
  if (typeof window === "undefined") return;
  const s = useExplorer.getState();
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        re: s.re,
        im: s.im,
        scale: s.scale,
        maxIter: s.maxIter,
        autoIter: s.autoIter,
        paletteId: s.paletteId,
      }),
    );
  } catch {
    /* quota */
  }
}
