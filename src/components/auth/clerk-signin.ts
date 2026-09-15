import type {LoadedClerk} from '@clerk/shared/types';

type ClerkSignInProps = {
  forceRedirectUrl?: string;
  signUpForceRedirectUrl?: string;
  withSignUp?: boolean;
  transferable?: boolean;
  oauthFlow?: 'auto' | 'redirect' | 'popup';
};

type ClerkSignInOpener = {
  openSignIn: (props?: ClerkSignInProps) => unknown;
};

type ReturnUrlLocation = {
  href: string;
  origin?: string;
  replace?: (url: string) => void;
};

type ReturnUrlStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const clerkReturnUrlStorageKey = 'blog-clerk-return-url';

const maxReturnUrlLength = 2048;

function defaultStorage(): ReturnUrlStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function resolveStorage(storage?: ReturnUrlStorage | null) {
  return storage === undefined ? defaultStorage() : storage;
}

function locationContext(location: ReturnUrlLocation) {
  const href = location.href;
  const origin = location.origin || new URL(href).origin;
  return {href, origin};
}

export function resolveSameOriginReturnUrl(candidate: string, location: ReturnUrlLocation) {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > maxReturnUrlLength) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  const pathAbsolute = trimmed.startsWith('/') && !trimmed.startsWith('//');
  if (!pathAbsolute) {
    try {
      const absolute = new URL(trimmed);
      if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') return null;
    } catch {
      return null;
    }
  }
  try {
    const {origin} = locationContext(location);
    const url = new URL(trimmed, origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (url.origin !== origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function rememberClerkReturnUrl(
  location: ReturnUrlLocation = window.location,
  storage?: ReturnUrlStorage | null,
) {
  const store = resolveStorage(storage);
  if (!store) return;
  const resolved = resolveSameOriginReturnUrl(location.href, location);
  if (!resolved) return;
  try {
    store.setItem(clerkReturnUrlStorageKey, resolved);
  } catch {
    // sessionStorage can throw when it is blocked or full.
  }
}

export function readClerkReturnUrl(storage?: ReturnUrlStorage | null) {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    return store.getItem(clerkReturnUrlStorageKey);
  } catch {
    return null;
  }
}

export function clearClerkReturnUrl(storage?: ReturnUrlStorage | null) {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(clerkReturnUrlStorageKey);
  } catch {
    // Ignore blocked storage; a leftover value cannot be read either.
  }
}

export function consumeClerkReturnUrl(
  location: ReturnUrlLocation = window.location,
  storage?: ReturnUrlStorage | null,
) {
  const stored = readClerkReturnUrl(storage);
  clearClerkReturnUrl(storage);
  if (!stored) return null;
  const resolved = resolveSameOriginReturnUrl(stored, location);
  const current = resolveSameOriginReturnUrl(location.href, location);
  if (!resolved || resolved === current) return null;
  return resolved;
}

export function restoreClerkReturnUrl(
  location: ReturnUrlLocation = window.location,
  storage?: ReturnUrlStorage | null,
) {
  const next = consumeClerkReturnUrl(location, storage);
  if (!next) return false;
  if (typeof location.replace === 'function') location.replace(next);
  else (location as {href: string}).href = next;
  return true;
}

export function clerkForceRedirectUrl(location: ReturnUrlLocation = window.location) {
  // Account Portal nests these URLs in query strings. A comment hash would become
  // a fragment of the SSO callback and drop later params. sessionStorage keeps the hash.
  const resolved = resolveSameOriginReturnUrl(location.href, location);
  if (!resolved) return location.href;
  try {
    const url = new URL(resolved);
    url.hash = '';
    return url.href;
  } catch {
    return resolved;
  }
}

export const clerkSsoCallbackPath = '/sso-callback/';

export function clerkSsoCallbackUrl(location: ReturnUrlLocation = window.location) {
  return resolveSameOriginReturnUrl(clerkSsoCallbackPath, location) || clerkSsoCallbackPath;
}

export function isClerkSsoCallbackHref(candidate: string, location: ReturnUrlLocation) {
  try {
    const {origin} = locationContext(location);
    const url = new URL(candidate, origin);
    const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    return path === clerkSsoCallbackPath;
  } catch {
    return false;
  }
}

export function ssoCallbackHandlerProps() {
  return {
    transferable: true as const,
    signInFallbackRedirectUrl: '/',
    signUpFallbackRedirectUrl: '/',
  };
}

function withSiteSsoCallback(params: unknown, method: string) {
  const next = params && typeof params === 'object' ? {...params as Record<string, unknown>} : {};
  const callback = clerkSsoCallbackUrl();
  if (method === 'sso') {
    next.redirectCallbackUrl = callback;
    return next;
  }
  next.redirectUrl = callback;
  return next;
}

const oauthPatchedMethods = new WeakSet<object>();

function patchOAuthRedirectMethod(resource: object, name: string) {
  const current = (resource as Record<string, unknown>)[name];
  if (typeof current !== 'function' || oauthPatchedMethods.has(current)) return;
  const wrapped = function patchedOAuthRedirect(this: unknown, params?: unknown, ...rest: unknown[]) {
    return current.call(this, withSiteSsoCallback(params, name), ...rest);
  };
  oauthPatchedMethods.add(wrapped);
  (resource as Record<string, unknown>)[name] = wrapped;
}

function installOAuthSsoCallbackOnResource(resource: unknown) {
  if (!resource || typeof resource !== 'object') return;
  for (const name of ['authenticateWithRedirect', 'authenticateWithPopup', 'sso']) {
    patchOAuthRedirectMethod(resource, name);
  }
}

export function installOAuthSsoCallback(clerk: object | null | undefined) {
  for (const target of googleOneTapClerkTargets(clerk)) {
    const client = (target as {client?: {signIn?: unknown; signUp?: unknown}}).client;
    installOAuthSsoCallbackOnResource(client?.signIn);
    installOAuthSsoCallbackOnResource(client?.signUp);
  }
}

function unsubscribeClerkListener(result: unknown) {
  if (typeof result === 'function') return result as () => void;
  if (result && typeof result === 'object' && typeof (result as {unsubscribe?: unknown}).unsubscribe === 'function') {
    return () => (result as {unsubscribe: () => void}).unsubscribe();
  }
  return () => undefined;
}

export function watchClerkAuthSession(clerk: LoadedClerk, isSignedIn: boolean) {
  installOAuthSsoCallback(clerk);
  if (isSignedIn) {
    restoreClerkReturnUrl();
    return () => undefined;
  }
  void completePendingOAuthTransfer(clerk).catch(() => undefined);
  const host = clerk as LoadedClerk & {addListener?: (listener: () => void) => unknown};
  if (typeof host.addListener !== 'function') return () => undefined;
  return unsubscribeClerkListener(host.addListener(() => {
    installOAuthSsoCallback(clerk);
    void completePendingOAuthTransfer(clerk).catch(() => undefined);
  }));
}

function popupShouldClose() {
  try {
    return typeof window !== 'undefined' && Boolean(window.opener) && !window.opener.closed;
  } catch {
    return false;
  }
}

export function finishClerkSsoCallback(
  location: ReturnUrlLocation = window.location,
  storage?: ReturnUrlStorage | null,
) {
  if (popupShouldClose()) {
    try { window.close(); } catch { /* popup close can be blocked */ }
    return 'popup';
  }
  if (restoreClerkReturnUrl(location, storage)) return 'return';
  if (!isClerkSsoCallbackHref(location.href, location)) return false;
  const origin = location.origin || new URL(location.href).origin;
  const home = `${origin}/`;
  if (typeof location.replace === 'function') location.replace(home);
  else (location as {href: string}).href = home;
  return 'home';
}

export function panelClerkRedirect() {
  const currentPage = clerkForceRedirectUrl();
  return {
    forceRedirectUrl: currentPage,
    signUpForceRedirectUrl: currentPage,
    // Combined sign-in-or-up: first-time GitHub/Google OAuth must transfer into
    // sign-up to create an account instead of Account Portal external_account_not_found.
    withSignUp: true,
    // Modal is still the login shell. OAuth itself is a full-page redirect whose
    // redirectUrl is rewritten to the app-hosted /sso-callback/, so first-time
    // GitHub finishes on-site (Account Portal pure /sign-in cannot transfer).
    oauthFlow: 'redirect' as const,
  };
}

export function openClerkSignIn(clerk: ClerkSignInOpener) {
  // Persist before the modal opens. Do not store during signed-out render:
  // Account Portal may land on `/` while Clerk is still signed-out, which
  // would overwrite the pre-login URL before restore can run.
  rememberClerkReturnUrl();
  clerk.openSignIn({
    ...panelClerkRedirect(),
    transferable: true,
  });
}

export function googleOneTapRedirect() {
  const currentPage = window.location.href;
  return {
    signInForceRedirectUrl: currentPage,
    signUpForceRedirectUrl: currentPage,
  };
}

type GoogleOneTapVerification = {
  status?: string | null;
  error?: {code?: string} | null;
};

export type GoogleOneTapAttempt = {
  status?: string | null;
  identifier?: unknown;
  missingFields?: unknown;
  firstFactorVerification?: GoogleOneTapVerification | null;
};

type SignUpCreate = Pick<LoadedClerk['client']['signUp'], 'create'>;

type GoogleOneTapClerk = {
  authenticateWithGoogleOneTap: (params: {token: string}) => Promise<unknown>;
  handleGoogleOneTapCallback: (
    signInOrUp: unknown,
    params?: Record<string, unknown>,
    customNavigate?: (to: string) => Promise<unknown>,
  ) => Promise<unknown>;
  client?: {
    signIn?: GoogleOneTapAttempt | null;
    signUp?: SignUpCreate;
  };
};

const installedGoogleOneTapClerks = new WeakSet<object>();

export function googleOneTapClerkTargets(clerk: object | null | undefined) {
  if (!clerk) return [];
  const loaded = (clerk as {clerkjs?: object | null}).clerkjs;
  return loaded && loaded !== clerk ? [clerk, loaded] : [clerk];
}

export function googleOneTapNeedsSignUp(result: GoogleOneTapAttempt | null | undefined) {
  if (!result || result.status === 'complete') return false;
  // SignUp resources expose missingFields; do not re-transfer those.
  if (Array.isArray(result.missingFields)) return false;
  const verification = result.firstFactorVerification;
  if (!verification) return false;
  return verification.status === 'transferable'
    || verification.error?.code === 'external_account_not_found';
}

export function googleOneTapRejectedNeedsSignUp(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = (error as {code?: unknown}).code;
  if (code === 'external_account_not_found') return true;
  const errors = (error as {errors?: unknown}).errors;
  return Array.isArray(errors) && errors.some(item => (
    item && typeof item === 'object' && (item as {code?: unknown}).code === 'external_account_not_found'
  ));
}

export async function transferGoogleOneTapIfNeeded(
  clerk: {client?: {signUp?: SignUpCreate}},
  result: unknown,
  token?: string,
) {
  if (!googleOneTapNeedsSignUp(result as GoogleOneTapAttempt)) return result;
  const signUp = clerk.client?.signUp;
  if (!signUp) return result;
  if (token) {
    try {
      return await signUp.create({strategy: 'google_one_tap', token});
    } catch {
      // Fall through to the transferable sign-up ticket from the failed sign-in.
    }
  }
  return signUp.create({transfer: true});
}

let pendingOAuthTransfer: Promise<boolean> | undefined;

export function ensureClerkCaptchaElement(doc?: Document | null) {
  const root = doc === undefined ? (typeof document === 'undefined' ? null : document) : doc;
  if (!root?.body) return false;
  const existing = root.getElementById('clerk-captcha');
  if (existing) {
    // Interactive Turnstile cannot run in a display:none / hidden host.
    existing.removeAttribute('hidden');
    if ('style' in existing && existing.style && typeof existing.style.removeProperty === 'function') {
      existing.style.removeProperty('display');
    }
    return false;
  }
  const el = root.createElement('div');
  el.id = 'clerk-captcha';
  root.body.appendChild(el);
  return true;
}

function pendingOAuthAttempt(signIn: LoadedClerk['client']['signIn'] | GoogleOneTapAttempt | null | undefined) {
  return googleOneTapNeedsSignUp(signIn as GoogleOneTapAttempt | null | undefined);
}

async function runPendingOAuthTransfer(clerk: LoadedClerk) {
  ensureClerkCaptchaElement();
  const signIn = clerk.client.signIn;
  let result: unknown;
  try {
    result = await transferGoogleOneTapIfNeeded(clerk, signIn);
  } catch {
    return false;
  }
  const sessionId = result && typeof result === 'object'
    ? (result as {createdSessionId?: unknown}).createdSessionId
    : null;
  if (typeof sessionId === 'string' && sessionId) {
    try {
      await clerk.setActive({session: sessionId});
      return true;
    } catch {
      return false;
    }
  }
  if (
    result
    && typeof result === 'object'
    && (result as {status?: unknown}).status === 'missing_requirements'
  ) {
    clerk.openSignIn({...panelClerkRedirect(), transferable: true});
    return true;
  }
  return false;
}

export function completePendingOAuthTransfer(clerk: LoadedClerk) {
  if (pendingOAuthTransfer) return pendingOAuthTransfer;
  if (!pendingOAuthAttempt(clerk.client?.signIn)) return Promise.resolve(false);
  pendingOAuthTransfer = runPendingOAuthTransfer(clerk).finally(() => {
    pendingOAuthTransfer = undefined;
  });
  return pendingOAuthTransfer;
}

function installGoogleOneTapSignInOrUpOn(clerk: object) {
  const instance = clerk as GoogleOneTapClerk;
  if (!instance.authenticateWithGoogleOneTap || !instance.handleGoogleOneTapCallback) return;
  if (installedGoogleOneTapClerks.has(instance)) return;
  installedGoogleOneTapClerks.add(instance);

  const authenticate = instance.authenticateWithGoogleOneTap.bind(instance);
  const handleCallback = instance.handleGoogleOneTapCallback.bind(instance);

  instance.authenticateWithGoogleOneTap = async (params) => {
    rememberClerkReturnUrl();
    let result: unknown;
    try {
      result = await authenticate(params);
    } catch (error) {
      if (!googleOneTapRejectedNeedsSignUp(error)) throw error;
      result = {
        status: 'needs_identifier',
        identifier: null,
        firstFactorVerification: {status: 'failed', error: {code: 'external_account_not_found'}},
      };
    }
    try {
      return await transferGoogleOneTapIfNeeded(instance, result, params.token);
    } catch {
      return result;
    }
  };

  instance.handleGoogleOneTapCallback = (signInOrUp, params, customNavigate) => {
    const needsSignUp = googleOneTapNeedsSignUp(signInOrUp as GoogleOneTapAttempt);
    return handleCallback(signInOrUp, {
      ...params,
      transferable: true,
      ...(needsSignUp ? {continuation: 'transfer_to_sign_up'} : {}),
    }, customNavigate);
  };
}

export function installGoogleOneTapSignInOrUp(clerk: object | null | undefined) {
  // `<GoogleOneTap>` authenticates on Clerk JS, not the React proxy from useClerk().
  for (const target of googleOneTapClerkTargets(clerk)) installGoogleOneTapSignInOrUpOn(target);
}
