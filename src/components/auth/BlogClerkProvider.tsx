import {createContext, useContext, type ReactNode} from 'react';
import {ClerkProvider} from '@clerk/react';
import type {BrowserClerk, ClerkProp} from '@clerk/react';
import {clerkAfterAuthFallbackUrl} from './clerk-signin';

const BlogClerkTreeContext = createContext(false);

export function clerkPublishableKey() {
  return import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
}

// @clerk/react skips the UI chunk when ClerkProvider gets a Clerk prop.
// window.Clerk often exists as a {load} stub before UI attaches, so .load is
// not enough — passing that instance makes Google One Tap / SignIn throw
// "Clerk was not loaded with Ui components".
function isUiClerk(value: unknown): value is BrowserClerk {
  if (!value || typeof value !== 'object') return false;
  const clerk = value as BrowserClerk;
  return typeof clerk.load === 'function'
    && clerk.onComponentsReady != null
    && clerk.components != null;
}

function loadedClerkInstance(): ClerkProp {
  const clerk = (window as Window & {Clerk?: unknown}).Clerk;
  return isUiClerk(clerk) ? clerk : undefined;
}

export default function BlogClerkProvider({children}: {children: ReactNode}) {
  const key = clerkPublishableKey();
  const nested = useContext(BlogClerkTreeContext);
  if (!key || nested) return children;
  const currentPage = window.location.href;
  const signInRedirect = clerkAfterAuthFallbackUrl();
  const loadedClerk = loadedClerkInstance();
  return <ClerkProvider publishableKey={key} {...(loadedClerk ? {Clerk: loadedClerk} : {})} signInFallbackRedirectUrl={signInRedirect} signUpFallbackRedirectUrl={signInRedirect} afterSignOutUrl={currentPage} appearance={{elements: {modalBackdrop: 'blog-clerk-modal'}}}>
    <BlogClerkTreeContext.Provider value={true}>
      {children}
    </BlogClerkTreeContext.Provider>
  </ClerkProvider>;
}
