import {createRoot} from 'react-dom/client';
import BlogChat from './BlogChat';

export function mountChat(target: HTMLElement, onClose: () => void, onReady: () => void) {
  const root = createRoot(target);
  root.render(<BlogChat onClose={onClose} onReady={onReady} />);
  return {destroy: () => root.unmount()};
}
