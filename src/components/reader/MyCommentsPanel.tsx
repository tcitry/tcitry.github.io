import {Component, useState, type ReactNode} from 'react';
import {Button} from '@heroui/react';
import {usePaginatedQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import {AuthLoading} from '../auth/SignInPanel';
import {ImageIcon} from '../comments/CommentIcons';
import styles from './ReaderPanel.module.css';
import personal from './MyPanel.module.css';
import useArticleTitles from './useArticleTitles';
import './reader.css';

class MyCommentsBoundary extends Component<{children: ReactNode; onRetry: () => void}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  render() {return this.state.failed ? <div>
    <p className={styles.message} role="alert">你的评论暂时无法加载。</p>
    <Button size="sm" variant="outline" onPress={this.props.onRetry}>重新加载</Button>
  </div> : this.props.children;}
}

function MyComments() {
  const {results, status, loadMore} = usePaginatedQuery(api.comments.listMine, {}, {initialNumItems: 20});
  const items = results.map(item => ({...item, title: 'articleTitle' in item && typeof item.articleTitle === 'string' ? item.articleTitle : undefined}));
  const articleTitle = useArticleTitles(items);
  if (status === 'LoadingFirstPage') return <AuthLoading label="正在读取你的评论…" />;
  return <>
    {results.length === 0 ? <p className={styles.empty}>你还没有发表评论。参与文章讨论后，可以在这里找到自己的评论和回复。</p> : <ul className={styles.list}>
      {items.map(item => <li className={styles.item} key={item._id}>
        <a className={styles.itemLink} href={`${item.pathname}#comment-${item._id}`}>
          <span className={styles.itemTitle}>{articleTitle(item)}</span>
          {item.body && <span className={personal.commentBody}>{item.body}</span>}
          <span className={personal.commentMeta}>
            <span>{item.parentId ? '回复' : '评论'}</span>
            <time dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'}).format(item.createdAt)}</time>
            {item.imageCount > 0 && <span className={personal.imageCount}><ImageIcon />{item.imageCount} 张图片</span>}
          </span>
        </a>
      </li>)}
    </ul>}
    {status !== 'Exhausted' && <Button className={styles.loadMore} size="sm" variant="outline" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更多评论</Button>}
  </>;
}

export default function MyCommentsPanel() {
  const [generation, setGeneration] = useState(0);
  return <section className={styles.panel} aria-label="我的评论" data-my-comments data-sentry-mask data-pagefind-ignore>
    <MyCommentsBoundary key={generation} onRetry={() => setGeneration(value => value + 1)}><MyComments /></MyCommentsBoundary>
  </section>;
}
