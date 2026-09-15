import {ClerkFailed, ClerkLoaded, ClerkLoading, SignIn, useClerk, useSession} from '@clerk/react';
import {useEffect, useRef, useState} from 'react';
import BlogClerkProvider, {clerkPublishableKey} from './BlogClerkProvider';
import {clerkSsoCallbackUrl, finishClerkSsoCallback, runClerkSsoCallback} from './clerk-signin';
import {notifyClerkPopupComplete} from './clerk-oauth-popup';

function SsoCallbackBody() {
  const clerk = useClerk();
  const {session} = useSession();
  const [continuation, setContinuation] = useState(() => window.location.hash.startsWith('#/'));
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const finished = useRef(false);
  const callbackUrl = clerkSsoCallbackUrl();
  const activeSessionId = session?.status === 'active' && !session.currentTask ? session.id : null;

  useEffect(() => {
    const onHashChange = () => setContinuation(window.location.hash.startsWith('#/'));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    if (!activeSessionId || finished.current) return;
    setError('');
    const cleanup = notifyClerkPopupComplete(activeSessionId, () => setError('登录已完成，但原页面尚未同步，请重试。'));
    if (cleanup) return cleanup;
    finished.current = true;
    finishClerkSsoCallback();
  }, [activeSessionId, retry]);

  useEffect(() => {
    if (activeSessionId || continuation) return;
    let mounted = true;
    void runClerkSsoCallback(clerk, async to => {
      const next = new URL(to, window.location.href);
      if (next.origin !== window.location.origin || next.pathname !== new URL(callbackUrl).pathname) {
        throw new Error('Unexpected OAuth continuation');
      }
      // Mount the combined prebuilt flow at the SDK-requested step, inside the
      // popup. It handles missing fields, MFA, Protect and session tasks.
      window.history.replaceState(null, '', next.href);
      if (mounted) setContinuation(true);
    }).catch(() => {
      if (mounted) setError('登录未能完成，请关闭此窗口并从原页面重试。');
    });
    return () => { mounted = false; };
  }, [clerk, activeSessionId, continuation, callbackUrl]);

  if (continuation && !activeSessionId) {
    return <SignIn routing="hash" withSignUp oauthFlow="redirect" forceRedirectUrl={callbackUrl} signUpForceRedirectUrl={callbackUrl} />;
  }
  return <div data-clerk-sso-callback>
    <div id="clerk-captcha" />
    <p role="status">{activeSessionId ? '登录完成，正在同步原页面…' : '正在完成登录…'}</p>
    {error && <p role="alert">{error}</p>}
    {error && activeSessionId && <button type="button" onClick={() => setRetry(value => value + 1)}>重试同步</button>}
    <p><a href="/">返回首页</a></p>
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
