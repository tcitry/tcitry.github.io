import {SignInButton} from '@clerk/react';
import type {ReactNode} from 'react';
import {panelClerkRedirect, rememberClerkReturnUrl} from './clerk-signin';

export default function ClerkSignInButton({children}: {children: ReactNode}) {
  return (
    <span
      onClickCapture={() => rememberClerkReturnUrl(window.location)}
      onPointerDownCapture={() => rememberClerkReturnUrl(window.location)}
    >
      <SignInButton mode="modal" {...panelClerkRedirect()}>
        {children}
      </SignInButton>
    </span>
  );
}
