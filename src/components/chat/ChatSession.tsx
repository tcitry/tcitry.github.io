import {UNSAFE_PortalProvider} from '@clerk/react';
import {useEffect, type ReactNode} from 'react';
import BlogClerkProvider, {clerkPublishableKey} from '../auth/BlogClerkProvider';
import SignInPanel from '../auth/SignInPanel';
import '../../styles/chat.css';

function Ready({onReady, children}: {onReady?: () => void; children: ReactNode}) {
  useEffect(() => { onReady?.(); }, [onReady]);
  return children;
}

export function ChatSession({children, onReady, onClose}: {children: ReactNode; onReady?: () => void; onClose?: () => void}) {
  if (!clerkPublishableKey()) {
    return <Ready onReady={onReady}>
      <div className="blog-chat">
        <div className="blog-chat__header">
          <div className="blog-chat__identity">博客助手</div>
          <button type="button" className="blog-chat-widget__close" aria-label="关闭博客助手" onClick={onClose}>
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7.5 5 5 5-5 5" /></svg>
          </button>
        </div>
        <p className="blog-chat__notice" role="status">博客助手需要登录后使用。账户服务尚未开放。</p>
      </div>
    </Ready>;
  }
  return <BlogClerkProvider>
    <UNSAFE_PortalProvider getContainer={() => {
      const panel = document.getElementById('blog-chat-panel');
      return panel instanceof HTMLDialogElement && panel.matches(':modal') ? panel : null;
    }}>
      {children}
    </UNSAFE_PortalProvider>
  </BlogClerkProvider>;
}

export function ChatSignIn() {
  return <SignInPanel
    title="登录后提问"
    description="登录后可以向博客助手提问。回答仍然只依据已公开的文章。"
    action
  />;
}
