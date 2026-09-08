import type {ReactNode} from 'react';
import {FixtureClientContext, type ConvexReactClient} from './reader-convex';

export function ConvexProviderWithClerk({client, children}: {client: ConvexReactClient; children: ReactNode}) {
  return <FixtureClientContext.Provider value={client}>{children}</FixtureClientContext.Provider>;
}
