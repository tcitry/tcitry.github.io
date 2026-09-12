import {Component, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import AssistantWorkspace from './AssistantWorkspace';
import type {AssistantView} from '../../scripts/assistant-ui-state.mjs';
import type {ChatPromptRequest} from './AgentChat';
import {captureFeatureError} from '../../lib/monitoring';

class MountBoundary extends Component<{children: ReactNode; onError: (error: unknown) => void}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(error: unknown) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function mountChat(target: HTMLElement, onClose: () => void, onReady: () => void, ui: {
  initialView?: AssistantView;
  onViewChange?: (view: AssistantView) => void;
  onMountError?: (error: unknown) => void;
} = {}) {
  const {onMountError, ...workspaceUI} = ui;
  let destroyed = false;
  const reportUncaught = (error: unknown) => {
    if (destroyed) return;
    captureFeatureError(error, 'chat', 'render');
    onMountError?.(error);
  };
  const root = createRoot(target, {
    onUncaughtError: reportUncaught,
    onCaughtError: (error) => { if (!destroyed) captureFeatureError(error, 'chat', 'render'); },
    onRecoverableError: (error) => { if (!destroyed) captureFeatureError(error, 'chat', 'render_recoverable'); },
  });
  let requestedPrompt: ChatPromptRequest | undefined;
  const onPromptConsumed = (id: string) => {
    if (requestedPrompt?.id !== id || destroyed) return;
    requestedPrompt = undefined;
    render();
  };
  const render = () => root.render(<MountBoundary onError={(error) => { if (!destroyed) onMountError?.(error); }}>
    <AssistantWorkspace onClose={onClose} onReady={onReady} pathname={target.closest<HTMLElement>('[data-blog-chat-widget]')?.dataset.readerPathname} title={target.closest<HTMLElement>('[data-blog-chat-widget]')?.dataset.readerTitle} {...workspaceUI} requestedPrompt={requestedPrompt} onPromptConsumed={onPromptConsumed} />
  </MountBoundary>);
  try {
    render();
  } catch (error) {
    destroyed = true;
    root.unmount();
    throw error;
  }
  return {
    requestPrompt(text: string) {
      if (destroyed || !text.trim() || text.trim().length > 2000) return;
      requestedPrompt = {id: crypto.randomUUID(), text: text.trim()};
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestedPrompt = undefined;
      root.unmount();
    },
  };
}
