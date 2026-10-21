export type ReadingListStatus = 'later' | 'skimmed' | 'read' | 'studied';
export type ReadingPageStatus = 'LoadingFirstPage' | 'LoadingMore' | 'CanLoadMore' | 'Exhausted';

export interface ReadingMarkRow {
  pathname: string;
  title: string;
  status: ReadingListStatus;
  updatedAt: number;
}

export interface ReadingProgressRow {
  pathname: string;
  title: string;
  progress: number;
  updatedAt: number;
}

export interface ReadingListEntry {
  pathname: string;
  title: string;
  status: ReadingListStatus | null;
  progress: number | null;
  updatedAt: number;
}

function preferTitle(mark: {title: string; updatedAt: number}, saved: {title: string; updatedAt: number} | undefined) {
  if (!saved || saved.updatedAt <= mark.updatedAt) return mark.title;
  return saved.title;
}

// Client-side view of two orthogonal lists. Rows stay independent in Convex.
export function mergeReadingEntries(
  marks: readonly ReadingMarkRow[],
  progress: readonly ReadingProgressRow[],
  status: ReadingListStatus | null,
): ReadingListEntry[] {
  const progressByPath = new Map<string, ReadingProgressRow>();
  for (const row of progress) {
    const existing = progressByPath.get(row.pathname);
    if (!existing || row.updatedAt >= existing.updatedAt) progressByPath.set(row.pathname, row);
  }

  const entries = new Map<string, ReadingListEntry>();
  for (const mark of marks) {
    if (status && mark.status !== status) continue;
    const saved = progressByPath.get(mark.pathname);
    const next: ReadingListEntry = {
      pathname: mark.pathname,
      title: preferTitle(mark, saved),
      status: mark.status,
      progress: saved ? saved.progress : null,
      updatedAt: saved ? Math.max(mark.updatedAt, saved.updatedAt) : mark.updatedAt,
    };
    const current = entries.get(mark.pathname);
    if (!current || next.updatedAt >= current.updatedAt) entries.set(mark.pathname, next);
  }

  if (!status) {
    for (const saved of progressByPath.values()) {
      if (entries.has(saved.pathname)) continue;
      entries.set(saved.pathname, {
        pathname: saved.pathname,
        title: saved.title,
        status: null,
        progress: saved.progress,
        updatedAt: saved.updatedAt,
      });
    }
  }

  return [...entries.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.pathname.localeCompare(b.pathname));
}

const readingDate = new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'});

export function formatReadingDate(updatedAt: number) {
  return readingDate.format(updatedAt);
}

export function readingListMeta(entry: {statusLabel: string | null; progress: number | null; updatedAt: number}) {
  const parts: string[] = [];
  if (entry.statusLabel) parts.push(entry.statusLabel);
  if (entry.progress !== null && Number.isFinite(entry.progress)) parts.push(`进度 ${Math.round(entry.progress * 100)}%`);
  parts.push(formatReadingDate(entry.updatedAt));
  return parts.join(' · ');
}

export function shouldLoadReadingProgress(
  filter: ReadingListStatus | null,
  marksStatus: ReadingPageStatus,
  progressStatus: ReadingPageStatus,
  missingProgress: boolean,
) {
  if (progressStatus !== 'CanLoadMore') return false;
  if (!filter) return true;
  return marksStatus === 'CanLoadMore' || missingProgress;
}

export function canLoadReadingList(
  filter: ReadingListStatus | null,
  marksStatus: ReadingPageStatus,
  progressStatus: ReadingPageStatus,
  missingProgress: boolean,
) {
  return marksStatus === 'CanLoadMore' || shouldLoadReadingProgress(filter, marksStatus, progressStatus, missingProgress);
}
