import {useEffect, useMemo, useRef, useState} from 'react';
import type {Components} from 'react-markdown';
import {Button, Tooltip} from '@heroui/react';
import {ChatConversation} from '@heroui-pro/react/chat-conversation';
import {ChatLoader} from '@heroui-pro/react/chat-loader';
import {ChatMessage} from '@heroui-pro/react/chat-message';
import {ChatMessageActions} from '@heroui-pro/react/chat-message-actions';
import {ChatSource, ChatSources} from '@heroui-pro/react/chat-source';
import {Markdown} from '@heroui-pro/react/markdown';
import {PromptInput} from '@heroui-pro/react/prompt-input';
import {PromptSuggestion} from '@heroui-pro/react/prompt-suggestion';
import surface from '../demos/DemoSurface.module.css';
import '../../styles/chat.css';

type Source = {id: string; title: string; url: string; sourceKind: 'author' | 'ai-assisted'};
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources: Source[];
  state: 'pending' | 'complete' | 'stopped' | 'error';
  error?: string;
};
type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error';
type ChatEvent =
  | {type: 'sources'; sources: Source[]}
  | {type: 'text'; text: string}
  | {type: 'error'; message: string; retryAfter?: number}
  | {type: 'done'};

const suggestions = [
  '契约测试适合解决哪些问题？',
  '如何用 Git 管理代码提交？',
  'SwiftData 中的 DataStore 有什么作用？',
];
const MAX_INPUT = 2000;
const MAX_ANSWER = 100_000;

function sourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.origin === 'https://yindongliang.com' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function parseEvent(line: string): ChatEvent {
  const event = JSON.parse(line);
  if (event.type === 'done') return {type: 'done'};
  if (event.type === 'text' && typeof event.text === 'string') return {type: 'text', text: event.text};
  if (event.type === 'error' && typeof event.message === 'string') {
    return {type: 'error', message: event.message.slice(0, 500), retryAfter: Number(event.retryAfter) || undefined};
  }
  if (event.type === 'sources' && Array.isArray(event.sources) && event.sources.length <= 20) {
    const ids = new Set<string>();
    const sources: Source[] = event.sources.map((item: Source) => {
      if (!item || typeof item.id !== 'string' || !/^\d+$/.test(item.id) || ids.has(item.id)
        || typeof item.title !== 'string' || typeof item.url !== 'string' || !sourceUrl(item.url)
        || !['author', 'ai-assisted'].includes(item.sourceKind)) throw new Error('来源信息不完整，请稍后重新提问。');
      ids.add(item.id);
      return {id: item.id, title: item.title.slice(0, 300), url: sourceUrl(item.url)!, sourceKind: item.sourceKind};
    });
    return {type: 'sources', sources};
  }
  throw new Error('回答连接异常，请稍后重新提问。');
}

function retrySeconds(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000)) || 0;
}

function completedHistory(messages: Message[], question: string) {
  const pairs: {role: 'user' | 'assistant'; content: string}[][] = [];
  for (let index = 0; index < messages.length - 1; index++) {
    const user = messages[index];
    const assistant = messages[index + 1];
    if (user.role === 'user' && assistant.role === 'assistant' && assistant.state === 'complete' && assistant.content) {
      pairs.push([{role: 'user', content: user.content}, {role: 'assistant', content: assistant.content}]);
    }
  }
  let history: {role: 'user' | 'assistant'; content: string}[] = [{role: 'user', content: question}];
  for (const pair of pairs.slice(-4).reverse()) {
    const next = [...pair, ...history];
    if (pair[1].content.length > 8000 || next.reduce((total, message) => total + message.content.length, 0) > 16000
      || new TextEncoder().encode(JSON.stringify({messages: next})).length > 30_000) break;
    history = next;
  }
  return history;
}

function Answer({message}: {message: Message}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const components = useMemo<Components>(() => ({
    // Only the server's retrieved, published articles can become answer links.
    a: ({href, children}) => {
      const url = href && sourceUrl(href);
      const allowed = url && message.sources.some((source) => source.url === url);
      return allowed ? <a href={url} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
    },
    img: ({alt}) => alt ? <span>{alt}</span> : null,
    h1: ({children}) => <h3>{children}</h3>,
    h2: ({children}) => <h3>{children}</h3>,
    table: ({children}) => <div className="blog-chat__table"><table>{children}</table></div>,
  }), [message.sources]);

  async function copy() {
    try {
      const sources = message.sources.map((source) => `[${source.id}] ${source.title} ${source.url}`).join('\n');
      await navigator.clipboard.writeText(`${message.content}${sources ? `\n\n${sources}` : ''}`);
      setCopied(true);
      setCopyError(false);
    } catch { setCopyError(true); }
  }

  return (
    <ChatMessage.Assistant className="blog-chat__assistant" data-message-state={message.state}>
      <ChatMessage.Body className="blog-chat__body">
        <div className="blog-chat__sr-only">博客助手</div>
        {message.content && <ChatMessage.Content>
          <Markdown id={message.id} components={components} className="blog-chat__answer">{message.content}</Markdown>
        </ChatMessage.Content>}
        {message.state === 'pending' && !message.content && <ChatLoader.Dots label={message.sources.length ? '正在整理回答' : '正在检索文章'} />}
        {message.sources.length > 0 && <ChatSources defaultExpanded className="blog-chat__sources">
          <ChatSources.Trigger>参考文章 · {message.sources.length}</ChatSources.Trigger>
          <ChatSources.Content>
            <ChatSources.List className="blog-chat__source-list">
              {message.sources.map((source) => <ChatSource key={source.id} href={source.url} title={source.title} enablePreview={false} className="blog-chat__source">
                <ChatSource.Trigger target="_blank" rel="noopener noreferrer" className="blog-chat__source-link">
                  <span className="blog-chat__source-number">[{source.id}]</span>
                  <ChatSource.Title>{source.title}</ChatSource.Title>
                  {source.sourceKind === 'ai-assisted' && <span className="blog-chat__source-kind">AI 整理</span>}
                </ChatSource.Trigger>
              </ChatSource>)}
            </ChatSources.List>
          </ChatSources.Content>
        </ChatSources>}
        {message.state === 'stopped' && <p className="blog-chat__notice">已停止生成。{message.content ? '当前回答可能不完整。' : '可以修改问题后再次发送。'}</p>}
        {message.error && <p role="alert" className="blog-chat__error">{message.error}</p>}
        {message.content && message.state !== 'pending' && <ChatMessageActions className="blog-chat__actions">
          <ChatMessageActions.Copy isCopied={copied} onPress={copy} aria-label={copied ? '回答和出处已复制' : '复制回答和出处'} tooltip={false} />
        </ChatMessageActions>}
        {copyError && <p role="status" className="blog-chat__notice">浏览器未允许复制，可以选中回答文字复制。</p>}
      </ChatMessage.Body>
    </ChatMessage.Assistant>
  );
}

export default function BlogChat({onClose, onReady}: {onClose: () => void; onReady: () => void}) {
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<ChatStatus>('ready');
  const [retryAfter, setRetryAfter] = useState(0);
  const [announcement, setAnnouncement] = useState('输入问题，开始查阅博客。');
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const chatRoot = useRef<HTMLElement>(null);
  const busy = status === 'submitted' || status === 'streaming';
  const conversationTitle = messages.find((message) => message.role === 'user')?.content.replace(/\s+/g, ' ') || '博客助手';

  useEffect(() => {
    setHydrated(true);
    return () => { controller.current?.abort(); };
  }, []);

  useEffect(() => { if (hydrated) onReady(); }, [hydrated, onReady]);

  useEffect(() => {
    if (!retryAfter) return;
    const timer = window.setTimeout(() => setRetryAfter((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retryAfter]);

  function update(id: string, patch: Partial<Message>) {
    setMessages((current) => current.map((message) => message.id === id ? {...message, ...patch} : message));
  }

  async function submit() {
    const question = value.trim();
    if (!question || question.length > MAX_INPUT || controller.current || retryAfter || !hydrated) return;
    const run = new AbortController();
    controller.current = run;
    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const history = completedHistory(messages, question);
    setMessages((current) => [...current,
      {id: userId, role: 'user', content: question, sources: [], state: 'complete'},
      {id: assistantId, role: 'assistant', content: '', sources: [], state: 'pending'},
    ]);
    setValue('');
    setStatus('submitted');
    setAnnouncement('正在检索公开文章。');
    let answer = '';
    let finished = false;
    let failed = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    function receive(line: string) {
      if (!line.trim() || finished || failed) return;
      const event = parseEvent(line);
      if (event.type === 'sources') {
        update(assistantId, {sources: event.sources});
        setAnnouncement(event.sources.length ? `找到 ${event.sources.length} 篇参考文章，正在整理回答。` : '正在核对文章内容。');
      } else if (event.type === 'text') {
        answer += event.text;
        if (answer.length > MAX_ANSWER) throw new Error('回答过长，连接已结束。请缩小问题范围。');
        update(assistantId, {content: answer});
        setStatus('streaming');
      } else if (event.type === 'error') {
        failed = true;
        update(assistantId, {state: 'error', error: event.message});
        setRetryAfter(Math.min(3600, Math.max(0, Math.ceil(event.retryAfter ?? 0))));
        setStatus('error');
        setAnnouncement('回答未完成，可以稍后重新提问。');
      } else {
        finished = true;
        update(assistantId, {state: 'complete'});
        setStatus('ready');
        setAnnouncement('回答已完成，可查看参考文章或继续追问。');
      }
    }

    try {
      const response = await fetch('/api/chat/', {
        method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/x-ndjson'},
        body: JSON.stringify({messages: history}), signal: run.signal,
      });
      if (!response.ok) {
        const wait = retrySeconds(response.headers.get('Retry-After'));
        setRetryAfter(Math.min(3600, wait || (response.status === 429 ? 10 : 0)));
        let message = response.status === 429 ? '当前提问较多，请稍后再试。' : '暂时无法完成回答，请稍后再试。';
        try {
          const body = await response.json();
          if (typeof body.message === 'string') message = body.message.slice(0, 500);
          else if (typeof body.error === 'string') message = body.error.slice(0, 500);
        } catch { /* A proxy error can return HTML instead of JSON. */ }
        throw new Error(message);
      }
      if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) throw new Error('回答连接异常，请稍后重新提问。');
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (!finished && !failed) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, {stream: !chunk.done});
        if (buffer.length > MAX_ANSWER * 2) throw new Error('回答连接异常，请稍后重新提问。');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n')) >= 0) {
          receive(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 1);
        }
        if (chunk.done) {
          if (buffer.trim()) receive(buffer);
          if (!finished && !failed) throw new Error('连接提前结束，当前回答可能不完整。请稍后重新提问。');
          break;
        }
      }
    } catch (error) {
      if (run.signal.aborted) {
        update(assistantId, {state: 'stopped'});
        setStatus('ready');
        setAnnouncement('已停止生成。');
      } else {
        update(assistantId, {state: 'error', error: error instanceof Error ? error.message : '网络连接失败，请稍后再试。'});
        setStatus('error');
        setAnnouncement('回答未完成，可以稍后重新提问。');
      }
    } finally {
      await reader?.cancel().catch(() => {});
      if (controller.current === run) controller.current = null;
    }
  }

  function reset() {
    if (controller.current) return;
    setMessages([]);
    setValue('');
    setStatus('ready');
    setAnnouncement('已清空本页对话。');
    input.current?.focus();
  }

  return (
    <section ref={chatRoot} className={`${surface.surface} blog-chat not-prose`} aria-label="与博客助手对话" data-chat-hydrated={hydrated} data-chat-status={status}>
      <div className="blog-chat__header">
        <div className="blog-chat__identity" title={conversationTitle}>{conversationTitle}</div>
        <div className="blog-chat__header-actions">
          <Tooltip delay={400}>
            <Button variant="ghost" size="sm" isIconOnly onPress={reset} isDisabled={!hydrated || busy || !messages.length} aria-label="新对话">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </Button>
            <Tooltip.Content className="blog-chat__tooltip" placement="bottom" UNSTABLE_portalContainer={chatRoot.current ?? undefined}>新对话</Tooltip.Content>
          </Tooltip>
          <Tooltip delay={400}>
            <Button variant="ghost" size="sm" isIconOnly onPress={onClose} aria-label="关闭博客助手">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
            </Button>
            <Tooltip.Content className="blog-chat__tooltip" placement="bottom" UNSTABLE_portalContainer={chatRoot.current ?? undefined}>关闭博客助手</Tooltip.Content>
          </Tooltip>
        </div>
      </div>
      <ChatConversation className="blog-chat__conversation" role="region" aria-label="对话记录" tabIndex={0}>
        <ChatConversation.Content className="blog-chat__messages">
          {!messages.length && <PromptSuggestion className="blog-chat__welcome">
            <PromptSuggestion.Header>
              <PromptSuggestion.Title>从一个问题开始</PromptSuggestion.Title>
              <PromptSuggestion.Description>查找文章、梳理要点，或围绕一个主题继续追问。</PromptSuggestion.Description>
            </PromptSuggestion.Header>
            <PromptSuggestion.Items className="blog-chat__suggestions">
              {suggestions.map((suggestion) => <PromptSuggestion.Item key={suggestion} isDisabled={!hydrated} onPress={() => {setValue(suggestion); input.current?.focus();}}>{suggestion}</PromptSuggestion.Item>)}
            </PromptSuggestion.Items>
          </PromptSuggestion>}
          {messages.map((message) => message.role === 'user'
            ? <ChatMessage.User key={message.id} className="blog-chat__user"><ChatMessage.Bubble><ChatMessage.Content>{message.content}</ChatMessage.Content></ChatMessage.Bubble></ChatMessage.User>
            : <Answer key={message.id} message={message} />)}
        </ChatConversation.Content>
        <ChatConversation.ScrollButton aria-label="回到最新回答" tooltip={false} />
      </ChatConversation>
      <div className="blog-chat__composer">
        <div className="blog-chat__sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
        <PromptInput value={value} onValueChange={setValue} status={status} onSubmit={submit} onStop={() => controller.current?.abort()} isDisabled={!hydrated} maxHeight={160}>
          <PromptInput.Shell>
            <PromptInput.Content>
              <PromptInput.TextArea ref={input} aria-label="向博客助手提问" placeholder="向博客助手提问…" maxLength={MAX_INPUT} aria-describedby="blog-chat-input-help" />
            </PromptInput.Content>
            <PromptInput.Toolbar>
              <PromptInput.ToolbarStart><span className="blog-chat__input-help" id="blog-chat-input-help">{retryAfter ? `${retryAfter} 秒后可以重试` : value.length ? `${value.length} / ${MAX_INPUT}` : '搜索博客文章'}</span></PromptInput.ToolbarStart>
              <PromptInput.ToolbarEnd>
                <Tooltip delay={400}>
                  <PromptInput.Send aria-label={busy ? '停止生成' : '发送问题'} isDisabled={!busy && (retryAfter > 0 || !value.trim())} />
                  <Tooltip.Content className="blog-chat__tooltip" placement="top" UNSTABLE_portalContainer={chatRoot.current ?? undefined}>{busy ? '停止生成' : '发送问题'}</Tooltip.Content>
                </Tooltip>
              </PromptInput.ToolbarEnd>
            </PromptInput.Toolbar>
          </PromptInput.Shell>
          <PromptInput.Footer>回答请以原文为准 · 对话仅保留在当前页面</PromptInput.Footer>
        </PromptInput>
      </div>
      <noscript><p className="blog-chat__notice">启用 JavaScript 后可以提问，也可以使用站点搜索查找文章。</p></noscript>
    </section>
  );
}
