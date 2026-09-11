type ClerkSignInOpener = {
  openSignIn: (props?: {
    forceRedirectUrl?: string;
    signUpForceRedirectUrl?: string;
    withSignUp?: boolean;
    transferable?: boolean;
  }) => unknown;
};

export function panelClerkRedirect() {
  const currentPage = window.location.href;
  return {
    forceRedirectUrl: currentPage,
    signUpForceRedirectUrl: currentPage,
    // Combined sign-in-or-up: first-time GitHub/Google OAuth must transfer into
    // sign-up (username is required) instead of Account Portal external_account_not_found.
    withSignUp: true,
  };
}

export function openClerkSignIn(clerk: ClerkSignInOpener) {
  clerk.openSignIn({
    ...panelClerkRedirect(),
    transferable: true,
  });
}
