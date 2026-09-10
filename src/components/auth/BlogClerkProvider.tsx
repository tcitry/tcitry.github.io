import {ClerkProvider} from '@clerk/react';
import type {ReactNode} from 'react';

export function clerkPublishableKey() {
  return import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
}

export default function BlogClerkProvider({children}: {children: ReactNode}) {
  const key = clerkPublishableKey();
  if (!key) return children;
  const currentPage = window.location.href;
  return <ClerkProvider publishableKey={key} signInFallbackRedirectUrl={currentPage} signUpFallbackRedirectUrl={currentPage} afterSignOutUrl={currentPage} appearance={{elements: {modalBackdrop: 'blog-clerk-modal'}}}>
    {children}
  </ClerkProvider>;
}
