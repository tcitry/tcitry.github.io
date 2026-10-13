/** Teaching model for OpenFilm SPEC §3; this does not execute OpenFilm or encode video. */
export const FILM_DURATION = 3;
export const LAST_TIME = 2.99;
export const REFERENCE_TIME = 1.5;
export const FRAME_SEQUENCES = {
  ordered: [0, 0.5, 1, REFERENCE_TIME],
  shuffled: [2.5, 0.25, 2, REFERENCE_TIME],
  repeated: [REFERENCE_TIME, REFERENCE_TIME, REFERENCE_TIME, REFERENCE_TIME],
} as const;
export type FrameSequence = keyof typeof FRAME_SEQUENCES;

export function timeInRange(time: number): number {
  return Number.isFinite(time) ? Math.max(0, Math.min(LAST_TIME, time)) : 0;
}

export function frameAt(time: number) {
  const t = timeInRange(time);
  const progress = t / FILM_DURATION;
  const x = 40 + progress * 500;
  return {
    t, progress, x, y: 220, width: 40, height: 40,
    carriageTravel: progress * 206,
    previewTravel: progress * 125,
    // A readable signature of this example's geometry, not a screenshot hash.
    signature: `x=${x.toFixed(2)};y=220;w=40;h=40`,
  };
}

export interface FrameRequest {
  t: number;
  signature: string;
}
export interface FrameMachineState {
  frame: ReturnType<typeof frameAt>;
  history: FrameRequest[];
  requests: number;
  referenceChecks: number;
}

export function initialFrameState(): FrameMachineState {
  return {frame: frameAt(REFERENCE_TIME), history: [], requests: 0, referenceChecks: 0};
}

export function requestFrame(state: FrameMachineState, time: number): FrameMachineState {
  const frame = frameAt(time);
  return {
    frame,
    history: [...state.history, {t: frame.t, signature: frame.signature}].slice(-8),
    requests: state.requests + 1,
    referenceChecks: state.referenceChecks + (frame.t === REFERENCE_TIME ? 1 : 0),
  };
}

/** View easing only: displayed geometry and its readout always use the same displayed time. */
export function followTime(current: number, target: number, elapsed: number, still = false): number {
  const to = timeInRange(target);
  if (still || Math.abs(to - current) < 0.0001) return to;
  const dt = Number.isFinite(elapsed) ? Math.max(0, Math.min(1 / 30, elapsed)) : 0;
  const next = current + (to - current) * (1 - Math.exp(-dt / 0.18));
  return Math.abs(to - next) < 0.0001 ? to : next;
}
