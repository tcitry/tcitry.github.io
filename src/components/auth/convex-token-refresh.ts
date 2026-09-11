import {createContext, useContext} from 'react';

// ConvexProviderWithClerk only rebuilds its token fetcher when org/session IDs
// change. After Clerk user.username is written, bump this so Convex refetches
// the session JWT (preferred_username / nickname) without remounting the client.
export const ConvexTokenEpochContext = createContext(0);
export const ConvexTokenRefreshContext = createContext<(() => void) | null>(null);

export function useRefreshConvexToken() {
  return useContext(ConvexTokenRefreshContext);
}
