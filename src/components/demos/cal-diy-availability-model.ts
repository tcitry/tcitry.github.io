/** Teaching port of date-ranges.ts:423–452 at this exact upstream revision.
 * A fixed UTC day is represented in minutes; no Slot, Buffer or timezone logic.
 */
export const CAL_DIY_REVISION = '54343aa685ae8f33159d2f485ec4a57bad5c574a';
export const DAY_START = 8 * 60;
export const DAY_END = 18 * 60;
export interface MinuteRange { start: number; end: number }
export interface BusyRange extends MinuteRange { id: 'A' | 'B' }
export interface AvailabilityInput { first: MinuteRange; secondStart: number; secondDuration: number; step: number }
export const SOURCE_RANGE: MinuteRange = {start: 9 * 60, end: 17 * 60};
export const DEFAULT_INPUT: AvailabilityInput = {first: {start: 600, end: 660}, secondStart: 840, secondDuration: 90, step: 2};
export const PRESETS = [
  {id: 'separate', label: '两段分离', input: DEFAULT_INPUT},
  {id: 'overlap', label: 'Busy 重叠', input: {...DEFAULT_INPUT, secondStart: 630, secondDuration: 90}},
  {id: 'touch', label: '端点接触', input: {...DEFAULT_INPUT, secondStart: 660, secondDuration: 60}},
  {id: 'cover', label: '整段覆盖', input: {...DEFAULT_INPUT, first: {start: 480, end: 1080}}},
] as const;

/** Same comparisons and cursor movement as upstream subtract(). Inputs are not mutated. */
export function subtractRanges<T extends MinuteRange>(sourceRanges: T[], excludedRanges: MinuteRange[]): T[] {
  const result: T[] = [];
  const excluded = [...excludedRanges].sort((a, b) => a.start - b.start);
  for (const source of sourceRanges) {
    let currentStart = source.start;
    for (const busy of excluded) {
      if (busy.start >= source.end) break;
      if (busy.end <= currentStart) continue;
      if (busy.start > currentStart) result.push({...source, start: currentStart, end: busy.start});
      currentStart = Math.max(currentStart, busy.end);
    }
    if (source.end > currentStart) result.push({...source, start: currentStart, end: source.end});
  }
  return result;
}
const bounded = (value: number, fallback: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(value) ? value : fallback));
export function availabilityAt(input: AvailabilityInput = DEFAULT_INPUT) {
  const start = bounded(input.secondStart, DEFAULT_INPUT.secondStart, DAY_START, DAY_END);
  const duration = bounded(input.secondDuration, DEFAULT_INPUT.secondDuration, 0, DAY_END - start);
  const firstStart = bounded(input.first.start, 600, DAY_START, DAY_END);
  const firstEnd = bounded(input.first.end, 660, firstStart, DAY_END);
  const step = Math.round(bounded(input.step, 2, 0, 2));
  const busy: BusyRange[] = [{id: 'A', start: firstStart, end: firstEnd}, {id: 'B', start, end: start + duration}];
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  // A zero-duration marker occupies no time. The upstream caller must supply
  // valid non-empty DateRanges; the UI accepts zero and omits that exclusion.
  const applied = sorted.slice(0, step).filter(range => range.end > range.start);
  const remaining = subtractRanges([SOURCE_RANGE], applied);
  const minutes = remaining.reduce((sum, range) => sum + range.end - range.start, 0);
  return {source: SOURCE_RANGE, busy, sorted, applied, remaining, minutes, removedMinutes: 480 - minutes, step};
}
export function formatTime(minute: number) {
  const rounded = Math.round(minute);
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`;
}
export const formatRange = (range: MinuteRange) => `${formatTime(range.start)}–${formatTime(range.end)}`;
