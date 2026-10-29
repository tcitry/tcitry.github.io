export type ReadingListStatus = 'later' | 'skimmed' | 'read' | 'studied';

export interface ReadingMarkRow {
  pathname: string;
  title: string;
  status: ReadingListStatus;
  updatedAt: number;
}

export interface ReadingListEntry {
  pathname: string;
  title: string;
  status: ReadingListStatus;
  updatedAt: number;
}

// One row per article. A later write for the same pathname replaces the earlier one.
export function readingEntries(marks: readonly ReadingMarkRow[]): ReadingListEntry[] {
  const entries = new Map<string, ReadingListEntry>();
  for (const mark of marks) {
    const current = entries.get(mark.pathname);
    if (current && current.updatedAt > mark.updatedAt) continue;
    entries.set(mark.pathname, {
      pathname: mark.pathname,
      title: mark.title,
      status: mark.status,
      updatedAt: mark.updatedAt,
    });
  }
  return [...entries.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.pathname.localeCompare(b.pathname));
}

const readingDate = new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'});

export function formatReadingDate(updatedAt: number) {
  return readingDate.format(updatedAt);
}

export function readingListMeta(entry: {statusLabel: string | null; updatedAt: number}) {
  const parts: string[] = [];
  if (entry.statusLabel) parts.push(entry.statusLabel);
  parts.push(formatReadingDate(entry.updatedAt));
  return parts.join(' · ');
}
