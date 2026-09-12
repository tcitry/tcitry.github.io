import {createContext, useContext, useEffect, type ReactNode} from 'react';
import {ClerkProvider, useAuth} from '@clerk/react';
import type {ClerkProp, HeadlessBrowserClerk} from '@clerk/react';
import {restoreClerkReturnUrl} from './clerk-signin';

const BlogClerkTreeContext = createContext(false);

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

function isLoadedClerk(value: unknown): value is HeadlessBrowserClerk {
  return Boolean(value) && typeof (value as HeadlessBrowserClerk).load === 'function';
}

function loadedClerkInstance(): ClerkProp {
  const clerk = (window as Window & {Clerk?: unknown}).Clerk;
  return isLoadedClerk(clerk) ? clerk : undefined;
}

export default function BlogClerkProvider({children}: {children: ReactNode}) {
  const key = clerkPublishableKey();
  const nested = useContext(BlogClerkTreeContext);
  if (!key || nested) return children;
  const currentPage = window.location.href;
  const loadedClerk = loadedClerkInstance();
  return <ClerkProvider publishableKey={key} {...(loadedClerk ? {Clerk: loadedClerk} : {})} signInFallbackRedirectUrl={currentPage} signUpFallbackRedirectUrl={currentPage} afterSignOutUrl={currentPage} appearance={{elements: {modalBackdrop: 'blog-clerk-modal'}}}>
    <BlogClerkTreeContext.Provider value={true}>
      <ClerkReturnUrlRestorer />
      {children}
    </BlogClerkTreeContext.Provider>
  </ClerkProvider>;
}
