import {GoogleOneTap, useUser} from '@clerk/react';
import BlogClerkProvider, {clerkPublishableKey} from './BlogClerkProvider';

function SignedOutPrompt() {
  const {isLoaded, isSignedIn} = useUser();
  if (!isLoaded || isSignedIn) return null;

  const currentPage = window.location.href;
  return <GoogleOneTap signInForceRedirectUrl={currentPage} signUpForceRedirectUrl={currentPage} />;
}

// BookLayout mounts this once, outside the shared providers used by other islands.
// Local previews keep their existing test-instance sign-in flow.
export default function GoogleOneTapPrompt() {
  if (import.meta.env.PUBLIC_SITE_ENV !== 'production' || !clerkPublishableKey().startsWith('pk_live_')) return null;
  return <BlogClerkProvider><SignedOutPrompt /></BlogClerkProvider>;
}
