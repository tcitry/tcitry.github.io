import {useSyncExternalStore, type ReactNode} from 'react';

let auth = {userId: 'fixture-a' as string | null, sessionId: 'session-a' as string | null};
const listeners = new Set<() => void>();
export const currentFixtureAuth = () => auth;
function switchSession(userId: string | null, sessionId: string | null) {
  auth = {userId, sessionId};
  listeners.forEach((listener) => listener());
}
export function useAuth() {
  return useSyncExternalStore((listener) => {listeners.add(listener); return () => listeners.delete(listener);}, currentFixtureAuth);
}
export function useClerk() {
  return {signOut: async () => switchSession(null, null), openSignIn: () => switchSession('fixture-a', 'session-a')};
}
export function ClerkProvider({children}: {children: ReactNode}) {return children;}
export function ClerkLoaded({children}: {children: ReactNode}) {return children;}
export function ClerkLoading() {return null;}
export function ClerkFailed() {return null;}
Object.assign(window, {__readerAuth: {switchSession}});

export function SignIn() {return <button onClick={() => switchSession('fixture-a', 'session-a')}>完成登录</button>;}
