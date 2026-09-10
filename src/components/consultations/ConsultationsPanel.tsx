import { Component, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Input, TextArea, Tooltip } from '@heroui/react';
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { memberError, useMembership } from '../membership/useMembership';
import CommentImages from '../comments/CommentImages';
import {ImageUploadError} from '../comments/comment-image-upload';
import {ConsultationImagePicker, useConsultationImages} from './ConsultationImages';
import styles from './ConsultationsPanel.module.css';

const statusLabels = { waiting: '等待回复', replied: '博主已回复', closed: '已结束' } as const;
const time = (value: number) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
type SelectedThread = {id: Id<'consultationThreads'>; title?: string};
interface ConversationProps {threadId: Id<'consultationThreads'>; title?: string; inbox?: boolean; onBack: () => void}

function ConversationHeader({title, status, inbox, onBack, disabled = false}: {
  title: string; status: string; inbox: boolean; onBack: () => void; disabled?: boolean;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  return <header className={styles.threadHeader} ref={setPortalContainer}>
    <Tooltip delay={400}>
      <Button size="sm" variant="ghost" isIconOnly className={styles.backButton} aria-label={inbox ? '返回管理列表' : '返回咨询列表'} onPress={onBack} isDisabled={disabled}>
        <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m8.5 4.5-5.5 5.5 5.5 5.5M3.5 10h13" /></svg>
      </Button>
      <Tooltip.Content placement="bottom start" offset={6} UNSTABLE_portalContainer={portalContainer ?? undefined}>{inbox ? '返回管理列表' : '返回咨询列表'}</Tooltip.Content>
    </Tooltip>
    <div className={styles.threadHeading}>
      <h3>{title}</h3><span className={styles.badge}>{status}</span>
    </div>
  </header>;
}

class ConversationBoundary extends Component<ConversationProps & {children: ReactNode; onRetry: () => void}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() {return {failed: true};}
  render() {
    return this.state.failed ? <div className={styles.conversation} data-consultation-state="error">
      <ConversationHeader title={this.props.title ?? '咨询详情'} status="读取失败" inbox={Boolean(this.props.inbox)} onBack={this.props.onBack} />
      <p className={styles.error} role="alert">咨询暂时无法读取，请稍后重试。</p>
      <div><Button size="sm" variant="outline" onPress={this.props.onRetry}>重新读取咨询</Button></div>
    </div> : this.props.children;
  }
}

function ThreadMessages({ threadId, inbox }: { threadId: Id<'consultationThreads'>; inbox: boolean }) {
  const { results, status, loadMore } = usePaginatedQuery(api.consultations.listMessages, { threadId }, { initialNumItems: 30 });
  return <div className={styles.messages} aria-label="私人咨询消息">
    {status === 'LoadingFirstPage' && <p role="status" className={styles.note}>正在读取对话…</p>}
    {status === 'CanLoadMore' || status === 'LoadingMore' ? <Button size="sm" variant="ghost" isPending={status === 'LoadingMore'} onPress={() => loadMore(30)}>加载更早消息</Button> : null}
    {[...results].reverse().map((message) => <article key={message._id} className={`${styles.message} ${message.sender === 'author' ? styles.author : ''}`}>
      <div className={styles.messageMeta}>
        <strong>{message.sender === 'author' ? inbox ? '你' : '博主' : inbox ? '咨询会员' : '你'}</strong>
        <time dateTime={new Date(message.createdAt).toISOString()}>{time(message.createdAt)}</time>
      </div>
      {message.content && <p>{message.content}</p>}
      <CommentImages images={message.images} label="咨询图片" />
    </article>)}
  </div>;
}

function ConversationBody({ threadId, title, inbox = false, onBack }: ConversationProps) {
  const thread = useQuery(api.consultations.getThread, { threadId });
  const canSend = thread?.status === 'waiting' || thread?.status === 'replied';
  const send = useAction(inbox ? api.consultations.reply : api.consultations.send);
  const close = useMutation(api.consultations.close);
  const [content, setContent] = useState('');
  const [pending, setPending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const images = useConsultationImages();
  const retry = useRef<{ content: string; imageIds: Id<'commentImages'>[]; requestId: string } | null>(null);
  const guard = useRef(false);
  const inputId = useId();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = content.trim();
    if (!canSend || (!text && !images.items.length) || guard.current) return;
    guard.current = true;
    setPending(true); setError('');
    try {
      const imageIds = await images.upload();
      const payload = retry.current?.content === text && JSON.stringify(retry.current.imageIds) === JSON.stringify(imageIds)
        ? retry.current : { content: text, imageIds, requestId: crypto.randomUUID() };
      retry.current = payload;
      await send({ threadId, ...payload });
      images.commit(); setContent(''); retry.current = null;
    } catch (error) { if (!(error instanceof ImageUploadError)) setError(memberError(error)); }
    finally { guard.current = false; setPending(false); }
  }
  async function closeThread() {
    if (!canSend || guard.current) return;
    guard.current = true; setClosing(true); setError('');
    try { await close({ threadId }); }
    catch (error) { setError(memberError(error)); }
    finally { guard.current = false; setClosing(false); }
  }
  return <div className={styles.conversation} data-consultation-state={!thread ? 'loading' : canSend ? 'open' : 'closed'}>
    <ConversationHeader title={thread?.title ?? title ?? '咨询详情'} status={thread ? statusLabels[thread.status] : '读取中'} inbox={inbox} onBack={onBack} disabled={pending || closing} />
    <ThreadMessages threadId={threadId} inbox={inbox} />
    {error && <p className={styles.error} role="alert">{error}</p>}
    {!thread ? <p role="status" className={`${styles.note} ${styles.threadState}`}>正在读取咨询状态…</p>
      : !canSend ? <p className={`${styles.note} ${styles.threadState}`}>这条咨询已结束，对话记录仍然保留。</p> : <form className={styles.form} onSubmit={(event) => { void submit(event); }}>
      <label htmlFor={inputId}>{inbox ? '回复会员' : '继续咨询'}</label>
      <TextArea id={inputId} value={content} maxLength={10_000} rows={4} disabled={pending || closing || !thread} placeholder={inbox ? '写下你的回复…' : '补充问题或背景…'} onChange={(event) => setContent(event.currentTarget.value)} />
      <ConsultationImagePicker draft={images} disabled={pending || closing || !thread} />
      <div className={styles.actions}>
        <Button type="submit" size="sm" isPending={pending} isDisabled={(!content.trim() && !images.items.length) || !thread || closing}>发送{inbox ? '回复' : '消息'}</Button>
        <Button size="sm" variant="ghost" isPending={closing} isDisabled={!thread || pending} onPress={() => { void closeThread(); }}>结束咨询</Button>
        <span className={styles.note}>{content.length} / 10000</span>
      </div>
    </form>}
  </div>;
}

function Conversation(props: ConversationProps) {
  const [attempt, setAttempt] = useState(0);
  return <ConversationBoundary key={attempt} {...props} onRetry={() => setAttempt(value => value + 1)}>
    <ConversationBody {...props} />
  </ConversationBoundary>;
}

function NewConsultation({ onCreated, onCancel }: { onCreated: (id: Id<'consultationThreads'>) => void; onCancel: () => void }) {
  const create = useAction(api.consultations.start);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const images = useConsultationImages();
  const retry = useRef<{ title: string; content: string; imageIds: Id<'commentImages'>[]; requestId: string } | null>(null);
  const guard = useRef(false);
  const titleId = useId(), contentId = useId();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const topic = title.trim(), text = content.trim();
    if (!topic || (!text && !images.items.length) || guard.current) return;
    guard.current = true; setPending(true); setError('');
    try {
      const imageIds = await images.upload();
      const payload = retry.current?.title === topic && retry.current.content === text && JSON.stringify(retry.current.imageIds) === JSON.stringify(imageIds)
        ? retry.current : { title: topic, content: text, imageIds, requestId: crypto.randomUUID() };
      retry.current = payload;
      const id = await create(payload);
      images.commit(); onCreated(id);
    }
    catch (error) { if (!(error instanceof ImageUploadError)) setError(memberError(error)); }
    finally { guard.current = false; setPending(false); }
  }
  return <form className={styles.form} onSubmit={(event) => { void submit(event); }}>
    <label htmlFor={titleId}>咨询主题</label>
    <Input id={titleId} value={title} maxLength={160} disabled={pending} placeholder="你希望讨论什么？" onChange={(event) => setTitle(event.currentTarget.value)} />
    <label htmlFor={contentId}>问题与背景</label>
    <TextArea id={contentId} value={content} maxLength={10_000} rows={7} disabled={pending} placeholder="介绍背景、已经尝试的方法，以及想解决的问题。" onChange={(event) => setContent(event.currentTarget.value)} />
    <ConsultationImagePicker draft={images} disabled={pending} />
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.actions}>
      <Button size="sm" type="submit" isPending={pending} isDisabled={!title.trim() || (!content.trim() && !images.items.length)}>发起咨询</Button>
      <Button size="sm" variant="ghost" isDisabled={pending} onPress={onCancel}>返回</Button>
    </div>
  </form>;
}

function ThreadList({inbox = false, onSelect}: {inbox?: boolean; onSelect: (thread: SelectedThread) => void}) {
  const { results, status, loadMore } = usePaginatedQuery(inbox ? api.consultations.listInbox : api.consultations.listThreads, {}, { initialNumItems: 20 });
  return <>
    <div className={styles.threadList}>
      {status === 'LoadingFirstPage' ? <p className={styles.note} role="status">正在读取咨询…</p> : results.length === 0 ? <p className={styles.empty}>{inbox ? '还没有收到咨询。' : '还没有私人咨询。可以从一个具体问题开始。'}</p> : results.map((thread) => <button type="button" key={thread._id} className={styles.threadButton} onClick={() => onSelect({id: thread._id, title: thread.title})}>
        <span className={styles.threadSummary}>
          <strong className={styles.threadTitle}>{thread.title}</strong>
          <span className={styles.threadMeta}>
            <span className={styles.threadStatus} data-status={thread.status}>{inbox ? {waiting: '待回复', replied: '已回复', closed: '已结束'}[thread.status] : statusLabels[thread.status]}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={new Date(thread.updatedAt).toISOString()}>{time(thread.updatedAt)}</time>
          </span>
        </span>
        <svg className={styles.threadChevron} viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7.5 5 5 5-5 5" /></svg>
      </button>)}
    </div>
    {status === 'CanLoadMore' || status === 'LoadingMore' ? <Button size="sm" variant="ghost" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更多咨询</Button> : null}
  </>;
}

export function ConsultationInbox() {
  const [selected, setSelected] = useState<SelectedThread | null>(null);
  return <section className={styles.panel} aria-label="咨询收件箱" data-consultations-panel data-consultations-inbox data-sentry-mask data-pagefind-ignore>
    {selected ? <Conversation key={selected.id} threadId={selected.id} title={selected.title} inbox onBack={() => setSelected(null)} /> : <>
      <header className={styles.header}>
        <h2>管理</h2>
        <p>查看读者发来的咨询，并在这里回复。</p>
      </header>
      <ThreadList inbox onSelect={setSelected} />
    </>}
  </section>;
}

export default function ConsultationsPanel({initialThreadId}: {initialThreadId?: Id<'consultationThreads'>}) {
  const role = useQuery(api.membership.getConsultationRole);
  const { membership, pending, error, refresh } = useMembership();
  const [selected, setSelected] = useState<SelectedThread | null>(initialThreadId ? {id: initialThreadId} : null);
  const [composing, setComposing] = useState(false);
  if (selected) return <section className={styles.panel} aria-label="私人咨询" data-consultations-panel data-sentry-mask data-pagefind-ignore>
    <Conversation key={selected.id} threadId={selected.id} title={selected.title} onBack={() => setSelected(null)} />
  </section>;
  return <section className={styles.panel} aria-label="私人咨询" data-consultations-panel data-sentry-mask data-pagefind-ignore>
    <header className={styles.header}>
      <h2>与博主交流</h2>
      <p>这里是你与博主的私人对话，可附上图片。消息由本人阅读和回复。</p>
    </header>
    {composing ? <NewConsultation onCreated={(id) => { setComposing(false); setSelected({id}); }} onCancel={() => setComposing(false)} /> : <>
      <div className={styles.membership}>
        <p>{role === undefined ? '正在加载咨询…' : !role.ready ? '私人咨询尚未开放。' : pending ? '正在核验会员状态…' : membership?.isPro ? 'Pro 会员可发起咨询，等待博主回复。' : 'Pro 会员可以发起和继续咨询，已有记录始终可查看。'}</p>
        <div className={styles.actions}>
          <Button size="sm" isDisabled={!role?.ready || !membership?.isPro || pending} onPress={() => setComposing(true)}>发起咨询</Button>
          {error && <Button size="sm" variant="ghost" onPress={() => { void refresh(); }}>重试</Button>}
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
      <ThreadList onSelect={setSelected} />
    </>}
  </section>;
}
