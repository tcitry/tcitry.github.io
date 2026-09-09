import {ClerkProvider} from '@clerk/react';
import type {ReactNode} from 'react';

export function clerkPublishableKey() {
  return import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
}

export default function BlogClerkProvider({children}: {children: ReactNode}) {
  const key = clerkPublishableKey();
  if (!key) return children;
  return <ClerkProvider publishableKey={key} signInFallbackRedirectUrl="/me/" signUpFallbackRedirectUrl="/me/" afterSignOutUrl={window.location.href}>
    {children}
  </ClerkProvider>;
}
