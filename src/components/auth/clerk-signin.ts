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

export function panelClerkRedirect() {
  const currentPage = window.location.href;
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
