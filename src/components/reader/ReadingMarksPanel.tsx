import {useState} from 'react';
import {Button} from '@heroui/react';
import {usePaginatedQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import ReadingStatusMenu, {readingLabels, type ReadingStatus} from './ReadingStatusMenu';
import {readingEntries, readingListMeta} from './reading-list';
import styles from './ReaderPanel.module.css';

export default function ReadingMarksPanel() {
  const [filter, setFilter] = useState<ReadingStatus | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const marks = usePaginatedQuery(api.reader.listReadingMarks,
    filter ? {status: filter} : {}, {initialNumItems: 20});
  const loading = marks.status === 'LoadingFirstPage';
  const entries = readingEntries(marks.results);
  const canLoadMore = marks.status === 'CanLoadMore';

  return <section ref={setContainer} className={styles.panel} aria-label="阅读列表" aria-busy={loading} data-reading-marks data-sentry-mask data-pagefind-ignore>
    <ReadingStatusMenu value={filter} onChange={setFilter} emptyLabel="全部状态" label="筛选阅读标记" container={container} />
    {loading
      ? <p className={styles.message} role="status">正在读取阅读记录…</p>
      : <>
        {entries.length === 0
          ? <p className={styles.empty}>{filter ? '该档次还没有阅读标记。' : '还没有阅读记录。在文章文末选择理解档次后会出现在这里。'}</p>
          : <ul className={styles.list}>
            {entries.map(entry => <li key={entry.pathname} className={styles.item}>
              <a href={entry.pathname} className={styles.itemLink}>
                <span className={styles.itemTitle}>{entry.title}</span>
                <span className={styles.itemMeta}>{readingListMeta({
                  statusLabel: readingLabels[entry.status],
                  updatedAt: entry.updatedAt,
                })}</span>
              </a>
            </li>)}
          </ul>}
        {canLoadMore && <Button className={styles.loadMore} size="sm" variant="outline" isPending={marks.status === 'LoadingMore'} onPress={() => marks.loadMore(20)}>加载更多</Button>}
      </>}
  </section>;
}
