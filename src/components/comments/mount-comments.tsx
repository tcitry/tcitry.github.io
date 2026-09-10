import {Component, useEffect, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import CommentsRoot from './CommentsRoot';

class MountBoundary extends Component<{children: ReactNode; onError: () => void}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

function Ready({onReady}: {onReady: () => void}) {
  useEffect(onReady, [onReady]);
  return null;
}

export function mountComments(host: HTMLElement, pathname: string, onReady: () => void, onError: () => void, title?: string, bookmarkable = false) {
  const root = createRoot(host);
  root.render(<MountBoundary onError={onError}>
    <CommentsRoot pathname={pathname} title={title} bookmarkable={bookmarkable} />
    <Ready onReady={onReady} />
  </MountBoundary>);
  return {destroy() { root.unmount(); }};
}
