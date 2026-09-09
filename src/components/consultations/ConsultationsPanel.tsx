import { useId, useRef, useState, type FormEvent } from 'react';
import { Button, Input, TextArea } from '@heroui/react';
import { useAction, useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { memberError, useMembership } from '../membership/useMembership';
import styles from './ConsultationsPanel.module.css';

const statusLabels = { waiting: '等待回复', replied: '博主已回复', closed: '已结束' } as const;
const time = (value: number) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);

function ThreadMessages({ threadId, isAdmin }: { threadId: Id<'consultationThreads'>; isAdmin: boolean }) {
  const { results, status, loadMore } = usePaginatedQuery(api.consultations.listMessages, { threadId }, { initialNumItems: 30 });
  return <div className={styles.messages} aria-label="私人咨询消息">
    {status === 'LoadingFirstPage' && <p role="status" className={styles.note}>正在读取对话…</p>}
    {status === 'CanLoadMore' || status === 'LoadingMore' ? <Button size="sm" variant="ghost" isPending={status === 'LoadingMore'} onPress={() => loadMore(30)}>加载更早消息</Button> : null}
    {[...results].reverse().map((message) => <article key={message._id} className={`${styles.message} ${message.sender === 'author' ? styles.author : ''}`}>
      <div className={styles.messageMeta}>
        <strong>{message.sender === 'author' ? '博主' : isAdmin ? '咨询会员' : '你'}</strong>
        <time dateTime={new Date(message.createdAt).toISOString()}>{time(message.createdAt)}</time>
      </div>
      <p>{message.content}</p>
    </article>)}
  </div>;
}

function Conversation({ threadId, isAdmin, onBack }: { threadId: Id<'consultationThreads'>; isAdmin: boolean; onBack: () => void }) {
  const thread = useQuery(api.consultations.getThread, { threadId });
  const send = useAction(api.consultations.send);
  const close = useMutation(api.consultations.close);
  const [content, setContent] = useState('');
  const [pending, setPending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState('');
  const retry = useRef<{ content: string; requestId: string } | null>(null);
  const guard = useRef(false);
  const inputId = useId();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = content.trim();
    if (!text || guard.current) return;
    guard.current = true;
    setPending(true); setError('');
    const payload = retry.current?.content === text ? retry.current : { content: text, requestId: crypto.randomUUID() };
    retry.current = payload;
    try {
      await send({ threadId, ...payload });
      setContent(''); retry.current = null;
    } catch (error) { setError(memberError(error)); }
    finally { guard.current = false; setPending(false); }
  }
  async function closeThread() {
    if (guard.current) return;
    guard.current = true; setClosing(true); setError('');
    try { await close({ threadId }); }
    catch (error) { setError(memberError(error)); }
    finally { guard.current = false; setClosing(false); }
  }
  return <div className={styles.conversation}>
    <header className={styles.threadHeader}>
      <Button size="sm" variant="ghost" onPress={onBack} isDisabled={pending || closing}>返回咨询列表</Button>
      {thread && <><h3>{thread.title}</h3><span className={styles.badge}>{statusLabels[thread.status]}</span></>}
    </header>
    <ThreadMessages threadId={threadId} isAdmin={isAdmin} />
    {error && <p className={styles.error} role="alert">{error}</p>}
    {thread?.status === 'closed' ? <p className={styles.note}>这条咨询已结束，对话记录仍然保留。</p> : <form className={styles.form} onSubmit={(event) => { void submit(event); }}>
      <label htmlFor={inputId}>{isAdmin ? '回复会员' : '继续咨询'}</label>
      <TextArea id={inputId} value={content} maxLength={10_000} rows={4} disabled={pending || closing || !thread} placeholder={isAdmin ? '写下你的回复…' : '补充问题或背景…'} onChange={(event) => setContent(event.currentTarget.value)} />
      <div className={styles.actions}>
        <Button type="submit" size="sm" isPending={pending} isDisabled={!content.trim() || !thread || closing}>发送{isAdmin ? '回复' : '消息'}</Button>
        <Button size="sm" variant="ghost" isPending={closing} isDisabled={!thread || pending} onPress={() => { void closeThread(); }}>结束咨询</Button>
        <span className={styles.note}>{content.length} / 10000</span>
      </div>
    </form>}
  </div>;
}

function NewConsultation({ onCreated, onCancel }: { onCreated: (id: Id<'consultationThreads'>) => void; onCancel: () => void }) {
  const create = useAction(api.consultations.start);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const retry = useRef<{ title: string; content: string; requestId: string } | null>(null);
  const guard = useRef(false);
  const titleId = useId(), contentId = useId();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const topic = title.trim(), text = content.trim();
    if (!topic || !text || guard.current) return;
    guard.current = true; setPending(true); setError('');
    const payload = retry.current?.title === topic && retry.current.content === text
      ? retry.current : { title: topic, content: text, requestId: crypto.randomUUID() };
    retry.current = payload;
    try { onCreated(await create(payload)); }
    catch (error) { setError(memberError(error)); }
    finally { guard.current = false; setPending(false); }
  }
  return <form className={styles.form} onSubmit={(event) => { void submit(event); }}>
    <label htmlFor={titleId}>咨询主题</label>
    <Input id={titleId} value={title} maxLength={160} disabled={pending} placeholder="你希望讨论什么？" onChange={(event) => setTitle(event.currentTarget.value)} />
    <label htmlFor={contentId}>问题与背景</label>
    <TextArea id={contentId} value={content} maxLength={10_000} rows={7} disabled={pending} placeholder="介绍背景、已经尝试的方法，以及想解决的问题。" onChange={(event) => setContent(event.currentTarget.value)} />
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.actions}>
      <Button size="sm" type="submit" isPending={pending} isDisabled={!title.trim() || !content.trim()}>发起咨询</Button>
      <Button size="sm" variant="ghost" isDisabled={pending} onPress={onCancel}>返回</Button>
    </div>
  </form>;
}

export default function ConsultationsPanel() {
  const role = useQuery(api.membership.getConsultationRole);
  const { results, status, loadMore } = usePaginatedQuery(api.consultations.listThreads, {}, { initialNumItems: 20 });
  const { membership, pending, error, refresh } = useMembership();
  const [selected, setSelected] = useState<Id<'consultationThreads'> | null>(null);
  const [composing, setComposing] = useState(false);
  if (selected) return <section className={styles.panel} aria-label="私人咨询" data-consultations-panel data-sentry-mask data-pagefind-ignore>
    <Conversation key={selected} threadId={selected} isAdmin={Boolean(role?.isAdmin)} onBack={() => setSelected(null)} />
  </section>;
  return <section className={styles.panel} aria-label={role?.isAdmin ? '咨询收件箱' : '私人咨询'} data-consultations-panel data-sentry-mask data-pagefind-ignore>
    <header className={styles.header}>
      <span className={styles.eyebrow}>{role?.isAdmin ? 'INBOX' : 'PRO CONSULTATION'}</span>
      <h2>{role?.isAdmin ? '咨询收件箱' : '与博主交流'}</h2>
      <p>这里是你与博主的私人文字对话。消息由本人阅读和回复，不会发送给 AI。</p>
    </header>
    {composing ? <NewConsultation onCreated={(id) => { setComposing(false); setSelected(id); }} onCancel={() => setComposing(false)} /> : <>
      {!role?.isAdmin && <div className={styles.membership}>
        <p>{!role?.ready ? '私人咨询尚未开放。' : membership?.isPro ? 'Pro 会员可发起咨询，等待博主回复。' : pending ? '正在核验会员状态…' : 'Pro 会员可以发起和继续咨询，已有记录始终可查看。'}</p>
        <div className={styles.actions}>
          <Button size="sm" isDisabled={!role?.ready || !membership?.isPro || pending} onPress={() => setComposing(true)}>发起咨询</Button>
          <Button size="sm" variant="ghost" isPending={pending} onPress={() => { void refresh(); }}>刷新会员状态</Button>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>}
      <div className={styles.threadList}>
        {status === 'LoadingFirstPage' ? <p className={styles.note} role="status">正在读取咨询…</p> : results.length === 0 ? <p className={styles.empty}>{role?.isAdmin ? '还没有收到咨询。' : '还没有私人咨询。可以从一个具体问题开始。'}</p> : results.map((thread) => <button type="button" key={thread._id} className={styles.threadButton} onClick={() => setSelected(thread._id)}>
          <strong>{thread.title}</strong>
          <span><span className={styles.badge}>{statusLabels[thread.status]}</span><time dateTime={new Date(thread.updatedAt).toISOString()}>{time(thread.updatedAt)}</time></span>
        </button>)}
      </div>
      {status === 'CanLoadMore' || status === 'LoadingMore' ? <Button size="sm" variant="ghost" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更多咨询</Button> : null}
    </>}
  </section>;
}
