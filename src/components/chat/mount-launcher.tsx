import {createRoot} from 'react-dom/client';
import {useSyncExternalStore} from 'react';
import ChatLauncherFace from './ChatLauncherFace';
import {getChatIslandPanel, registerChatIsland, setChatIslandPanel, subscribeChatIsland} from './chat-island';
import {captureFeatureError} from '../../lib/monitoring';

function LauncherIsland({launcher}: {launcher: HTMLElement}) {
  const panel = useSyncExternalStore(subscribeChatIsland, getChatIslandPanel, getChatIslandPanel);
  return <ChatLauncherFace launcher={launcher} panel={panel.node} panelTarget={panel.target} />;
}

export function mountLauncher(target: HTMLElement, launcher: HTMLElement) {
  const unregister = registerChatIsland({
    mount(panelTarget, node) {
      setChatIslandPanel({node, target: node ? panelTarget : null});
    },
  });
  const root = createRoot(target, {
    onUncaughtError: (error) => captureFeatureError(error, 'chat', 'render'),
    onCaughtError: (error) => captureFeatureError(error, 'chat', 'render'),
    onRecoverableError: (error) => captureFeatureError(error, 'chat', 'render_recoverable'),
  });
  root.render(<LauncherIsland launcher={launcher} />);
  return {destroy() { unregister(); root.unmount(); }};
}
