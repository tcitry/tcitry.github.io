import {ClerkFailed, ClerkLoaded, ClerkLoading, SignIn} from '@clerk/react';

export default function SignInPanel({description}: {description: string}) {
  return <div className="blog-chat__auth">
    <p>{description}</p>
    <ClerkLoading><p role="status">正在加载登录…</p></ClerkLoading>
    <ClerkFailed><p role="alert">登录服务暂时无法连接，请稍后重试。</p></ClerkFailed>
    <ClerkLoaded>
      <div className="reader-inline-signin" data-clerk-signin>
        <SignIn routing="hash" withSignUp forceRedirectUrl={window.location.href} signUpForceRedirectUrl={window.location.href} />
      </div>
    </ClerkLoaded>
  </div>;
}
