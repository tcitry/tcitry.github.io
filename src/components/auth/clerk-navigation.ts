import type {ClerkProviderProps} from '@clerk/react';

type RouterFn = NonNullable<ClerkProviderProps['routerPush']>;

function navigateClerk(to: string, replace: boolean, metadata?: Parameters<RouterFn>[1]) {
  const current = new URL(window.location.href);
  const destination = new URL(to, current);
  const sameDocument = destination.origin === current.origin
    && destination.pathname === current.pathname && destination.search === current.search;
  if (!sameDocument && metadata?.windowNavigate) {
    metadata.windowNavigate(destination);
    return;
  }
  // Clerk's default navigator signals an unload even for a same-document hash
  // navigation. Returning through its public router hook lets setActive finish
  // updating the session when the reader is already at the return URL.
  if (destination.href === current.href) return;
  if (replace) window.location.replace(destination.href);
  else window.location.assign(destination.href);
}

export const clerkRouterPush: RouterFn = (to, metadata) => navigateClerk(to, false, metadata);

export const clerkRouterReplace: RouterFn = (to, metadata) => navigateClerk(to, true, metadata);
