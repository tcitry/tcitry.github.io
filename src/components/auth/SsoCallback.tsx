import {ClerkFailed, ClerkLoaded, ClerkLoading, SignIn} from '@clerk/react';
import BlogClerkProvider, {clerkPublishableKey} from './BlogClerkProvider';

export default function SsoCallback() {
  if (!clerkPublishableKey()) {
    return <p role="alert">Sign-in is unavailable. Please return to the original page and try again later.</p>;
  }
  return <BlogClerkProvider>
    <ClerkLoading><p role="status">Connecting to sign-in…</p></ClerkLoading>
    <ClerkFailed><p role="alert">We couldn't connect to sign-in. Please return to the original page and try again.</p></ClerkFailed>
    <ClerkLoaded>
      <SignIn routing="hash" withSignUp oauthFlow="popup" />
    </ClerkLoaded>
  </BlogClerkProvider>;
}
