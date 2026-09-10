import {Component, useState, type ReactNode} from 'react';
import {Button} from '@heroui/react';
import {usePaginatedQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import {AuthLoading} from '../auth/SignInPanel';
import styles from './ReaderPanel.module.css';
import useArticleTitles from './useArticleTitles';
import './reader.css';

class LikesBoundary extends Component<{children: ReactNode; onRetry: () => void}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  render() {return this.state.failed ? <div>
    <p className={styles.message} role="alert">喜欢的文章暂时无法加载。</p>
    <Button size="sm" variant="outline" onPress={this.props.onRetry}>重新加载</Button>
  </div> : this.props.children;}
}

function LikedArticles() {
  const {results, status, loadMore} = usePaginatedQuery(api.comments.listLikedArticles, {}, {initialNumItems: 20});
  const articleTitle = useArticleTitles(results);
  if (status === 'LoadingFirstPage') return <AuthLoading label="正在读取喜欢的文章…" />;
  return <>
    {results.length === 0 ? <p className={styles.empty}>还没有喜欢的文章。点击文章评论区的心形图标即可添加。</p> : <ul className={styles.list}>
      {results.map(item => <li className={styles.item} key={item.pathname}>
        <a className={styles.itemLink} href={item.pathname}>
          <span className={styles.itemTitle}>{articleTitle(item)}</span>
          <time className={styles.itemDate} dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'}).format(item.createdAt)}</time>
        </a>
      </li>)}
    </ul>}
    {status !== 'Exhausted' && <Button className={styles.loadMore} size="sm" variant="outline" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更多</Button>}
  </>;
}

export default function LikedArticlesPanel() {
  const [generation, setGeneration] = useState(0);
  return <section className={styles.panel} aria-label="喜欢的文章" data-liked-articles data-sentry-mask data-pagefind-ignore>
    <LikesBoundary key={generation} onRetry={() => setGeneration(value => value + 1)}><LikedArticles /></LikesBoundary>
  </section>;
}
