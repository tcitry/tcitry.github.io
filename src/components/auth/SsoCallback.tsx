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
  const isPopup = Boolean(window.opener && !window.opener.closed);

  useEffect(() => {
    const onHashChange = () => setContinuation(window.location.hash.startsWith('#/'));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    if (!activeSessionId || finished.current) return;
    setError('');
    const cleanup = notifyClerkPopupComplete(activeSessionId, () => setError("You're signed in, but we couldn't update the original page. Please try again."));
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
      if (mounted) setError("We couldn't complete sign-in. Please return to the original page and try again.");
    });
    return () => { mounted = false; };
  }, [clerk, activeSessionId, continuation, callbackUrl]);

  if (continuation && !activeSessionId) {
    return <SignIn routing="hash" withSignUp oauthFlow="redirect" forceRedirectUrl={callbackUrl} signUpForceRedirectUrl={callbackUrl} />;
  }
  return <div data-clerk-sso-callback>
    <div id="clerk-captcha" />
    {!error && <p role="status">{activeSessionId
      ? isPopup ? 'Signed in. This window will close automatically.' : 'Signed in. Returning to your page…'
      : 'Completing sign-in…'}</p>}
    {error && <p role="alert">{error}</p>}
    {error && activeSessionId && <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button>}
  </div>;
}

export default function SsoCallback() {
  if (!clerkPublishableKey()) {
    return <p role="alert">Sign-in is unavailable. Please return to the original page and try again later.</p>;
  }
  return <BlogClerkProvider>
    <ClerkLoading><p role="status">Connecting to sign-in…</p></ClerkLoading>
    <ClerkFailed><p role="alert">We couldn't connect to sign-in. Please return to the original page and try again.</p></ClerkFailed>
    <ClerkLoaded>
      <SsoCallbackBody />
    </ClerkLoaded>
  </BlogClerkProvider>;
}
