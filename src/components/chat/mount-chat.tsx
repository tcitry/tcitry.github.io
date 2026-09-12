import {Component, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import AssistantWorkspace from './AssistantWorkspace';
import type {AssistantView} from '../../scripts/assistant-ui-state.mjs';
import type {ChatPromptRequest} from './AgentChat';
import {captureFeatureError} from '../../lib/monitoring';
import {chatIsland} from './chat-island';

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
  const island = chatIsland();
  let destroyed = false;
  let requestedPrompt: ChatPromptRequest | undefined;
  let root: ReturnType<typeof createRoot> | undefined;
  const reportUncaught = (error: unknown) => {
    if (destroyed) return;
    captureFeatureError(error, 'chat', 'render');
    onMountError?.(error);
  };
  const onPromptConsumed = (id: string) => {
    if (requestedPrompt?.id !== id || destroyed) return;
    requestedPrompt = undefined;
    render();
  };
  const tree = () => <MountBoundary onError={(error) => { if (!destroyed) onMountError?.(error); }}>
    <AssistantWorkspace onClose={onClose} onReady={onReady} pathname={target.closest<HTMLElement>('[data-blog-chat-widget]')?.dataset.readerPathname} title={target.closest<HTMLElement>('[data-blog-chat-widget]')?.dataset.readerTitle} {...workspaceUI} requestedPrompt={requestedPrompt} onPromptConsumed={onPromptConsumed} />
  </MountBoundary>;
  const render = () => {
    if (island) {
      island.mount(target, tree());
      return;
    }
    root ??= createRoot(target, {
      onUncaughtError: reportUncaught,
      onCaughtError: (error) => { if (!destroyed) captureFeatureError(error, 'chat', 'render'); },
      onRecoverableError: (error) => { if (!destroyed) captureFeatureError(error, 'chat', 'render_recoverable'); },
    });
    root.render(tree());
  };
  try {
    render();
  } catch (error) {
    destroyed = true;
    island?.mount(target, null);
    root?.unmount();
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
      island?.mount(target, null);
      root?.unmount();
    },
  };
}
