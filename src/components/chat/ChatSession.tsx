import {ClerkProvider} from '@clerk/react';
import {Button} from '@heroui/react';
import {useEffect, type ReactNode} from 'react';
import SignInPanel from '../auth/SignInPanel';

function Ready({onReady, children}: {onReady?: () => void; children: ReactNode}) {
  useEffect(() => { onReady?.(); }, [onReady]);
  return children;
}

export function ChatSession({children, onReady, onClose}: {children: ReactNode; onReady?: () => void; onClose?: () => void}) {
  const clerkKey = import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  if (!clerkKey) {
    return <Ready onReady={onReady}>
      <div className="blog-chat">
        <div className="blog-chat__header">
          <div className="blog-chat__identity">博客助手</div>
          <Button size="sm" variant="ghost" onPress={onClose} aria-label="关闭博客助手">关闭</Button>
        </div>
        <p className="blog-chat__notice" role="status">博客助手需要登录后使用。阅读账户尚未开放。</p>
      </div>
    </Ready>;
  }
  return <ClerkProvider publishableKey={clerkKey} signInFallbackRedirectUrl="/me/" signUpFallbackRedirectUrl="/me/" afterSignOutUrl={window.location.href}>
    {children}
  </ClerkProvider>;
}

export function ChatSignIn() {
  return <SignInPanel description="登录后可以向博客助手提问。回答仍然只依据已公开的文章。" />;
}
