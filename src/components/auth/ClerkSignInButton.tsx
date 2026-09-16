import {SignUpButton} from '@clerk/react';
import type {ReactNode} from 'react';
import {panelClerkRedirect} from './clerk-signin';

export default function ClerkSignInButton({children}: {children: ReactNode}) {
  return (
    <SignUpButton mode="modal" {...panelClerkRedirect()}>
      {children}
    </SignUpButton>
  );
}
