import type {BrowserClerk, ClerkProp} from '@clerk/react';
import type {LoadedClerk} from '@clerk/shared/types';

declare const weakClerk: {load?: unknown} | undefined;
declare const uiClerk: BrowserClerk;

// Workers Builds failed here after #186: `{ load?: unknown }` is not ClerkProp.
// @ts-expect-error incomplete window.Clerk is not assignable to ClerkProvider's Clerk prop
export const rejectedWeakClerk: ClerkProp = weakClerk;

// Runtime reuse also requires UI (`onComponentsReady` + `components`), not just .load.
export const acceptedUiClerk: ClerkProp = uiClerk;

type PendingOAuthTransfer = typeof import('./clerk-signin').completePendingOAuthTransfer;
export const loadedClerkCompletesPendingOAuthTransfer: PendingOAuthTransfer extends (clerk: LoadedClerk) => unknown
  ? true
  : false = true;
