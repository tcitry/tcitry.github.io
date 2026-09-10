import {useSyncExternalStore} from "react";
import type { CollideMode, MassKind, ScenarioId } from "./orbit-types";

export type OrbitApi = {
  loadScenario: (id: ScenarioId) => void;
  clear: () => void;
  deleteSelected: () => void;
  recenter: () => void;
};

const noopApi: OrbitApi = {
  loadScenario: () => {},
  clear: () => {},
  deleteSelected: () => {},
  recenter: () => {},
};

export type OrbitState = {
  massKind: MassKind;
  timeScale: number;
  paused: boolean;
  trails: boolean;
  collide: CollideMode;
  follow: boolean;
  intro: boolean;
  bodyCount: number;
  simTime: number;
  selectedId: number | null;
  selectedMass: number;
  selectedSpeed: number;
  scenario: ScenarioId;
  throwing: boolean;
  api: OrbitApi;
  setMassKind: (kind: MassKind) => void;
  setTimeScale: (v: number) => void;
  setPaused: (v: boolean) => void;
  togglePaused: () => void;
  setTrails: (v: boolean) => void;
  setCollide: (v: CollideMode) => void;
  setFollow: (v: boolean) => void;
  dismissIntro: () => void;
};

type Update = Partial<OrbitState> | ((state: OrbitState) => Partial<OrbitState>);
const listeners = new Set<() => void>();
function set(update: Update) {
  state = {...state, ...(typeof update === 'function' ? update(state) : update)};
  for (const listener of listeners) listener();
}
let state: OrbitState = {
  massKind: "planet",
  timeScale: 1,
  paused: false,
  trails: true,
  collide: "merge",
  follow: false,
  intro: true,
  bodyCount: 0,
  simTime: 0,
  selectedId: null,
  selectedMass: 0,
  selectedSpeed: 0,
  scenario: "garden",
  throwing: false,
  api: noopApi,
  setMassKind: (massKind) => set({ massKind }),
  setTimeScale: (timeScale) => set({ timeScale }),
  setPaused: (paused) => set({ paused }),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
  setTrails: (trails) => set({ trails }),
  setCollide: (collide) => set({ collide }),
  setFollow: (follow) => set({ follow }),
  dismissIntro: () => set({ intro: false }),
};
const initialState = state;
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {listeners.delete(listener);};
}
export const useOrbit = Object.assign(
  <T,>(selector: (state: OrbitState) => T) => useSyncExternalStore(subscribe, () => selector(state), () => selector(initialState)),
  {getState: () => state, setState: set},
);
