import {useEffect, useMemo, useRef, useState} from 'react';
import {useMutation, usePaginatedQuery, useQuery} from 'convex/react';
import {useUIMessages, type UIMessage} from '@convex-dev/agent/react';
import {ConvexError} from 'convex/values';
import type {Components} from 'react-markdown';
import {Ellipsis, Plus} from '@gravity-ui/icons';
import {AlertDialog, Button, Dropdown, ListBox, Popover, Tooltip} from '@heroui/react';
import {ChatConversation} from '@heroui-pro/react/chat-conversation';
import {ChatLoader} from '@heroui-pro/react/chat-loader';
import {ChatMessage} from '@heroui-pro/react/chat-message';
import {ChatMessageActions} from '@heroui-pro/react/chat-message-actions';
import {ChatSource, ChatSources} from '@heroui-pro/react/chat-source';
import {Markdown} from '@heroui-pro/react/markdown';
import {PromptInput} from '@heroui-pro/react/prompt-input';
import {PromptSuggestion} from '@heroui-pro/react/prompt-suggestion';
import {api} from '../../../convex/_generated/api';
import type {Id} from '../../../convex/_generated/dataModel';
import {deriveFollowUpSuggestions} from '../../lib/chat-follow-ups';
import surface from '../demos/DemoSurface.module.css';
import '../../styles/chat.css';
import './agent-chat.css';

type Source = {id: string; title: string; url: string; sourceKind: 'author' | 'ai-assisted'};
type RenderMessage = Pick<UIMessage, 'id' | 'key' | 'role' | 'parts' | 'text' | 'order' | 'stepOrder' | 'status' | '_creationTime'>;
export type ChatPromptRequest = {id: string; text: string};
const suggestions = ['Convex 适合哪些应用场景？', '如何用 Git 管理代码提交？', 'Durable Objects 如何保存状态？'];

function Welcome({onSuggestion, isDisabled}: {onSuggestion: (prompt: string) => void; isDisabled: boolean}) {
  return <PromptSuggestion className="agent-chat__welcome">
    <PromptSuggestion.Header>
      <PromptSuggestion.Title>从一个问题开始</PromptSuggestion.Title>
      <PromptSuggestion.Description>查找公开文章、梳理要点。选一个问题，修改后发送。</PromptSuggestion.Description>
    </PromptSuggestion.Header>
    <PromptSuggestion.Items className="blog-chat__suggestions">
      {suggestions.map(prompt => <PromptSuggestion.Item key={prompt} isDisabled={isDisabled} onPress={() => onSuggestion(prompt)}>{prompt}</PromptSuggestion.Item>)}
    </PromptSuggestion.Items>
  </PromptSuggestion>;
}

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
              <span className="blog-chat__source-number">[{source.id}]</span>
              <span className="agent-chat__source-copy">
                <ChatSource.Title>{source.title}</ChatSource.Title>
                {source.sourceKind === 'ai-assisted' && <span className="blog-chat__source-kind">AI 整理</span>}
              </span>
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

function FollowUps({prompts, isDisabled, onFollowUp}: {prompts: string[]; isDisabled: boolean; onFollowUp: (prompt: string) => void}) {
  if (prompts.length < 2) return null;
  return <div className="agent-chat__follow-ups-wrap" role="region" aria-label="继续追问建议">
    <PromptSuggestion className="agent-chat__follow-ups">
      <PromptSuggestion.Header>
        <PromptSuggestion.Title>继续追问</PromptSuggestion.Title>
        <PromptSuggestion.Description>选一个问题，修改后发送。</PromptSuggestion.Description>
      </PromptSuggestion.Header>
      <PromptSuggestion.Items className="blog-chat__suggestions">
        {prompts.map(prompt => <PromptSuggestion.Item key={prompt} isDisabled={isDisabled} onPress={() => onFollowUp(prompt)}>{prompt}</PromptSuggestion.Item>)}
      </PromptSuggestion.Items>
    </PromptSuggestion>
  </div>;
}

function Turn({conversationId, order, messages, isLatest, busy, onFollowUp, onRegenerate, suggestionsDisabled}: {
  conversationId: Id<'assistantConversations'>; order: number; messages: RenderMessage[];
  isLatest: boolean; busy: boolean; onFollowUp: (prompt: string) => void;
  onRegenerate: (prompt: string) => void; suggestionsDisabled: boolean;
}) {
  // Each loaded turn has one bounded indexed subscription; pagination never loses
  // older citations by limiting a separate run list to the latest N generations.
  const run = useQuery(api.assistant.getRunStates, {conversationId, orders: [order]})?.[0];
  const pending = run?.status === 'queued' || run?.status === 'running';
  const userPrompt = messages.find(message => message.role === 'user')?.text ?? '';
  const assistant = messages.find(message => message.role === 'assistant');
  const answerText = assistant?.parts.filter(part => part.type === 'text').map(part => part.text).join('') ?? '';
  const hasAnswer = Boolean(answerText);
  const completed = run?.status === 'completed' && assistant?.status !== 'streaming' && assistant?.status !== 'pending';
  const followUps = completed && isLatest && !busy
    ? deriveFollowUpSuggestions(userPrompt, answerText, run?.sources ?? [])
    : [];
  return <div className="agent-chat__turn">
    {messages.map(message => message.role === 'user'
      ? <ChatMessage.User key={message.key} className="blog-chat__user"><ChatMessage.Bubble><ChatMessage.Content>{message.text}</ChatMessage.Content></ChatMessage.Bubble></ChatMessage.User>
      : message.role === 'assistant' ? <Answer key={message.key} message={message} sources={run?.sources ?? []} /> : null)}
    {pending && !hasAnswer && <ChatLoader.Dots label={run?.sources.length ? '正在整理回答' : '正在检索文章'} />}
    {run?.status === 'canceled' && <p className="blog-chat__notice">已停止生成。{hasAnswer ? '当前回答可能不完整。' : ''}</p>}
    {run?.status === 'failed' && <>
      <p role="alert" className="blog-chat__error">{run.error || '回答未完成，请重新提问。'}</p>
      {!busy && userPrompt && <div className="agent-chat__turn-actions">
        <ChatMessageActions className="blog-chat__actions">
          <ChatMessageActions.Regenerate size="sm" variant="ghost" aria-label="重新生成" tooltip={false}
            isDisabled={suggestionsDisabled} onPress={() => onRegenerate(userPrompt)} />
        </ChatMessageActions>
      </div>}
    </>}
    {followUps.length > 0 && <FollowUps prompts={followUps} isDisabled={suggestionsDisabled} onFollowUp={onFollowUp} />}
  </div>;
}

function Transcript({conversationId, threadId, onHasMessages, onSuggestion, onRegenerate, busy, suggestionsDisabled}: {
  conversationId: Id<'assistantConversations'>; threadId: string; onHasMessages: (value: boolean) => void;
  onSuggestion: (prompt: string) => void; onRegenerate: (prompt: string) => void; busy: boolean;
  suggestionsDisabled: boolean;
}) {
  const messages = useUIMessages(api.assistant.listThreadMessages, {threadId}, {initialNumItems: 20, stream: true});
  const turns = useMemo(() => {
    const groups = new Map<number, RenderMessage[]>();
    for (const message of messages.results) groups.set(message.order, [...(groups.get(message.order) ?? []), message]);
    return [...groups].sort(([a], [b]) => a - b).map(([order, items]) => ({order, messages: items.sort((a, b) => a.stepOrder - b.stepOrder)}));
  }, [messages.results]);
  const hasMessages = turns.length > 0;
  useEffect(() => { onHasMessages(hasMessages); }, [hasMessages, onHasMessages]);
  return <ChatConversation className="blog-chat__conversation" role="region" aria-label="AI 对话记录" tabIndex={0}>
    <ChatConversation.Content className="blog-chat__messages">
      {messages.status === 'LoadingFirstPage' ? <ChatLoader.Dots label="正在加载对话" /> : <>
        {messages.status === 'CanLoadMore' && <Button variant="ghost" size="sm" onPress={() => messages.loadMore(20)}>查看更早的消息</Button>}
        {messages.status === 'LoadingMore' && <ChatLoader.Dots label="正在加载更早的消息" />}
        {!turns.length && <Welcome onSuggestion={onSuggestion} isDisabled={suggestionsDisabled} />}
        {turns.map((turn, index) => <Turn key={turn.order} conversationId={conversationId} {...turn}
          isLatest={index === turns.length - 1} busy={busy} onFollowUp={onSuggestion} onRegenerate={onRegenerate}
          suggestionsDisabled={suggestionsDisabled} />)}
      </>}
    </ChatConversation.Content>
    <ChatConversation.ScrollButton aria-label="回到最新回答" tooltip={false} />
  </ChatConversation>;
}

export default function AgentChat({onReady, requestedPrompt, onPromptConsumed}: {
  onReady?: () => void; requestedPrompt?: ChatPromptRequest; onPromptConsumed?: (id: string) => void;
}) {
  const conversations = usePaginatedQuery(api.assistant.listConversations, {}, {initialNumItems: 20});
  const create = useMutation(api.assistant.createConversation);
  const send = useMutation(api.assistant.sendMessage);
  const cancel = useMutation(api.assistant.cancel);
  const remove = useMutation(api.assistant.deleteConversation);
  const [selected, setSelected] = useState<Id<'assistantConversations'> | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const [value, setValue] = useState('');
  const [hasMessages, setHasMessages] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<ChatPromptRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const locked = useRef(false);
  const retry = useRef<{conversationId: Id<'assistantConversations'>; prompt: string; requestId: string} | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const receivedPrompts = useRef(new Set<string>());
  const currentId = selected ?? conversations.results[0]?.id ?? null;
  const conversation = useQuery(api.assistant.getConversation, currentId ? {conversationId: currentId} : 'skip');
  const busy = Boolean(conversation?.activeRun);
  useEffect(() => { onReady?.(); }, [onReady]);
  useEffect(() => {
    if (!selected && conversations.results[0]) setSelected(conversations.results[0].id);
  }, [selected, conversations.results]);
  useEffect(() => {
    if (!requestedPrompt || submitting || locked.current || receivedPrompts.current.has(requestedPrompt.id)) return;
    receivedPrompts.current.add(requestedPrompt.id);
    const prompt = requestedPrompt.text.trim();
    if (!prompt || prompt.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt)) {
      setError('搜索问题须为 1–2000 字的有效文本，请调整后重试。');
      onPromptConsumed?.(requestedPrompt.id);
      return;
    }
    if (value.trim() && value.trim() !== prompt) {
      setPendingPrompt({...requestedPrompt, text: prompt});
    } else {
      setValue(prompt); setPendingPrompt(null); setError('');
      onPromptConsumed?.(requestedPrompt.id);
    }
    input.current?.focus({preventScroll: true});
  }, [requestedPrompt, onPromptConsumed, submitting, value]);

  function chooseSuggestion(prompt: string) {
    if (value.trim() || submitting || busy) return;
    setValue(prompt); setError(''); input.current?.focus({preventScroll: true});
  }

  function consumePendingPrompt(replace: boolean) {
    if (!pendingPrompt || locked.current) return;
    if (replace) { setValue(pendingPrompt.text); setError(''); }
    onPromptConsumed?.(pendingPrompt.id); setPendingPrompt(null);
    input.current?.focus({preventScroll: true});
  }

  async function newConversation() {
    if (locked.current) return;
    locked.current = true; setSubmitting(true); setError('');
    try { const id = await create(); setSelected(id); setHasMessages(false); setHistoryOpen(false); setValue(''); retry.current = null; }
    catch (failure) { setError(errorMessage(failure)); }
    finally { locked.current = false; setSubmitting(false); }
  }

  function selectConversation(key: string | number) {
    const item = conversations.results.find(conversation => conversation.id === key);
    if (!item) return;
    setSelected(item.id); setHasMessages(false); setHistoryOpen(false); setValue(''); setError(''); retry.current = null;
  }

  async function submit(overridePrompt?: string) {
    const prompt = (overridePrompt ?? value).trim();
    if (locked.current || busy || !prompt || prompt.length > 2000) return;
    locked.current = true; setSubmitting(true); setError('');
    try {
      const conversationId = currentId ?? await create();
      setSelected(conversationId);
      const request = retry.current?.conversationId === conversationId && retry.current.prompt === prompt
        ? retry.current : {conversationId, prompt, requestId: crypto.randomUUID()};
      retry.current = request;
      await send(request);
      retry.current = null; setValue(''); setAnnouncement('问题已保存。');
    } catch (failure) { setError(errorMessage(failure)); }
    finally { locked.current = false; setSubmitting(false); }
  }

  function regenerate(prompt: string) {
    if (locked.current || busy || submitting || !prompt.trim()) return;
    retry.current = currentId ? {conversationId: currentId, prompt: prompt.trim(), requestId: crypto.randomUUID()} : null;
    void submit(prompt);
  }

  async function stop() {
    if (!currentId) return;
    try { await cancel({conversationId: currentId}); setAnnouncement('已停止生成。'); }
    catch (failure) { setError(errorMessage(failure)); }
  }

  function nextConversationAfterDelete(deletedId: Id<'assistantConversations'>) {
    const remaining = conversations.results.filter(item => item.id !== deletedId);
    if (!remaining.length) return null;
    const index = conversations.results.findIndex(item => item.id === deletedId);
    return remaining[Math.min(index, remaining.length - 1)]?.id ?? remaining[0]?.id ?? null;
  }

  async function deleteCurrentConversation() {
    if (!currentId || locked.current || deleting) return;
    locked.current = true; setDeleting(true); setError('');
    const deletedId = currentId;
    const nextId = nextConversationAfterDelete(deletedId);
    setSelected(nextId);
    setHasMessages(false); setHistoryOpen(false); setMenuOpen(false); setDeleteConfirmOpen(false);
    setValue(''); retry.current = null;
    try {
      await remove({conversationId: deletedId});
      setAnnouncement('对话已删除。');
    } catch (failure) {
      setSelected(deletedId);
      setError(errorMessage(failure));
    } finally { locked.current = false; setDeleting(false); }
  }

  return <section ref={setPortalContainer} className={`${surface.surface} blog-chat agent-chat not-prose`} aria-label="与 AI 博客助手对话" data-sentry-mask data-pagefind-ignore>
    <div className="blog-chat__header">
      <h2 className="blog-chat__identity agent-chat__title" title={conversation?.title}>{conversation?.title ?? 'AI 博客助手'}</h2>
      <div className="agent-chat__header-actions">
        <Dropdown isOpen={menuOpen} onOpenChange={open => { if (!currentId || deleting) return; setMenuOpen(open); }}>
          <Tooltip isDisabled={menuOpen || !currentId}>
            <Button variant="ghost" size="sm" isIconOnly className="agent-chat__menu" aria-label="对话操作"
              isDisabled={!currentId || deleting}>
              <Ellipsis width={18} height={18} aria-hidden="true" />
            </Button>
            <Tooltip.Content className="blog-chat__tooltip" placement="bottom end" offset={6} UNSTABLE_portalContainer={portalContainer ?? undefined}>对话操作</Tooltip.Content>
          </Tooltip>
          <Dropdown.Popover placement="bottom end" offset={8} containerPadding={12} UNSTABLE_portalContainer={portalContainer ?? undefined} className="agent-chat__menu-popover" data-agent-chat-menu-popover data-sentry-mask>
            <Dropdown.Menu aria-label="对话操作" onAction={key => {
              if (key === 'delete') { setMenuOpen(false); setDeleteConfirmOpen(true); }
            }}>
              <Dropdown.Item key="delete" id="delete" textValue="删除对话" variant="danger">删除对话</Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
        <AlertDialog.Backdrop isOpen={deleteConfirmOpen} onOpenChange={open => { if (!deleting) setDeleteConfirmOpen(open); }}>
          <AlertDialog.Container placement="center">
            <AlertDialog.Dialog className="agent-chat__delete-dialog" aria-label="删除对话">
              <AlertDialog.CloseTrigger aria-label="取消" />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>删除这条对话？</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>将永久删除「{conversation?.title ?? '当前对话'}」及其全部消息，此操作无法撤销。</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button variant="tertiary" onPress={() => setDeleteConfirmOpen(false)} isDisabled={deleting}>取消</Button>
                <Button variant="danger" isPending={deleting} onPress={() => { void deleteCurrentConversation(); }}>删除对话</Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
        <Popover isOpen={historyOpen} onOpenChange={setHistoryOpen}>
          <Button variant="ghost" size="sm" className="agent-chat__history-trigger">历史</Button>
          <Popover.Content placement="bottom end" offset={8} containerPadding={12} UNSTABLE_portalContainer={portalContainer ?? undefined} className="agent-chat__history-popover" data-agent-history-popover data-sentry-mask>
            <Popover.Dialog className="agent-chat__history" aria-label="已保存的 AI 对话">
              <Popover.Heading className="agent-chat__history-heading">历史对话</Popover.Heading>
              {conversations.status === 'LoadingFirstPage' && <ChatLoader.Dots label="正在加载对话列表" />}
              {!conversations.results.length && conversations.status !== 'LoadingFirstPage' && <p className="agent-chat__history-empty">还没有保存的对话。</p>}
              {conversations.results.length > 0 && <ListBox aria-label="选择 AI 对话" className="agent-chat__history-list" selectionMode="single" selectedKeys={currentId ? [currentId] : []} shouldSelectOnPressUp escapeKeyBehavior="none" autoFocus onSelectionChange={keys => {
                if (keys === 'all') return;
                const key = keys.values().next().value ?? currentId;
                if (key !== null && key !== undefined) selectConversation(key);
              }}>
                {conversations.results.map(item => <ListBox.Item key={item.id} id={item.id} textValue={item.title} className="agent-chat__history-item">
                  <span className="agent-chat__history-title" title={item.title}>{item.title}</span>
                  <ListBox.ItemIndicator />
                </ListBox.Item>)}
              </ListBox>}
              {conversations.status === 'CanLoadMore' && <Button variant="ghost" size="sm" className="agent-chat__history-more" onPress={() => conversations.loadMore(20)}>更多对话</Button>}
              {conversations.status === 'LoadingMore' && <ChatLoader.Dots label="正在加载更多对话" />}
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
        <Tooltip delay={400}>
          <Button variant="ghost" size="sm" isIconOnly className="agent-chat__new" aria-label="新对话" onPress={newConversation} isDisabled={submitting}><Plus width={18} height={18} aria-hidden="true" /></Button>
          <Tooltip.Content className="blog-chat__tooltip" placement="bottom end" offset={6} UNSTABLE_portalContainer={portalContainer ?? undefined}>新对话</Tooltip.Content>
        </Tooltip>
      </div>
    </div>
    {conversation && currentId ? <Transcript key={conversation.threadId} conversationId={currentId} threadId={conversation.threadId}
      onHasMessages={setHasMessages} onSuggestion={chooseSuggestion} onRegenerate={regenerate} busy={busy}
      suggestionsDisabled={submitting || busy || Boolean(value.trim())} />
      : currentId || conversations.status === 'LoadingFirstPage' ? <div className="agent-chat__welcome"><ChatLoader.Dots label="正在加载对话" /></div>
      : <Welcome onSuggestion={chooseSuggestion} isDisabled={submitting || Boolean(value.trim())} />}
    <div className="blog-chat__composer">
      <div className="blog-chat__sr-only" role="status" aria-live="polite">{announcement}</div>
      {pendingPrompt && <div className="agent-chat__prompt-request" role="group" aria-label="待使用的搜索问题">
        <p role="status">已有未发送内容，是否换成搜索问题？</p>
        <p className="agent-chat__requested-text">{pendingPrompt.text}</p>
        <div className="agent-chat__prompt-actions">
          <Button variant="secondary" size="sm" isDisabled={submitting} onPress={() => consumePendingPrompt(true)}>使用搜索问题</Button>
          <Button variant="ghost" size="sm" isDisabled={submitting} onPress={() => consumePendingPrompt(false)}>保留草稿</Button>
        </div>
      </div>}
      {error && <p role="alert" className="blog-chat__error">{error}</p>}
      <PromptInput value={value} onValueChange={setValue} status={busy ? 'streaming' : submitting ? 'submitted' : 'ready'} onSubmit={submit} onStop={stop} isDisabled={submitting} maxHeight={160}>
        <PromptInput.Shell><PromptInput.Content><PromptInput.TextArea ref={input} aria-label="向 AI 博客助手提问" placeholder={hasMessages ? '继续追问，或提出新问题…' : '向 AI 博客助手提问…'} maxLength={2000} /></PromptInput.Content>
          <PromptInput.Toolbar><PromptInput.ToolbarStart><span className="blog-chat__input-help">{value.length ? `${value.length} / 2000` : busy ? '正在生成，可离开后回来查看' : hasMessages ? '围绕当前对话继续追问' : '检索公开博客文章'}</span></PromptInput.ToolbarStart>
            <PromptInput.ToolbarEnd><PromptInput.Send aria-label={busy ? '停止生成' : '发送问题'} isDisabled={submitting || (!busy && !value.trim())} /></PromptInput.ToolbarEnd>
          </PromptInput.Toolbar>
        </PromptInput.Shell>
        <PromptInput.Footer>AI 回答请以原文为准 · 对话已登录保存 · 真人咨询请使用「咨询」</PromptInput.Footer>
      </PromptInput>
    </div>
  </section>;
}
