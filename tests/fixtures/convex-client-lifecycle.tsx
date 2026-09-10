// Local lifecycle fixture: real React, Convex client and Clerk adapter. The
// transport stays entirely in this page; no service or account is contacted.
import {StrictMode, act, useEffect} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {ConvexReactClient} from 'convex/react';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import {makeFunctionReference} from 'convex/server';
import useSessionConvexClient from '../../src/components/auth/useSessionConvexClient';

class OfflineWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: {code: number; reason: string}) => void) | null = null;
  onmessage = null; onerror = null;
  constructor(_url: string) {queueMicrotask(() => {if (this.readyState === 0) {this.readyState = 1; this.onopen?.();}});}
  send(_data: unknown) {}
  close() {this.readyState = 3; queueMicrotask(() => this.onclose?.({code: 1000, reason: 'Local fixture shutdown'}));}
}
window.WebSocket = OfflineWebSocket as unknown as typeof WebSocket;
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});
const events: {client: number; type: string}[] = [];
const clients: ConvexReactClient[] = [];
const idOf = (client: ConvexReactClient) => {
  let index = clients.indexOf(client);
  if (index < 0) {index = clients.length; clients.push(client);}
  return index;
};
const originalClose = ConvexReactClient.prototype.close;
const originalClearAuth = ConvexReactClient.prototype.clearAuth;
const originalSetAuth = ConvexReactClient.prototype.setAuth;
ConvexReactClient.prototype.close = function () {events.push({client: idOf(this), type: 'close'}); return originalClose.call(this);};
ConvexReactClient.prototype.clearAuth = function () {events.push({client: idOf(this), type: 'clearAuth'}); return originalClearAuth.call(this);};
ConvexReactClient.prototype.setAuth = function (...args) {events.push({client: idOf(this), type: 'setAuth'}); return originalSetAuth.apply(this, args);};

const query = makeFunctionReference<'query', Record<string, never>, string>('fixture:privateCache');
const mutation = makeFunctionReference<'mutation', Record<string, never>, null>('fixture:optimisticOnly');
let currentClient: ConvexReactClient;
let root: Root | undefined;
const useFixtureAuth = () => ({isLoaded: true, isSignedIn: true, getToken: async () => null, orgId: null, orgRole: null, sessionId: 'local-session', sessionClaims: {aud: 'convex'}});
function QuerySubscription({client}: {client: ConvexReactClient}) {
  useEffect(() => {
    const unsubscribe = client.watchQuery(query, {}).onUpdate(() => {});
    events.push({client: idOf(client), type: 'subscribe'});
    return () => {events.push({client: idOf(client), type: 'unsubscribe'}); unsubscribe();};
  }, [client]);
  return null;
}
function Session() {
  const client = useSessionConvexClient('https://lifecycle-fixture.convex.cloud');
  currentClient = client; idOf(client);
  return <ConvexProviderWithClerk client={client} useAuth={useFixtureAuth}><QuerySubscription client={client} /></ConvexProviderWithClerk>;
}
function snapshot() {
  return {events: [...events], clients: clients.length, current: currentClient ? idOf(currentClient) : null, cached: currentClient?.watchQuery(query, {}).localQueryResult() ?? null};
}
Object.assign(window, {lifecycleFixture: {
  async render(session: string, strict: boolean) {
    root ??= createRoot(document.getElementById('root')!);
    const content = <Session key={session} />;
    await act(async () => root!.render(strict ? <StrictMode>{content}</StrictMode> : content));
    return snapshot();
  },
  async unmount() {await act(async () => root?.unmount()); root = undefined; return snapshot();},
  seed(value: string) {
    // The optimistic query result is stored in the actual Convex cache. The
    // fake socket's send is a no-op, so this can never write external data.
    void currentClient.mutation(mutation, {}, {optimisticUpdate: local => local.setQuery(query, {}, value)});
    return snapshot();
  },
  snapshot,
}});
