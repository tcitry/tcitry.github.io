import {Component, useEffect, useRef, useState, type MouseEvent, type ReactNode} from 'react';
import {Button} from '@heroui/react';
import {useMutation, usePaginatedQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import type {Id} from '../../../convex/_generated/dataModel';
import {AuthLoading} from '../auth/SignInPanel';
import styles from './NotificationsPanel.module.css';

interface Props {onOpenConsultation: (threadId: Id<'consultationThreads'>) => void}
class NotificationsBoundary extends Component<{children: ReactNode; onRetry: () => void}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  render() {return this.state.failed ? <div>
    <p className={styles.empty} role="alert">消息暂时无法加载。</p>
    <Button size="sm" variant="outline" onPress={this.props.onRetry}>重新加载</Button>
  </div> : this.props.children;}
}

function Notifications({onOpenConsultation}: Props) {
  const {results, status, loadMore} = usePaginatedQuery(api.notifications.list, {}, {initialNumItems: 20});
  const markRead = useMutation(api.notifications.markRead);
  const [opening, setOpening] = useState<Id<'notifications'> | null>(null);
  const openingRef = useRef(false);
  const active = useRef(true);
  const [error, setError] = useState('');
  useEffect(() => {active.current = true; return () => {active.current = false;};}, []);

  async function open(id: Id<'notifications'>, readAt: number | null, navigate: () => void) {
    if (openingRef.current) return;
    openingRef.current = true; setOpening(id); setError('');
    try {
      if (readAt === null) await markRead({id});
      if (active.current) navigate();
    } catch {if (active.current) setError('消息暂时无法打开，请稍后重试。');}
    finally {openingRef.current = false; if (active.current) setOpening(null);}
  }
  if (status === 'LoadingFirstPage') return <AuthLoading label="正在读取消息…" />;
  return <>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {results.length === 0 ? <p className={styles.empty}>还没有消息。评论回复和博主的咨询回复会出现在这里。</p> : <ul className={styles.list}>
      {results.map(item => {
        const target = item.target;
        const label = item.kind === 'comment_reply' ? '你的评论收到回复' : '博主回复了你的咨询';
        const content = <>
          <span className={styles.notificationTitle}>{item.readAt === null && <span className={styles.unread} aria-label="未读" />}{label}</span>
          <span className={styles.detail}>{target?.kind === 'consultation' ? target.title : target?.kind === 'comment' ? decodeURIComponent(target.pathname) : '这条回复已不可查看。'}</span>
          <time className={styles.date} dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat('zh-CN', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}).format(item.createdAt)}</time>
        </>;
        return <li className={styles.item} key={item._id} data-unread={item.readAt === null || undefined}>
          {target?.kind === 'comment' ? <a className={styles.link} href={`${target.pathname}#comment-${target.commentId}`} aria-busy={opening === item._id} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            void open(item._id, item.readAt, () => window.location.assign(`${target.pathname}#comment-${target.commentId}`));
          }}>{content}</a> : target?.kind === 'consultation' ? <Button className={styles.link} variant="ghost" isDisabled={Boolean(opening)} aria-busy={opening === item._id} onPress={() => {void open(item._id, item.readAt, () => onOpenConsultation(target.threadId));}}>{content}</Button>
            : <div className={`${styles.link} ${styles.unavailable}`}>{content}</div>}
        </li>;
      })}
    </ul>}
    {status !== 'Exhausted' && <Button size="sm" variant="outline" className={styles.loadMore} isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更多消息</Button>}
  </>;
}

export default function NotificationsPanel(props: Props) {
  const [generation, setGeneration] = useState(0);
  return <section className={styles.panel} aria-label="消息通知" data-notifications data-sentry-mask data-pagefind-ignore>
    <NotificationsBoundary key={generation} onRetry={() => setGeneration(value => value + 1)}><Notifications {...props} /></NotificationsBoundary>
  </section>;
}
