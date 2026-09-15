import {createRoot} from 'react-dom/client';
import type {ReactNode} from 'react';
import BlogClerkProvider from '../../src/components/auth/BlogClerkProvider';
import GoogleOneTapPrompt from '../../src/components/auth/GoogleOneTapPrompt';
import ChatLauncherFace from '../../src/components/chat/ChatLauncherFace';

function CommentsIsland() {
  return <BlogClerkProvider><div data-island="comments">comments</div></BlogClerkProvider>;
}

export function mountOneTap(host: HTMLElement) {
  createRoot(host).render(<GoogleOneTapPrompt />);
}

export function mountComments(host: HTMLElement) {
  createRoot(host).render(<CommentsIsland />);
}

export function mountAssistant(host: HTMLElement, launcher: HTMLElement, panel?: ReactNode, panelTarget?: HTMLElement | null) {
  createRoot(host).render(<ChatLauncherFace launcher={launcher} panel={panel} panelTarget={panelTarget} />);
}
