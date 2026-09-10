import {useEffect, useRef, useState} from 'react';
import {ConvexReactClient} from 'convex/react';

// The caller keys its component by Clerk account/session, so a new session
// receives a fresh client and query cache during render, before effects run.
export default function useSessionConvexClient(url: string) {
  const [client] = useState(() => new ConvexReactClient(url));
  const lifecycle = useRef({generation: 0, mounted: false});
  useEffect(() => {
    const generation = ++lifecycle.current.generation;
    lifecycle.current.mounted = true;
    return () => {
      lifecycle.current.mounted = false;
      // ConvexProviderWithClerk clears auth in a child effect cleanup. Let the
      // full React cleanup pass finish before permanently closing this client.
      queueMicrotask(() => {
        // StrictMode replays cleanup/setup on the same client. A newer setup
        // invalidates this disposal; a real unmount has no replacement setup.
        if (!lifecycle.current.mounted && lifecycle.current.generation === generation) void client.close();
      });
    };
  }, [client]);
  return client;
}
