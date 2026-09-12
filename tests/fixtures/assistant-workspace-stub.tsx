import {createElement, useEffect} from 'react';
import BlogClerkProvider from '../../src/components/auth/BlogClerkProvider';

export default function AssistantWorkspace({onReady, requestedPrompt}: {
  onReady?: () => void;
  requestedPrompt?: {text: string};
}) {
  useEffect(() => { onReady?.(); }, [onReady]);
  return createElement(BlogClerkProvider, null, createElement('div', {className: 'assistant-workspace'},
    createElement('textarea', {'aria-label': '向 AI 博客助手提问', value: requestedPrompt?.text ?? '', readOnly: true})));
}
