import {createContext, useContext, useEffect, type ReactNode} from 'react';
import {ClerkProvider, useAuth, useClerk} from '@clerk/react';
import type {BrowserClerk, ClerkProp} from '@clerk/react';
import {clerkForceRedirectUrl, completePendingOAuthTransfer, restoreClerkReturnUrl} from './clerk-signin';

const BlogClerkTreeContext = createContext(false);

export function clerkPublishableKey() {
  return import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
}

function ClerkAuthEffects() {
  const {isLoaded, isSignedIn} = useAuth();
  const clerk = useClerk();
  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      restoreClerkReturnUrl();
      return;
    }
    // Popup keeps transfer on-site. If a leftover transferable sign-in
    // remains (popup / edge cases), complete first-time signup here.
    void completePendingOAuthTransfer(clerk).catch(() => undefined);
  }, [isLoaded, isSignedIn, clerk]);
  return null;
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
  const signInRedirect = clerkForceRedirectUrl();
  const loadedClerk = loadedClerkInstance();
  return <ClerkProvider publishableKey={key} {...(loadedClerk ? {Clerk: loadedClerk} : {})} signInFallbackRedirectUrl={signInRedirect} signUpFallbackRedirectUrl={signInRedirect} afterSignOutUrl={currentPage} appearance={{elements: {modalBackdrop: 'blog-clerk-modal'}}}>
    <BlogClerkTreeContext.Provider value={true}>
      <ClerkAuthEffects />
      {children}
    </BlogClerkTreeContext.Provider>
  </ClerkProvider>;
}
