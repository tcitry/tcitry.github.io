import {ClerkProvider, useAuth} from '@clerk/react';
import {useEffect, type ReactNode} from 'react';
import {restoreClerkReturnUrl} from './clerk-signin';

export function clerkPublishableKey() {
  return import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
}

function ClerkReturnUrlRestorer() {
  const {isLoaded, isSignedIn} = useAuth();
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    restoreClerkReturnUrl();
  }, [isLoaded, isSignedIn]);
  return null;
}

export default function BlogClerkProvider({children}: {children: ReactNode}) {
  const key = clerkPublishableKey();
  if (!key) return children;
  const currentPage = window.location.href;
  return <ClerkProvider publishableKey={key} signInFallbackRedirectUrl={currentPage} signUpFallbackRedirectUrl={currentPage} afterSignOutUrl={currentPage} appearance={{elements: {modalBackdrop: 'blog-clerk-modal'}}}>
    <ClerkReturnUrlRestorer />
    {children}
  </ClerkProvider>;
}
