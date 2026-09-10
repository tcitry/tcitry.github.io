import {createRoot} from 'react-dom/client';
import AssistantWorkspace from './AssistantWorkspace';
import type {AssistantView} from '../../scripts/assistant-ui-state.mjs';
import type {ChatPromptRequest} from './AgentChat';

export function mountChat(target: HTMLElement, onClose: () => void, onReady: () => void, ui: {initialView?: AssistantView; onViewChange?: (view: AssistantView) => void} = {}) {
  const root = createRoot(target);
  let requestedPrompt: ChatPromptRequest | undefined;
  let destroyed = false;
  const onPromptConsumed = (id: string) => {
    if (requestedPrompt?.id !== id || destroyed) return;
    requestedPrompt = undefined;
    render();
  };
  const render = () => root.render(<AssistantWorkspace onClose={onClose} onReady={onReady} pathname={target.closest<HTMLElement>('[data-blog-chat-widget]')?.dataset.readerPathname} title={target.closest<HTMLElement>('[data-blog-chat-widget]')?.dataset.readerTitle} {...ui} requestedPrompt={requestedPrompt} onPromptConsumed={onPromptConsumed} />);
  render();
  return {
    requestPrompt(text: string) {
      if (destroyed || !text.trim() || text.trim().length > 2000) return;
      requestedPrompt = {id: crypto.randomUUID(), text: text.trim()};
      render();
    },
    destroy() { destroyed = true; requestedPrompt = undefined; root.unmount(); },
  };
}
