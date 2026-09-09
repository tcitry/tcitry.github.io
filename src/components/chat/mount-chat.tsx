import {createRoot} from 'react-dom/client';
import AssistantWorkspace from './AssistantWorkspace';
import type {AssistantView} from '../../scripts/assistant-ui-state.mjs';

export function mountChat(target: HTMLElement, onClose: () => void, onReady: () => void, ui: {initialView?: AssistantView; onViewChange?: (view: AssistantView) => void} = {}) {
  const root = createRoot(target);
  root.render(<AssistantWorkspace onClose={onClose} onReady={onReady} pathname={target.closest<HTMLElement>('[data-blog-chat-widget]')?.dataset.readerPathname} title={target.closest<HTMLElement>('[data-blog-chat-widget]')?.dataset.readerTitle} reading={target.closest<HTMLElement>('[data-blog-chat-widget]')?.dataset.readerInitial === 'true'} {...ui} />);
  return {destroy: () => root.unmount()};
}
