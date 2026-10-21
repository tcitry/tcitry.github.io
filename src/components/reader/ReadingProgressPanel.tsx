import {Button} from '@heroui/react';
import {usePaginatedQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import styles from './ReaderPanel.module.css';

export default function ReadingProgressPanel() {
  const {results, status, loadMore} = usePaginatedQuery(api.reader.listReadingProgress, {}, {initialNumItems: 20});
  return <section className={styles.panel} aria-label="进度" aria-busy={status === 'LoadingFirstPage'} data-reading-progress-list data-sentry-mask data-pagefind-ignore>
    <p className={styles.sectionLabel}>进度</p>
    {status === 'LoadingFirstPage'
      ? <p className={styles.message} role="status">正在读取进度…</p>
      : <>
        {results.length === 0 ? <p className={styles.empty}>还没有进度。打开文章并滚动后会自动记录。</p> : <ul className={styles.list}>
          {results.map(item => <li key={item.pathname} className={styles.item}>
            <a href={item.pathname} className={styles.itemLink}>
              <span className={styles.itemTitle}>{item.title}</span>
              <span className={styles.itemPath}>{item.pathname}</span>
              <span className={styles.itemProgress}>进度 {Math.round(item.progress * 100)}%</span>
              <time className={styles.itemDate} dateTime={new Date(item.updatedAt).toISOString()}>{new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'}).format(item.updatedAt)}</time>
            </a>
          </li>)}
        </ul>}
        {status !== 'Exhausted' && <Button className={styles.loadMore} size="sm" variant="outline" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更多</Button>}
      </>}
  </section>;
}
