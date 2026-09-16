type ClerkSignInProps = {
  forceRedirectUrl?: string;
  signUpForceRedirectUrl?: string;
  withSignUp?: boolean;
  transferable?: boolean;
  oauthFlow?: 'auto' | 'redirect' | 'popup';
};

type ClerkSignInOpener = {
  openSignIn: (props?: ClerkSignInProps) => unknown;
};

// The existing route hosts Clerk's complete sign-in-or-up tree. Its hash routes
// own OAuth callbacks, profile completion, verification and session tasks.
export const clerkSignInPath = '/sso-callback/';

export function clerkAfterAuthFallbackUrl(location: Pick<Location, 'href'> = window.location) {
  const url = new URL(location.href);
  // Visiting the auth page directly must not redirect a signed-in user to itself.
  return url.pathname.replace(/\/$/, '') === clerkSignInPath.replace(/\/$/, '') ? '/' : url.href;
}

export function panelClerkRedirect() {
  const currentPage = clerkAfterAuthFallbackUrl();
  return {
    forceRedirectUrl: currentPage,
    signUpForceRedirectUrl: currentPage,
    withSignUp: true,
    // Clerk owns the popup, callback messages, session activation and navigation.
    oauthFlow: 'popup' as const,
  };
}

export function openClerkSignIn(clerk: ClerkSignInOpener) {
  clerk.openSignIn({...panelClerkRedirect(), transferable: true});
}

export function googleOneTapRedirect() {
  const currentPage = window.location.href;
  return {
    signInForceRedirectUrl: currentPage,
    signUpForceRedirectUrl: currentPage,
  };
}
