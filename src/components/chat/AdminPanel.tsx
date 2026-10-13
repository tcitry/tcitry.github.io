import {useState} from 'react';
import {Button} from '@heroui/react';
import {Segment} from '@heroui-pro/react/segment';
import {useMutation, usePaginatedQuery} from 'convex/react';
import type {Id} from '../../../convex/_generated/dataModel';
import {api} from '../../../convex/_generated/api';
import {AuthLoading} from '../auth/SignInPanel';
import {ConsultationInbox} from '../consultations/ConsultationsPanel';
import {commentBodyExcerpt} from '../comments/comment-markdown';
import useArticleTitles from '../reader/useArticleTitles';
import styles from './AdminPanel.module.css';

type AdminView = 'consult' | 'comments' | 'likes';
const views = [
  {id: 'consult', label: '咨询'},
  {id: 'comments', label: '评论'},
  {id: 'likes', label: '喜欢'},
] as const;
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});

function CommentList() {
  const {results, status, loadMore} = usePaginatedQuery(api.comments.listAdmin, {}, {initialNumItems: 20});
  const remove = useMutation(api.comments.remove);
  const articleTitle = useArticleTitles(results);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function deleteComment(id: Id<'comments'>) {
    if (deletingId) return;
    setDeletingId(id);
    setError('');
    try {await remove({id});}
    catch {setError('删除评论失败，请稍后重试。');}
    finally {setDeletingId(null);}
  }

  return <section className={styles.view} aria-label="全站评论" data-admin-comments>
    <header className={styles.header}>
      <h2>全站评论</h2>
      <p>包含导入历史；已删除的评论会在原讨论中保留删除标记。</p>
    </header>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {status === 'LoadingFirstPage' ? <AuthLoading label="正在读取全站评论…" /> : results.length === 0 ? <p className={styles.empty}>暂无评论。</p> : <ul className={styles.list}>
      {results.map(item => <li className={styles.item} key={item.id}>
        <article className={styles.comment}>
          <div className={styles.meta}>
            <strong>{item.authorName}</strong>
            <span>{item.isReply ? '回复' : '评论'}</span>
            <time dateTime={new Date(item.createdAt).toISOString()}>{dateFormatter.format(item.createdAt)}</time>
          </div>
          <a className={styles.articleLink} href={`${item.pathname}#comment-${item.id}`}>{articleTitle(item)}</a>
          <p className={styles.summary}>{item.summary ? commentBodyExcerpt(item.summary) : item.imageCount ? `图片评论 · ${item.imageCount} 张图片` : '无文字内容'}</p>
          <div className={styles.actions}>
            <Button size="sm" variant="ghost" aria-label={`删除 ${item.authorName} 的评论`} isDisabled={deletingId !== null} isPending={deletingId === item.id} onPress={() => {void deleteComment(item.id);}}>删除</Button>
          </div>
        </article>
      </li>)}
    </ul>}
    {status === 'CanLoadMore' || status === 'LoadingMore' ? <Button className={styles.loadMore} size="sm" variant="outline" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更多评论</Button> : null}
  </section>;
}

function ArticleLikeList() {
  const {results, status, loadMore} = usePaginatedQuery(api.articleLikes.listAdmin, {}, {initialNumItems: 20});
  const articleTitle = useArticleTitles(results);

  return <section className={styles.view} aria-label="文章喜欢" data-admin-likes>
    <header className={styles.header}>
      <h2>文章喜欢</h2>
      <p>仅列出文章心形，读者身份不会展示。</p>
    </header>
    {status === 'LoadingFirstPage' ? <AuthLoading label="正在读取文章喜欢…" /> : results.length === 0 ? <p className={styles.empty}>暂无文章喜欢。</p> : <ul className={styles.list}>
      {results.map((item, index) => <li className={styles.item} key={`${item.pathname}:${item.createdAt}:${index}`}>
        <a className={styles.like} href={item.pathname}>
          <span className={styles.articleLink}>{articleTitle(item)}</span>
          <span className={styles.meta}>
            <span>读者</span>
            <time dateTime={new Date(item.createdAt).toISOString()}>{dateFormatter.format(item.createdAt)}</time>
          </span>
        </a>
      </li>)}
    </ul>}
    {status === 'CanLoadMore' || status === 'LoadingMore' ? <Button className={styles.loadMore} size="sm" variant="outline" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更多喜欢</Button> : null}
  </section>;
}

export default function AdminPanel({initialThreadId}: {initialThreadId?: Id<'consultationThreads'>}) {
  const [view, setView] = useState<AdminView>('consult');
  return <section className={styles.panel} aria-label="管理" data-admin-panel data-sentry-mask data-pagefind-ignore>
    <nav className={styles.navigation}>
      <Segment aria-label="管理内容分类" size="sm" selectedKey={view} onSelectionChange={key => setView(String(key) as AdminView)}>
        {views.map(item => <Segment.Item key={item.id} id={item.id}>{item.label}</Segment.Item>)}
      </Segment>
    </nav>
    <div className={styles.content}>
      {view === 'consult' && <ConsultationInbox key={initialThreadId ?? 'inbox'} initialThreadId={initialThreadId} />}
      {view === 'comments' && <CommentList />}
      {view === 'likes' && <ArticleLikeList />}
    </div>
  </section>;
}
