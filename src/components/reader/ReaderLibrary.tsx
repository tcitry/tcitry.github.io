import {useState} from 'react';
import {Button, Tabs} from '@heroui/react';
import {usePaginatedQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import surface from '../demos/DemoSurface.module.css';
import styles from './ReaderPanel.module.css';
import './reader.css';

type LibraryKind = 'bookmarks' | 'progress' | 'notes';
const filters: {id: LibraryKind; label: string; empty: string}[] = [
  {id: 'bookmarks', label: '收藏', empty: '还没有收藏。在文章页收藏感兴趣的内容，就能在这里找到。'},
  {id: 'progress', label: '阅读进度', empty: '还没有阅读记录。登录后阅读文章，进度会自动保存在这里。'},
  {id: 'notes', label: '私有笔记', empty: '还没有私有笔记。在文章页记下想法并保存，就能在这里回顾。'},
];

function LibraryItems({kind}: {kind: LibraryKind}) {
  const {results, status, loadMore} = usePaginatedQuery(api.reader.listLibrary, {kind}, {initialNumItems: 20});
  if (status === 'LoadingFirstPage') return <div className={styles.empty} role="status">读取个人记录…</div>;

  return <>
    {results.length === 0 ? <div className={styles.empty}>{filters.find((filter) => filter.id === kind)?.empty}</div> : <ul className={styles.list}>
      {results.map((item) => <li key={item.pathname} className={styles.item}>
        <a href={item.pathname} className={styles.itemLink}>{item.title}</a>
        {kind === 'notes' && item.note && <div className={styles.excerpt}>{item.note}</div>}
        <div className={styles.muted}>
          {kind === 'progress' && <span>{item.progress === 100 ? '已读完' : `已读 ${item.progress ?? 0}%`} · </span>}
          <time dateTime={new Date(item.updatedAt).toISOString()}>{new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'}).format(item.updatedAt)}</time>
        </div>
      </li>)}
    </ul>}
    {status !== 'Exhausted' && <Button className={styles.loadMore} size="sm" variant="outline" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更多</Button>}
  </>;
}

export default function ReaderLibrary() {
  const [kind, setKind] = useState<LibraryKind>('bookmarks');
  return <section className={`${surface.surface} ${styles.panel}`} aria-label="我的阅读记录" data-reader-library data-book-island>
    <Tabs selectedKey={kind} onSelectionChange={(key) => setKind(key as LibraryKind)} variant="secondary">
      <Tabs.ListContainer><Tabs.List aria-label="阅读记录分类">
        {filters.map((filter) => <Tabs.Tab key={filter.id} id={filter.id}>{filter.label}<Tabs.Indicator /></Tabs.Tab>)}
      </Tabs.List></Tabs.ListContainer>
      {filters.map((filter) => <Tabs.Panel key={filter.id} id={filter.id} className={styles.libraryPanel}>
        {kind === filter.id && <LibraryItems key={kind} kind={kind} />}
      </Tabs.Panel>)}
    </Tabs>
  </section>;
}
