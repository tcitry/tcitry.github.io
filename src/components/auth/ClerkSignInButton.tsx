import {SignInButton} from '@clerk/react';
import type {ReactNode} from 'react';
import {panelClerkRedirect, rememberClerkReturnUrl} from './clerk-signin';

export default function ClerkSignInButton({children}: {children: ReactNode}) {
  return (
    <span onClickCapture={rememberClerkReturnUrl} onPointerDownCapture={rememberClerkReturnUrl}>
      <SignInButton mode="modal" {...panelClerkRedirect()}>
        {children}
      </SignInButton>
    </span>
  );
}
