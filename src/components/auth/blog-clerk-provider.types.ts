import type {ClerkProp} from '@clerk/react';

declare const weakClerk: {load?: unknown} | undefined;

// Workers Builds failed here after #186: `{ load?: unknown }` is not ClerkProp.
// @ts-expect-error incomplete window.Clerk is not assignable to ClerkProvider's Clerk prop
export const rejectedWeakClerk: ClerkProp = weakClerk;
