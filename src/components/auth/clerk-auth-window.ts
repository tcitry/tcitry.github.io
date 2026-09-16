import type {LoadedClerk} from '@clerk/shared/types';

// This module owns the window, never OAuth attempts or account creation.
const route = '/sso-callback/';
const stateKey = 'blog-auth-window';
const lifetime = 15 * 60 * 1000;
type AuthWindowState = {nonce: string; expires: number};
type WindowClerk = Pick<LoadedClerk, 'client' | 'setActive'>;
let pending: {popup: Window; dispose: () => void} | undefined;

function validNonce(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
}

export function authWindowState(): AuthWindowState | undefined {
  const current = new URL(window.location.href);
  if (current.pathname.replace(/\/$/, '') !== route.replace(/\/$/, '')) return;
  const nonce = current.searchParams.get('auth_window');
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(stateKey) ?? 'null') as AuthWindowState | null;
    if (validNonce(nonce) && saved?.nonce !== nonce) {
      const state = {nonce, expires: Date.now() + lifetime};
      window.sessionStorage.setItem(stateKey, JSON.stringify(state));
      return state;
    }
    if (saved && validNonce(saved.nonce) && saved.expires > Date.now()) return saved;
  } catch {
    // The explicit state in the completion URL also works when storage is blocked.
    if (validNonce(nonce)) return {nonce, expires: Date.now() + lifetime};
  }
}

export function authWindowUrl(state: AuthWindowState) {
  const url = new URL(route, window.location.origin);
  url.searchParams.set('auth_window', state.nonce);
  return url.href;
}

export function authWindowChannel(state: AuthWindowState) {
  // BroadcastChannel is origin-scoped and survives a provider severing opener.
  return new BroadcastChannel(`blog-auth:${state.nonce}`);
}

export function openClerkAuthWindow(clerk: WindowClerk, onError: (message: string) => void) {
  if (pending && !pending.popup.closed) {pending.popup.focus(); return;}
  pending?.dispose();
  const state = {nonce: crypto.randomUUID(), expires: Date.now() + lifetime};
  let channel: BroadcastChannel;
  try {channel = authWindowChannel(state);}
  catch {onError('Your browser could not connect the sign-in window. Please try again.'); return;}
  // Keep window.open in the original button press, before any asynchronous work.
  let popup: Window | null;
  try {popup = window.open(authWindowUrl(state), '_blank', 'popup=yes,width=520,height=760');}
  catch {popup = null;}
  if (!popup) {
    channel.close();
    onError('Please allow popups for this site, then try signing in again.');
    return;
  }
  let disposed = false;
  let activating = false;
  let confirmed: string | undefined;
  let ackTimer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => {
    disposed = true;
    channel.close();
    clearTimeout(expiryTimer);
    clearTimeout(ackTimer);
    window.removeEventListener('pagehide', dispose);
    if (pending?.popup === popup) pending = undefined;
  };
  const expiryTimer = setTimeout(() => {
    dispose();
    onError('The sign-in window expired. Please close it and try again.');
  }, lifetime);
  pending = {popup, dispose};
  window.addEventListener('pagehide', dispose, {once: true});
  channel.onmessage = async ({data}) => {
    if (!data || data.type !== 'complete' || typeof data.sessionId !== 'string' || activating || disposed) return;
    if (confirmed === data.sessionId) {channel.postMessage({type: 'ack'}); return;}
    activating = true;
    try {
      // A message is only a notification. Clerk must verify the browser session.
      const client = await clerk.client.reload();
      const session = client.sessions.find(item => item.id === data.sessionId && item.status === 'active' && !item.currentTask);
      if (!session || disposed) return;
      await clerk.setActive({session: session.id, navigate: async () => {}});
      if (disposed) return;
      confirmed = session.id;
      channel.postMessage({type: 'ack'});
      clearTimeout(expiryTimer);
      ackTimer = setTimeout(dispose, 10_000);
    } catch {
      // The child retries briefly; a transient reload failure must not lose login.
    } finally {activating = false;}
  };
  // Do not poll popup.closed: COOP can sever its WindowProxy during OAuth.
}

export function clearAuthWindowState() {
  try {window.sessionStorage.removeItem(stateKey);} catch { /* Storage may be disabled. */ }
}
