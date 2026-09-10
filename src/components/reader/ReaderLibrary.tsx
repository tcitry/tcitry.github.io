import {Button} from '@heroui/react';
import {usePaginatedQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import surface from '../demos/DemoSurface.module.css';
import styles from './ReaderPanel.module.css';
import './reader.css';

export default function ReaderLibrary() {
  const {results, status, loadMore} = usePaginatedQuery(api.reader.listLibrary, {}, {initialNumItems: 20});

  return <section className={`${surface.surface} ${styles.panel}`} aria-label="收藏列表" aria-busy={status === 'LoadingFirstPage'} data-reader-library data-book-island>
    {status === 'LoadingFirstPage'
      ? <div className={styles.skeleton} aria-hidden="true"><span /><span /><span /></div>
      : <>
        {results.length === 0 ? <div className={styles.empty}>还没有收藏。点击文章文末的书签即可添加。</div> : <ul className={styles.list}>
          {results.map((item) => <li key={item.pathname} className={styles.item}>
            <a href={item.pathname} aria-label={item.title} className={styles.itemLink}>
              <span className={styles.itemTitle}>{item.title}</span>
              <time className={styles.itemDate} dateTime={new Date(item.updatedAt).toISOString()}>{new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'}).format(item.updatedAt)}</time>
            </a>
          </li>)}
        </ul>}
        {status !== 'Exhausted' && <Button className={styles.loadMore} size="sm" variant="outline" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更多</Button>}
      </>}
  </section>;
}
