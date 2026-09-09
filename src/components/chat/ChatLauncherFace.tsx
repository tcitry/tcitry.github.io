import {useEffect} from 'react';
import {useUser} from '@clerk/react';
import BlogClerkProvider from '../auth/BlogClerkProvider';

function initials(user: {firstName?: string | null; lastName?: string | null; fullName?: string | null; username?: string | null}) {
  const fromName = [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join('');
  if (fromName) return fromName;
  return (user.fullName || user.username || '?').slice(0, 1);
}

function Face({launcher}: {launcher: HTMLElement}) {
  const {isLoaded, user} = useUser();
  const signedIn = Boolean(isLoaded && user);
  useEffect(() => {
    launcher.toggleAttribute('data-signed-in', signedIn);
  }, [launcher, signedIn]);
  if (!signedIn || !user) return null;
  if (user.imageUrl) {
    return <img src={user.imageUrl} alt="" width="56" height="56" decoding="async" data-sentry-mask />;
  }
  return <span aria-hidden="true">{initials(user)}</span>;
}

export default function ChatLauncherFace({launcher}: {launcher: HTMLElement}) {
  return <BlogClerkProvider>
    <Face launcher={launcher} />
  </BlogClerkProvider>;
}
