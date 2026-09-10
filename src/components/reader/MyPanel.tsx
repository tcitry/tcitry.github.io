import {lazy, Suspense, useState} from 'react';
import {Segment} from '@heroui-pro/react/segment';
import {AuthLoading} from '../auth/SignInPanel';
import styles from './MyPanel.module.css';

const ReaderRoot = lazy(() => import('./ReaderRoot'));
const LikedArticlesPanel = lazy(() => import('./LikedArticlesPanel'));
const MyCommentsPanel = lazy(() => import('./MyCommentsPanel'));
type PersonalView = 'bookmarks' | 'likes' | 'comments';
const views = [{id: 'bookmarks', label: '收藏'}, {id: 'likes', label: '喜欢'}, {id: 'comments', label: '评论'}] as const;

export default function MyPanel() {
  const [view, setView] = useState<PersonalView>('bookmarks');
  return <section className={styles.panel} aria-label="我的内容" data-personal-panel data-sentry-mask data-pagefind-ignore>
    <nav className={styles.navigation}>
      <Segment aria-label="我的内容分类" size="sm" selectedKey={view} onSelectionChange={key => setView(String(key) as PersonalView)}>
        {views.map(item => <Segment.Item key={item.id} id={item.id}>{item.label}</Segment.Item>)}
      </Segment>
    </nav>
    <Suspense fallback={<AuthLoading label="正在加载…" />}>
      {view === 'bookmarks' && <ReaderRoot library />}
      {view === 'likes' && <LikedArticlesPanel />}
      {view === 'comments' && <MyCommentsPanel />}
    </Suspense>
  </section>;
}
