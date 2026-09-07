import {useEffect, useState} from 'react';
import {Button, Chip, Label, Slider} from '@heroui/react';
import {ChainOfThought} from '@heroui-pro/react/chain-of-thought';
import {ChatMessage} from '@heroui-pro/react/chat-message';
import {ChatSource, ChatSources} from '@heroui-pro/react/chat-source';
import {ChatMessageActions} from '@heroui-pro/react/chat-message-actions';
import {CodeBlock} from '@heroui-pro/react/code-block';
import '../../styles/demos.css';
import styles from './DemoSurface.module.css';

const steps = [
  {label: '读取文章', detail: '读取事先准备好的文章片段与目录。'},
  {label: '整理要点', detail: '将示例材料整理成内容、组件和部署三个主题。'},
  {label: '生成展示', detail: '逐段回放预先编写的回答，展示流式消息的交互。'},
];

const answer = [
  '文章由 Astro 在构建时生成完整 HTML。',
  '这个交互区域是一棵独立的 React 组件树，使用 HeroUI 控件和 HeroUI Pro 消息组件。',
  '同一份组件同时用于 MDX 文章和独立页面；同页的 Svelte 组件管理自己的状态。',
  '演示只回放本地数据，没有请求模型，也没有保存或发送输入。',
];

const lastFrame = steps.length + answer.length;
const embedCode = `import AgentReplay from './AgentReplay';

<AgentReplay client:visible />`;

/** One implementation for both MDX embeds and the standalone lab page. */
export default function AgentReplay() {
  const [frame, setFrame] = useState(lastFrame);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    if (!playing || frame >= lastFrame) return;
    const timeout = window.setTimeout(() => {
      const next = frame + 1;
      setFrame(next);
      if (next === lastFrame) setPlaying(false);
    }, 950 / speed);
    return () => window.clearTimeout(timeout);
  }, [frame, playing, speed]);

  const complete = frame === lastFrame;
  const status = playing ? '正在回放' : complete ? '回放完成' : frame ? '已暂停' : '等待开始';
  const visibleSteps = steps.slice(0, Math.min(frame, steps.length));
  const visibleAnswer = answer.slice(0, Math.max(0, frame - steps.length));

  function reset() {
    setPlaying(false);
    setFrame(0);
    setCopied(false);
    setCopyError(false);
  }

  function play() {
    if (complete) setFrame(0);
    setPlaying(true);
    setCopied(false);
  }

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(visibleAnswer.join('\n\n'));
      setCopied(true);
      setCopyError(false);
    } catch { setCopyError(true); }
  }

  return (
    <section
      aria-label="Agent 本地回放演示"
      className={`${styles.surface} @container demo-surface not-prose my-6 min-w-0 rounded-2xl border border-border bg-surface text-foreground`}
      data-demo="agent-replay"
      data-hydrated={hydrated}
      data-frame={frame}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-separator px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <div className="text-base font-semibold" role="heading" aria-level={3}>从步骤到回答</div>
          <div className="mt-1 text-xs leading-relaxed text-muted">先看完整结果，也可以重新播放消息出现的过程。</div>
        </div>
        <Chip color="accent" variant="soft" size="sm"><Chip.Label>HeroUI Pro</Chip.Label></Chip>
      </div>

      <div className="space-y-4 border-b border-separator bg-surface-secondary px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
          <Button onPress={play} isDisabled={!hydrated || playing} size="sm" data-testid="replay-start">
            {complete ? '重新回放' : frame ? '继续回放' : '开始回放'}
          </Button>
          <Button onPress={() => setPlaying(false)} isDisabled={!playing} variant="secondary" size="sm" data-testid="replay-pause">暂停</Button>
            <Button onPress={reset} isDisabled={!hydrated || (!frame && !playing)} variant="ghost" size="sm" data-testid="replay-reset">重置</Button>
            <Button onPress={() => {setPlaying(false); setFrame(lastFrame);}} isDisabled={!hydrated || complete} variant="ghost" size="sm">完整结果</Button>
          </div>
        <Slider
          className="w-full max-w-36"
          value={speed}
          onChange={(value) => setSpeed(Array.isArray(value) ? value[0] : value)}
          minValue={0.5}
          maxValue={2}
          step={0.5}
          isDisabled={!hydrated}
          formatOptions={{style: 'decimal', maximumFractionDigits: 1}}
        >
          <Label className="text-xs">回放速度（倍）</Label>
          <Slider.Output className="text-xs tabular-nums" />
          <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
        </Slider>
        </div>
        <div className="flex gap-1.5" role="progressbar" aria-label="消息回放进度" aria-valuemin={0} aria-valuemax={lastFrame} aria-valuenow={frame}>
          {Array.from({length: lastFrame}, (_, index) => <span key={index} className="h-1 min-w-0 flex-1 rounded-full bg-default transition-colors data-[complete=true]:bg-accent motion-reduce:transition-none" data-complete={index < frame} />)}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-6 px-4 py-6 sm:px-6">
        <ChatMessage.User className="min-w-0">
          <ChatMessage.Bubble className="max-w-full rounded-xl bg-surface-secondary">
            <ChatMessage.Content>这篇博客怎样同时展示文章和交互式 demo？</ChatMessage.Content>
          </ChatMessage.Bubble>
        </ChatMessage.User>

        <ChatMessage.Assistant className="min-w-0 flex-col gap-3 @min-[28rem]:flex-row">
          <ChatMessage.Avatar show alt="演示助手" fallback="A" />
          <ChatMessage.Body className="min-w-0 w-full flex-1 pe-0">
            {frame > 0 ? (
              <ChainOfThought className="min-w-0" defaultExpanded isStreaming={playing && frame <= steps.length}>
                <ChainOfThought.Trigger className="max-w-full whitespace-normal text-left">演示步骤 · {visibleSteps.length} / {steps.length}</ChainOfThought.Trigger>
                <ChainOfThought.Content>
                  <ChainOfThought.Steps>
                    {visibleSteps.map((step, index) => <ChainOfThought.Step key={step.label} label={<span className="flex flex-wrap items-center gap-2"><span className="font-medium text-foreground">{step.label}</span><span className="text-xs text-muted">{playing && index + 1 === frame ? '进行中' : '已完成'}</span></span>}>{step.detail}</ChainOfThought.Step>)}
                  </ChainOfThought.Steps>
                </ChainOfThought.Content>
              </ChainOfThought>
            ) : <div className="rounded-lg bg-surface-secondary p-4 text-sm leading-relaxed text-muted">点击「开始回放」，查看步骤展开与消息逐段出现。</div>}
            {visibleAnswer.length > 0 && (
              <ChatMessage.Content className="mt-4 space-y-3 text-sm leading-relaxed">
                {visibleAnswer.map((paragraph) => <div key={paragraph}>{paragraph}</div>)}
              </ChatMessage.Content>
            )}
            {complete && <CodeBlock className="mt-3 min-w-0 max-w-full rounded-xl">
              <CodeBlock.Header className="flex-wrap gap-2"><span className="text-xs text-muted">MDX · 复用同一个组件</span><CodeBlock.CopyButton code={embedCode} aria-label="复制嵌入代码" /></CodeBlock.Header>
              <CodeBlock.Code code={embedCode} language="tsx" theme="github-light" darkTheme="github-dark" />
            </CodeBlock>}
            {complete && <ChatSources defaultExpanded className="mt-3 min-w-0">
              <ChatSources.Trigger>继续阅读 · 2 个参考来源</ChatSources.Trigger>
              <ChatSources.Content><ChatSources.List>
                <ChatSource enablePreview={false} href="https://github.com/tcitry/astro-book" title="Astro-book" />
                <ChatSource enablePreview={false} href="https://heroui.pro/docs/react/components/chat-message" title="HeroUI Pro" />
              </ChatSources.List></ChatSources.Content>
            </ChatSources>}
            {visibleAnswer.length > 0 && <ChatMessageActions className="mt-2 flex-wrap opacity-100">
              <ChatMessageActions.Copy size="sm" variant="ghost" isDisabled={!hydrated} isCopied={copied} onPress={copyAnswer} aria-label={copied ? '回答已复制' : '复制演示回答'} />
              <ChatMessageActions.Regenerate size="sm" variant="ghost" isDisabled={!hydrated || playing} onPress={() => {setFrame(0); setPlaying(true); setCopied(false);}} aria-label="重新回放演示" />
            </ChatMessageActions>}
            {copyError && <div role="status" className="text-xs text-muted">浏览器未允许复制，可以直接选中上方文字。</div>}
          </ChatMessage.Body>
        </ChatMessage.Assistant>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-separator px-5 py-3 text-xs text-muted sm:px-6">
        <span role="status" aria-live="polite" data-testid="replay-status">{status} · {frame} / {lastFrame}</span>
        <span>React + HeroUI + Tailwind v4</span>
      </div>
      <noscript><div className="px-5 py-3 text-sm">启用 JavaScript 后可操作演示。文章正文仍然可以正常阅读。</div></noscript>
    </section>
  );
}
