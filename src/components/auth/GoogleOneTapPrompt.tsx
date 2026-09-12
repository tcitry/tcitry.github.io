import {GoogleOneTap, useClerk, useUser} from '@clerk/react';
import BlogClerkProvider, {clerkPublishableKey} from './BlogClerkProvider';
import {googleOneTapRedirect, installGoogleOneTapSignInOrUp, rememberClerkReturnUrl} from './clerk-signin';

function SignedOutPrompt() {
  const clerk = useClerk();
  const {isLoaded, isSignedIn} = useUser();
  if (isLoaded) installGoogleOneTapSignInOrUp(clerk);
  if (!isLoaded || isSignedIn) return null;

  // isLoaded is true, so a signed-in Account Portal return will restore first
  // instead of overwriting the stored URL with `/`.
  rememberClerkReturnUrl();
  return <GoogleOneTap {...googleOneTapRedirect()} />;
}

// BookLayout mounts this once, outside the shared providers used by other islands.
// Local previews keep their existing test-instance sign-in flow.
export default function GoogleOneTapPrompt() {
  if (import.meta.env.PUBLIC_SITE_ENV !== 'production' || !clerkPublishableKey().startsWith('pk_live_')) return null;
  return <BlogClerkProvider><SignedOutPrompt /></BlogClerkProvider>;
}
