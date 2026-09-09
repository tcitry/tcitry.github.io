import {ClerkFailed, ClerkLoaded, ClerkLoading, SignInButton} from '@clerk/react';
import {Button, Spinner} from '@heroui/react';
import {EmptyState} from '@heroui-pro/react/empty-state';
import type {ReactNode} from 'react';

export function AuthLoading({label = '正在加载登录…'}: {label?: string}) {
  return <div className="blog-chat__auth-status" role="status">
    <Spinner size="sm" color="current" />
    <span>{label}</span>
  </div>;
}

export function panelClerkRedirect() {
  return {
    forceRedirectUrl: window.location.href,
    signUpForceRedirectUrl: window.location.href,
  };
}

export function WorkspaceEmpty({title, description, children}: {
  title: string; description: string; children?: ReactNode;
}) {
  return <div className="assistant-workspace__empty" role="status">
    <EmptyState size="sm">
      <EmptyState.Header>
        <EmptyState.Title>{title}</EmptyState.Title>
        <EmptyState.Description className="max-w-xs text-pretty">{description}</EmptyState.Description>
      </EmptyState.Header>
      {children}
    </EmptyState>
  </div>;
}

export default function SignInPanel({title, description, action = false}: {
  title: string; description: string; action?: boolean;
}) {
  return <WorkspaceEmpty title={title} description={description}>
    {action ? <>
      <ClerkLoading><AuthLoading /></ClerkLoading>
      <ClerkFailed><p role="alert">登录服务暂时无法连接，请稍后重试。</p></ClerkFailed>
      <ClerkLoaded>
        <EmptyState.Content>
          <div data-clerk-signin>
            <SignInButton mode="modal" withSignUp {...panelClerkRedirect()}>
              <Button>登录 / 注册</Button>
            </SignInButton>
          </div>
        </EmptyState.Content>
      </ClerkLoaded>
    </> : <ClerkFailed><p role="alert">登录服务暂时无法连接，请稍后重试。</p></ClerkFailed>}
  </WorkspaceEmpty>;
}
