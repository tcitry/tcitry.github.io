import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import type {ReactNode} from 'react';
import BlogClerkProvider from '../../src/components/auth/BlogClerkProvider';
import GoogleOneTapPrompt from '../../src/components/auth/GoogleOneTapPrompt';
import ChatLauncherFace from '../../src/components/chat/ChatLauncherFace';

function CommentsIsland() {
  return <BlogClerkProvider><div data-island="comments">comments</div></BlogClerkProvider>;
}

function mount(host: HTMLElement, node: ReactNode) {
  flushSync(() => {
    createRoot(host).render(node);
  });
}

export function mountOneTap(host: HTMLElement) {
  mount(host, <GoogleOneTapPrompt />);
}

export function mountComments(host: HTMLElement) {
  mount(host, <CommentsIsland />);
}

export function mountAssistant(host: HTMLElement, launcher: HTMLElement, panel?: ReactNode, panelTarget?: HTMLElement | null) {
  mount(host, <ChatLauncherFace launcher={launcher} panel={panel} panelTarget={panelTarget} />);
}
