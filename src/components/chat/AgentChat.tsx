import {useEffect, useMemo, useRef, useState} from 'react';
import {useMutation, usePaginatedQuery, useQuery} from 'convex/react';
import {useUIMessages, type UIMessage} from '@convex-dev/agent/react';
import {ConvexError} from 'convex/values';
import type {Components} from 'react-markdown';
import {Button} from '@heroui/react';
import {ChatConversation} from '@heroui-pro/react/chat-conversation';
import {ChatLoader} from '@heroui-pro/react/chat-loader';
import {ChatMessage} from '@heroui-pro/react/chat-message';
import {ChatMessageActions} from '@heroui-pro/react/chat-message-actions';
import {ChatSource, ChatSources} from '@heroui-pro/react/chat-source';
import {Markdown} from '@heroui-pro/react/markdown';
import {PromptInput} from '@heroui-pro/react/prompt-input';
import {api} from '../../../convex/_generated/api';
import type {Id} from '../../../convex/_generated/dataModel';
import surface from '../demos/DemoSurface.module.css';
import '../../styles/chat.css';
import './agent-chat.css';

type Source = {id: string; title: string; url: string; sourceKind: 'author' | 'ai-assisted'};
type RenderMessage = Pick<UIMessage, 'id' | 'key' | 'role' | 'parts' | 'text' | 'order' | 'stepOrder' | 'status' | '_creationTime'>;

function errorMessage(error: unknown) {
  if (error instanceof ConvexError && error.data && typeof error.data === 'object' && 'message' in error.data && typeof error.data.message === 'string') return error.data.message;
  return '暂时无法完成操作，请稍后重试。';
}

function Answer({message, sources}: {message: RenderMessage; sources: Source[]}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const text = message.parts.filter(part => part.type === 'text').map(part => part.text).join('');
  const components = useMemo<Components>(() => ({
    a: ({href, children}) => sources.some(source => source.url === href)
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    img: ({alt}) => alt ? <span>{alt}</span> : null,
    h1: ({children}) => <h3>{children}</h3>, h2: ({children}) => <h3>{children}</h3>,
    table: ({children}) => <div className="blog-chat__table"><table>{children}</table></div>,
  }), [sources]);
  return <ChatMessage.Assistant className="blog-chat__assistant" data-message-state={message.status}>
    <ChatMessage.Body className="blog-chat__body">
      {text && <ChatMessage.Content><Markdown id={message.key} components={components} className="blog-chat__answer">{text}</Markdown></ChatMessage.Content>}
      {sources.length > 0 && <ChatSources defaultExpanded className="blog-chat__sources">
        <ChatSources.Trigger>参考文章 · {sources.length}</ChatSources.Trigger>
        <ChatSources.Content><ChatSources.List className="blog-chat__source-list">
          {sources.map(source => <ChatSource key={source.id} href={source.url} title={source.title} enablePreview={false} className="blog-chat__source">
            <ChatSource.Trigger target="_blank" rel="noopener noreferrer" className="blog-chat__source-link">
              <span className="blog-chat__source-number">[{source.id}]</span><ChatSource.Title>{source.title}</ChatSource.Title>
              {source.sourceKind === 'ai-assisted' && <span className="blog-chat__source-kind">AI 整理</span>}
            </ChatSource.Trigger>
          </ChatSource>)}
        </ChatSources.List></ChatSources.Content>
      </ChatSources>}
      {text && message.status !== 'streaming' && message.status !== 'pending' && <ChatMessageActions className="blog-chat__actions">
        <ChatMessageActions.Copy isCopied={copied} aria-label={copied ? '回答和出处已复制' : '复制回答和出处'} tooltip={false} onPress={async () => {
          try { await navigator.clipboard.writeText(`${text}\n\n${sources.map(source => `[${source.id}] ${source.title} ${source.url}`).join('\n')}`); setCopied(true); setCopyFailed(false); }
          catch { setCopyFailed(true); }
        }} />
      </ChatMessageActions>}
      {copyFailed && <p role="status" className="blog-chat__notice">浏览器未允许复制，可以选中回答文字复制。</p>}
    </ChatMessage.Body>
  </ChatMessage.Assistant>;
}

function Turn({conversationId, order, messages}: {conversationId: Id<'assistantConversations'>; order: number; messages: RenderMessage[]}) {
  // Each loaded turn has one bounded indexed subscription; pagination never loses
  // older citations by limiting a separate run list to the latest N generations.
  const run = useQuery(api.assistant.getRunStates, {conversationId, orders: [order]})?.[0];
  const pending = run?.status === 'queued' || run?.status === 'running';
  const hasAnswer = messages.some(message => message.role === 'assistant' && message.parts.some(part => part.type === 'text' && part.text));
  return <div className="agent-chat__turn">
    {messages.map(message => message.role === 'user'
      ? <ChatMessage.User key={message.key} className="blog-chat__user"><ChatMessage.Bubble><ChatMessage.Content>{message.text}</ChatMessage.Content></ChatMessage.Bubble></ChatMessage.User>
      : message.role === 'assistant' ? <Answer key={message.key} message={message} sources={run?.sources ?? []} /> : null)}
    {pending && !hasAnswer && <ChatLoader.Dots label={run?.sources.length ? '正在整理回答' : '正在检索文章'} />}
    {run?.status === 'canceled' && <p className="blog-chat__notice">已停止生成。{hasAnswer ? '当前回答可能不完整。' : ''}</p>}
    {run?.status === 'failed' && <p role="alert" className="blog-chat__error">{run.error || '回答未完成，请重新提问。'}</p>}
  </div>;
}

function Transcript({conversationId, threadId}: {conversationId: Id<'assistantConversations'>; threadId: string}) {
  const messages = useUIMessages(api.assistant.listThreadMessages, {threadId}, {initialNumItems: 20, stream: true});
  const turns = useMemo(() => {
    const groups = new Map<number, RenderMessage[]>();
    for (const message of messages.results) groups.set(message.order, [...(groups.get(message.order) ?? []), message]);
    return [...groups].sort(([a], [b]) => a - b).map(([order, items]) => ({order, messages: items.sort((a, b) => a.stepOrder - b.stepOrder)}));
  }, [messages.results]);
  return <ChatConversation className="blog-chat__conversation" role="region" aria-label="AI 对话记录" tabIndex={0}>
    <ChatConversation.Content className="blog-chat__messages">
      {messages.status === 'LoadingFirstPage' ? <ChatLoader.Dots label="正在加载对话" /> : <>
        {messages.status === 'CanLoadMore' && <Button variant="ghost" size="sm" onPress={() => messages.loadMore(20)}>查看更早的消息</Button>}
        {messages.status === 'LoadingMore' && <ChatLoader.Dots label="正在加载更早的消息" />}
        {!turns.length && <div className="agent-chat__welcome"><p>从一个问题开始</p><span>查找公开文章、梳理要点，或围绕一个主题继续追问。</span></div>}
        {turns.map(turn => <Turn key={turn.order} conversationId={conversationId} {...turn} />)}
      </>}
    </ChatConversation.Content>
    <ChatConversation.ScrollButton aria-label="回到最新回答" tooltip={false} />
  </ChatConversation>;
}

export default function AgentChat({onReady}: {onReady?: () => void}) {
  const conversations = usePaginatedQuery(api.assistant.listConversations, {}, {initialNumItems: 20});
  const create = useMutation(api.assistant.createConversation);
  const send = useMutation(api.assistant.sendMessage);
  const cancel = useMutation(api.assistant.cancel);
  const [selected, setSelected] = useState<Id<'assistantConversations'> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const locked = useRef(false);
  const retry = useRef<{conversationId: Id<'assistantConversations'>; prompt: string; requestId: string} | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const currentId = selected ?? conversations.results[0]?.id ?? null;
  const conversation = useQuery(api.assistant.getConversation, currentId ? {conversationId: currentId} : 'skip');
  const busy = Boolean(conversation?.activeRun);
  useEffect(() => { onReady?.(); }, [onReady]);
  useEffect(() => {
    if (!selected && conversations.results[0]) setSelected(conversations.results[0].id);
  }, [selected, conversations.results]);

  async function newConversation() {
    if (locked.current) return;
    locked.current = true; setSubmitting(true); setError('');
    try { const id = await create(); setSelected(id); setHistoryOpen(false); setValue(''); retry.current = null; }
    catch (failure) { setError(errorMessage(failure)); }
    finally { locked.current = false; setSubmitting(false); }
  }

  async function submit() {
    const prompt = value.trim();
    if (locked.current || busy || !prompt || prompt.length > 2000) return;
    locked.current = true; setSubmitting(true); setError('');
    try {
      const conversationId = currentId ?? await create();
      setSelected(conversationId);
      const request = retry.current?.conversationId === conversationId && retry.current.prompt === prompt
        ? retry.current : {conversationId, prompt, requestId: crypto.randomUUID()};
      retry.current = request;
      await send(request);
      retry.current = null; setValue(''); setAnnouncement('问题已保存。关闭面板后，回答仍会继续生成。');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { locked.current = false; setSubmitting(false); }
  }

  async function stop() {
    if (!currentId) return;
    try { await cancel({conversationId: currentId}); setAnnouncement('已停止生成。'); }
    catch (failure) { setError(errorMessage(failure)); }
  }

  return <section className={`${surface.surface} blog-chat agent-chat not-prose`} aria-label="与 AI 博客助手对话" data-sentry-mask data-pagefind-ignore>
    <div className="blog-chat__header">
      <div className="blog-chat__identity" title={conversation?.title}>{conversation?.title ?? 'AI 博客助手'}</div>
      <div className="agent-chat__header-actions">
        <Button variant="ghost" size="sm" onPress={() => setHistoryOpen(open => !open)} aria-expanded={historyOpen} aria-controls="agent-chat-history">历史</Button>
        <Button variant="ghost" size="sm" onPress={newConversation} isDisabled={submitting}>新对话</Button>
      </div>
    </div>
    {historyOpen && <nav id="agent-chat-history" className="agent-chat__history" aria-label="已保存的 AI 对话">
      {conversations.status === 'LoadingFirstPage' && <ChatLoader.Dots label="正在加载对话列表" />}
      {!conversations.results.length && conversations.status !== 'LoadingFirstPage' && <p>还没有保存的对话。</p>}
      {conversations.results.map(item => <Button key={item.id} variant="ghost" className="agent-chat__history-item" aria-current={item.id === currentId ? 'true' : undefined} onPress={() => {
        setSelected(item.id); setHistoryOpen(false); setValue(''); setError(''); retry.current = null;
      }}>{item.title}</Button>)}
      {conversations.status === 'CanLoadMore' && <Button variant="ghost" size="sm" onPress={() => conversations.loadMore(20)}>更多对话</Button>}
    </nav>}
    {conversation && currentId ? <Transcript key={conversation.threadId} conversationId={currentId} threadId={conversation.threadId} />
      : <div className="agent-chat__welcome">{currentId || conversations.status === 'LoadingFirstPage' ? '正在加载对话…' : '向 AI 博客助手提问，回答将附上参考文章。'}</div>}
    <div className="blog-chat__composer">
      <div className="blog-chat__sr-only" role="status" aria-live="polite">{announcement}</div>
      {error && <p role="alert" className="blog-chat__error">{error}</p>}
      <PromptInput value={value} onValueChange={setValue} status={busy ? 'streaming' : submitting ? 'submitted' : 'ready'} onSubmit={submit} onStop={stop} isDisabled={submitting} maxHeight={160}>
        <PromptInput.Shell><PromptInput.Content><PromptInput.TextArea ref={input} aria-label="向 AI 博客助手提问" placeholder="向 AI 博客助手提问…" maxLength={2000} /></PromptInput.Content>
          <PromptInput.Toolbar><PromptInput.ToolbarStart><span className="blog-chat__input-help">{value.length ? `${value.length} / 2000` : busy ? '正在生成，可离开后回来查看' : '检索公开博客文章'}</span></PromptInput.ToolbarStart>
            <PromptInput.ToolbarEnd><PromptInput.Send aria-label={busy ? '停止生成' : '发送问题'} isDisabled={submitting || (!busy && !value.trim())} /></PromptInput.ToolbarEnd>
          </PromptInput.Toolbar>
        </PromptInput.Shell>
        <PromptInput.Footer>AI 回答请以原文为准 · 对话已登录保存 · 真人咨询请使用「咨询」</PromptInput.Footer>
      </PromptInput>
    </div>
  </section>;
}
