import {useEffect, useState} from 'react';
import {ClerkFailed, ClerkLoaded, ClerkLoading, SignIn, useSession} from '@clerk/react';
import BlogClerkProvider, {clerkPublishableKey} from './BlogClerkProvider';
import {authWindowChannel, authWindowState, authWindowUrl, clearAuthWindowState} from './clerk-auth-window';

function AuthContent() {
  const {session} = useSession();
  const [state] = useState(authWindowState);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const complete = session?.status === 'active' && !session.currentTask;

  useEffect(() => {
    if (!complete || !session || !state) return;
    let channel: BroadcastChannel;
    try {channel = authWindowChannel(state);} catch {setConnectionError(true); return;}
    const notify = () => channel.postMessage({type: 'complete', sessionId: session.id});
    const retry = setInterval(notify, 700);
    const timeout = setTimeout(() => {clearInterval(retry); setConnectionError(true);}, 30_000);
    channel.onmessage = ({data}) => {
      if (data?.type !== 'ack') return;
      clearInterval(retry);
      clearTimeout(timeout);
      setConnectionError(false);
      setSeconds(current => current ?? 3);
    };
    notify();
    return () => {clearInterval(retry); clearTimeout(timeout); channel.close();};
  }, [complete, session?.id, state]);

  useEffect(() => {
    if (seconds === null) return;
    if (seconds === 0) {clearAuthWindowState(); window.close(); return;}
    const timer = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  if (complete && state) return <div role="status">
    <p>You're signed in.</p>
    <p>{seconds === null
      ? connectionError ? 'Please return to the original tab and refresh it to finish connecting.' : 'Connecting to your original tab…'
      : seconds > 0 ? `This window will close in ${seconds} seconds.` : 'You can close this window.'}</p>
  </div>;
  const redirect = state ? authWindowUrl(state) : undefined;
  return <SignIn routing="hash" withSignUp oauthFlow="redirect"
    {...(redirect ? {forceRedirectUrl: redirect, signUpForceRedirectUrl: redirect} : {})} />;
}

export default function SsoCallback() {
  if (!clerkPublishableKey()) {
    return <p role="alert">Sign-in is unavailable. Please return to the original page and try again later.</p>;
  }
  return <BlogClerkProvider>
    <ClerkLoading><p role="status">Connecting to sign-in…</p></ClerkLoading>
    <ClerkFailed><p role="alert">We couldn't connect to sign-in. Please return to the original page and try again.</p></ClerkFailed>
    <ClerkLoaded>
      <AuthContent />
    </ClerkLoaded>
  </BlogClerkProvider>;
}
