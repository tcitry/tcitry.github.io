import {useState} from 'react';
import {Button} from '@heroui/react';
import {usePaginatedQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import ReadingStatusMenu, {readingLabels, type ReadingStatus} from './ReadingStatusMenu';
import styles from './ReaderPanel.module.css';

export default function ReadingMarksPanel() {
  const [filter, setFilter] = useState<ReadingStatus | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const {results, status, loadMore} = usePaginatedQuery(api.reader.listReadingMarks,
    filter ? {status: filter} : {}, {initialNumItems: 20});
  return <section ref={setContainer} className={styles.panel} aria-label="阅读标记列表" aria-busy={status === 'LoadingFirstPage'} data-reading-marks data-sentry-mask data-pagefind-ignore>
    <ReadingStatusMenu value={filter} onChange={setFilter} emptyLabel="全部档次" label="筛选阅读标记" container={container} />
    {status === 'LoadingFirstPage'
      ? <p className={styles.message} role="status">正在读取阅读标记…</p>
      : <>
        {results.length === 0 ? <p className={styles.empty}>{filter ? '该档次还没有阅读标记。' : '还没有阅读标记。在文章文末选择理解档次即可添加。'}</p> : <ul className={styles.list}>
          {results.map(item => <li key={item.pathname} className={styles.item}>
            <a href={item.pathname} className={styles.itemLink}>
              <span className={styles.itemTitle}>{item.title}</span>
              <span className={styles.itemPath}>{item.pathname}</span>
              <span>{readingLabels[item.status]}</span>
              <time className={styles.itemDate} dateTime={new Date(item.updatedAt).toISOString()}>{new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'}).format(item.updatedAt)}</time>
            </a>
          </li>)}
        </ul>}
        {status !== 'Exhausted' && <Button className={styles.loadMore} size="sm" variant="outline" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更多</Button>}
      </>}
  </section>;
}
