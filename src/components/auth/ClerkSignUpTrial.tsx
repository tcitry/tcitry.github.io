import {ClerkFailed, ClerkLoading, SignInButton, SignOutButton, SignUpButton, useAuth} from '@clerk/react';
import BlogClerkProvider, {clerkPublishableKey} from './BlogClerkProvider';
import {panelClerkRedirect} from './clerk-signin';

export const clerkSignUpTrialPath = '/sign-up/';

function TrialActions() {
  const {isLoaded, isSignedIn} = useAuth();
  const returnUrl = window.location.href;

  if (!isLoaded) return <>
    <ClerkLoading><p role="status">Loading account access…</p></ClerkLoading>
    <ClerkFailed><p role="alert">We couldn't connect to account access. Please reload and try again.</p></ClerkFailed>
  </>;

  if (isSignedIn) return <>
    <p role="status">You're signed in.</p>
    <SignOutButton redirectUrl={returnUrl}><button type="button">Sign out</button></SignOutButton>
  </>;

  return <div className="auth-trial-actions">
    <SignUpButton mode="modal" oauthFlow="popup" forceRedirectUrl={returnUrl} signInForceRedirectUrl={returnUrl}>
      <button type="button">Sign up — new account</button>
    </SignUpButton>
    <SignInButton mode="modal" {...panelClerkRedirect()}>
      <button type="button">Sign in — existing account</button>
    </SignInButton>
  </div>;
}

export default function ClerkSignUpTrial() {
  if (!clerkPublishableKey()) return <p role="alert">Account access is unavailable.</p>;
  return <BlogClerkProvider signUpUrl={clerkSignUpTrialPath}><TrialActions /></BlogClerkProvider>;
}
