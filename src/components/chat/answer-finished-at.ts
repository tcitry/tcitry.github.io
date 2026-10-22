/** How long the copy control stays on the success icon before returning to copy. */
export const COPY_SUCCESS_MS = 1800;

const SHANGHAI = 'Asia/Shanghai';

type ShanghaiParts = {year: string; month: string; day: string; hour: string; minute: string};

function shanghaiParts(timestamp: number): ShanghaiParts | null {
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => formatted.find(part => part.type === type)?.value;
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  const hour = pick('hour');
  const minute = pick('minute');
  if (!year || !month || !day || hour === undefined || minute === undefined) return null;
  return {year, month, day, hour, minute};
}

/** Compact Asia/Shanghai label: today `HH:mm`, this year `M/D HH:mm`, otherwise `YYYY/M/D HH:mm`. */
export function formatAnswerFinishedAt(timestamp: number, now = Date.now()): string | null {
  const target = shanghaiParts(timestamp);
  const current = shanghaiParts(now);
  if (!target || !current) return null;
  const time = `${target.hour}:${target.minute}`;
  if (target.year === current.year && target.month === current.month && target.day === current.day) return time;
  const date = `${Number(target.month)}/${Number(target.day)}`;
  if (target.year === current.year) return `${date} ${time}`;
  return `${target.year}/${date} ${time}`;
}

export type CopyTimer = {current: number | null};

export function armCopySuccess(
  setCopied: (copied: boolean) => void,
  timer: CopyTimer,
  schedule: (callback: () => void, delay: number) => number,
  cancel: (id: number) => void,
) {
  setCopied(true);
  if (timer.current !== null) cancel(timer.current);
  timer.current = schedule(() => {
    timer.current = null;
    setCopied(false);
  }, COPY_SUCCESS_MS);
}

export function releaseCopySuccess(
  setCopied: (copied: boolean) => void,
  timer: CopyTimer,
  cancel: (id: number) => void,
) {
  if (timer.current !== null) cancel(timer.current);
  timer.current = null;
  setCopied(false);
}
