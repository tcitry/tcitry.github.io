import {ClerkFailed, ClerkLoaded, ClerkLoading, useClerk} from '@clerk/react';
import {Button, Spinner} from '@heroui/react';

export function AuthLoading({label = '正在加载登录…'}: {label?: string}) {
  return <div className="blog-chat__auth-status" role="status">
    <Spinner size="sm" color="current" />
    <span>{label}</span>
  </div>;
}

export function panelClerkOptions() {
  return {
    forceRedirectUrl: window.location.href,
    signUpForceRedirectUrl: window.location.href,
    getContainer: () => document.getElementById('blog-chat-panel'),
  };
}

function SignInLaunch() {
  const {openSignIn} = useClerk();
  return <div data-clerk-signin>
    <Button onPress={() => openSignIn({withSignUp: true, ...panelClerkOptions()})}>登录 / 注册</Button>
  </div>;
}

export default function SignInPanel({description}: {description: string}) {
  return <div className="blog-chat__auth">
    <p>{description}</p>
    <ClerkLoading><AuthLoading /></ClerkLoading>
    <ClerkFailed><p role="alert">登录服务暂时无法连接，请稍后重试。</p></ClerkFailed>
    <ClerkLoaded><SignInLaunch /></ClerkLoaded>
  </div>;
}
