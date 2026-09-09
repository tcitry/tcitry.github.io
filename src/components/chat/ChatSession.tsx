import {CloseButton, Tooltip} from '@heroui/react';
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
          <Tooltip delay={400}>
            <CloseButton aria-label="关闭博客助手" onPress={onClose} />
            <Tooltip.Content className="blog-chat__tooltip" placement="bottom">关闭博客助手</Tooltip.Content>
          </Tooltip>
        </div>
        <p className="blog-chat__notice" role="status">博客助手需要登录后使用。阅读账户尚未开放。</p>
      </div>
    </Ready>;
  }
  return <BlogClerkProvider>{children}</BlogClerkProvider>;
}

export function ChatSignIn() {
  return <SignInPanel description="登录后可以向博客助手提问。回答仍然只依据已公开的文章。" />;
}
