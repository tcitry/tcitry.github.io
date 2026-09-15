import type {BrowserClerk, ClerkProp} from '@clerk/react';
import type {LoadedClerk} from '@clerk/shared/types';

declare const weakClerk: {load?: unknown} | undefined;
declare const uiClerk: BrowserClerk;

// Workers Builds failed here after #186: `{ load?: unknown }` is not ClerkProp.
// @ts-expect-error incomplete window.Clerk is not assignable to ClerkProvider's Clerk prop
export const rejectedWeakClerk: ClerkProp = weakClerk;

// Runtime reuse also requires UI (`onComponentsReady` + `components`), not just .load.
export const acceptedUiClerk: ClerkProp = uiClerk;

type SsoCallback = typeof import('./clerk-signin').runClerkSsoCallback;
export const loadedClerkHandlesSsoCallback: SsoCallback extends (clerk: LoadedClerk, navigate: (to: string) => Promise<unknown>) => unknown
  ? true
  : false = true;

type AuthSessionWatch = typeof import('./clerk-signin').watchClerkAuthSession;
export const loadedClerkWatchesAuthSession: AuthSessionWatch extends (clerk: LoadedClerk, isSignedIn: boolean) => unknown
  ? true
  : false = true;
