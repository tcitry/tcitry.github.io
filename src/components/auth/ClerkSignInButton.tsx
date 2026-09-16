import {useClerk} from '@clerk/react';
import {cloneElement, useState, type ReactElement} from 'react';
import {openClerkSignIn} from './clerk-signin';

export default function ClerkSignInButton({children}: {children: ReactElement<{onPress?: () => void}>}) {
  const clerk = useClerk();
  const [error, setError] = useState('');
  return <>
    {cloneElement(children, {onPress: () => {
      setError('');
      openClerkSignIn(clerk, setError);
    }})}
    {error && <span role="alert">{error}</span>}
  </>;
}
