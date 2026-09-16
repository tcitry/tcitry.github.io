import {cloneElement, isValidElement, useSyncExternalStore, type ReactElement, type ReactNode} from 'react';

let auth = {userId: 'fixture-a' as string | null, sessionId: 'session-a' as string | null};
const listeners = new Set<() => void>();
export const currentFixtureAuth = () => auth;
function switchSession(userId: string | null, sessionId: string | null) {
  auth = {userId, sessionId};
  listeners.forEach((listener) => listener());
}
export function useAuth() {
  const current = useSyncExternalStore((listener) => {listeners.add(listener); return () => listeners.delete(listener);}, currentFixtureAuth);
  return {
    ...current,
    isLoaded: true,
    isSignedIn: Boolean(current.userId),
    sessionClaims: current.userId ? {aud: 'convex'} : null,
    getToken: async () => current.userId ? 'fixture-session-token' : null,
  };
}
export function useUser() {
  const current = useSyncExternalStore((listener) => {listeners.add(listener); return () => listeners.delete(listener);}, currentFixtureAuth);
  return {
    isLoaded: true,
    isSignedIn: Boolean(current.userId),
    user: current.userId ? {
      id: current.userId,
      fullName: 'Fixture User',
      firstName: 'Fixture',
      lastName: 'User',
      username: 'fixture',
      imageUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><rect width="56" height="56" fill="%23347"/></svg>',
    } : null,
  };
}
export function useSession() {
  const current = useSyncExternalStore((listener) => {listeners.add(listener); return () => listeners.delete(listener);}, currentFixtureAuth);
  return {
    isLoaded: true,
    isSignedIn: Boolean(current.userId),
    session: current.userId ? {id: current.sessionId, reload: async () => {}} : null,
  };
}
export function useClerk() {
  return {
    signOut: async () => switchSession(null, null),
    openSignIn: () => switchSession('fixture-a', 'session-a'),
    openUserProfile: () => {},
  };
}
export function ClerkProvider({children}: {children: ReactNode}) {return children;}
export function ClerkLoaded({children}: {children: ReactNode}) {return children;}
export function ClerkLoading() {return null;}
export function ClerkFailed() {return null;}
export function UNSAFE_PortalProvider({children}: {children?: ReactNode}) {return children;}
Object.assign(window, {__readerAuth: {switchSession}});

export function Show({when, children, fallback = null}: {
  when: string | object | ((has: unknown) => boolean); children?: ReactNode; fallback?: ReactNode;
}) {
  const {userId} = useAuth();
  if (when === 'signed-in') return userId ? children : fallback;
  if (when === 'signed-out') return userId ? fallback : children;
  return fallback;
}

export function SignIn() {return <button type="button" data-clerk-signin onClick={() => switchSession('fixture-a', 'session-a')}>登录 / 注册</button>;}
export function SignInButton({children}: {children?: ReactNode}) {
  const signIn = () => switchSession('fixture-a', 'session-a');
  if (isValidElement(children)) {
    const child = children as ReactElement<{onPress?: (event: unknown) => void}>;
    return cloneElement(child, {
      onPress: (event: unknown) => { child.props.onPress?.(event); signIn(); },
    });
  }
  return <button type="button" onClick={signIn}>{children ?? '登录 / 注册'}</button>;
}
export function UserButton({fallback}: {fallback?: ReactNode} = {}) {
  const {userId} = useAuth();
  if (!userId) return fallback ?? null;
  return <button type="button" className="cl-userButtonTrigger" aria-label="Open user button">账户</button>;
}
