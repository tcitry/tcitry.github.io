import {createElement, useEffect} from 'react';
import BlogClerkProvider from '../../src/components/auth/BlogClerkProvider';

export default function AssistantWorkspace({onReady, requestedPrompt}: {
  onReady?: () => void;
  requestedPrompt?: {text: string; kind?: 'prompt' | 'quote'};
}) {
  useEffect(() => { onReady?.(); }, [onReady]);
  const quote = requestedPrompt?.kind === 'quote' ? requestedPrompt.text : '';
  return createElement(BlogClerkProvider, null, createElement('div', {className: 'assistant-workspace'},
    quote ? createElement('div', {'data-quote-attachment': ''}, quote) : null,
    createElement('textarea', {'aria-label': '向 AI 博客助手提问', 'data-prompt-kind': requestedPrompt?.kind ?? 'prompt', value: quote ? '' : requestedPrompt?.text ?? '', readOnly: true})));
}
