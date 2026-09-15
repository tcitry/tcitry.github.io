import {AuthenticateWithRedirectCallback, ClerkFailed, ClerkLoaded, ClerkLoading, useAuth} from '@clerk/react';
import {useEffect} from 'react';
import BlogClerkProvider, {clerkPublishableKey} from './BlogClerkProvider';
import {ensureClerkCaptchaElement, finishClerkSsoCallback, ssoCallbackHandlerProps} from './clerk-signin';

function SsoCallbackBody() {
  const {isSignedIn} = useAuth();
  useEffect(() => {
    ensureClerkCaptchaElement();
  }, []);
  useEffect(() => {
    if (isSignedIn) finishClerkSsoCallback();
  }, [isSignedIn]);
  return <div data-clerk-sso-callback>
    <p role="status">{isSignedIn ? '登录完成，正在返回原页…' : '正在完成登录…'}</p>
    <p><a href="/">返回首页</a></p>
    {isSignedIn ? null : <AuthenticateWithRedirectCallback {...ssoCallbackHandlerProps()} />}
  </div>;
}

export default function SsoCallback() {
  if (!clerkPublishableKey()) {
    return <p role="alert">登录服务未配置。<a href="/">返回首页</a></p>;
  }
  return <BlogClerkProvider>
    <ClerkLoading><p role="status">正在连接登录服务…</p></ClerkLoading>
    <ClerkFailed><p role="alert">登录服务暂时无法连接，请稍后重试。<a href="/">返回首页</a></p></ClerkFailed>
    <ClerkLoaded>
      <SsoCallbackBody />
    </ClerkLoaded>
  </BlogClerkProvider>;
}
