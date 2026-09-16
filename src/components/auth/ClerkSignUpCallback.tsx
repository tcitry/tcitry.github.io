import {ClerkFailed, ClerkLoaded, ClerkLoading, SignUp} from '@clerk/react';
import BlogClerkProvider, {clerkPublishableKey} from './BlogClerkProvider';
import {clerkSignUpTrialPath} from './ClerkSignUpTrial';

export default function ClerkSignUpCallback() {
  if (!clerkPublishableKey()) return <p role="alert">Sign-up is unavailable. Please return to the original page and try again later.</p>;
  return <BlogClerkProvider signUpUrl={clerkSignUpTrialPath}>
    <ClerkLoading><p role="status">Connecting to sign-up…</p></ClerkLoading>
    <ClerkFailed><p role="alert">We couldn't connect to sign-up. Please return to the original page and try again.</p></ClerkFailed>
    <ClerkLoaded><SignUp routing="hash" oauthFlow="popup" /></ClerkLoaded>
  </BlogClerkProvider>;
}
