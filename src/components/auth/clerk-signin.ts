import type {AuthenticateWithPopupParams, HandleOAuthCallbackParams, LoadedClerk} from '@clerk/shared/types';
import {clerkPopupStateParam, startClerkOAuthPopup} from './clerk-oauth-popup';

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
  const callback = new URL(clerkSsoCallbackPath, locationContext(location).origin);
  const current = new URL(location.href);
  if (isClerkSsoCallbackHref(current.href, location)) {
    const state = current.searchParams.get(clerkPopupStateParam);
    if (state) callback.searchParams.set(clerkPopupStateParam, state);
  }
  return callback.href;
}

export function isClerkSsoCallbackHref(candidate: string, location: ReturnUrlLocation) {
  try {
    const {origin} = locationContext(location);
    const url = new URL(candidate, origin);
    const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    return url.origin === origin && path === clerkSsoCallbackPath;
  } catch {
    return false;
  }
}

export function ssoCallbackHandlerProps(): HandleOAuthCallbackParams {
  const callback = clerkSsoCallbackUrl();
  const route = (path: string) => `${callback}#/${path}`;
  return {
    transferable: true,
    // Only the callback finishes navigation. During popup login, even success
    // stays in this window until the opener acknowledges its active session.
    signInForceRedirectUrl: callback,
    signUpForceRedirectUrl: callback,
    signInUrl: route(''),
    signUpUrl: route('create'),
    firstFactorUrl: route('factor-one'),
    secondFactorUrl: route('factor-two'),
    resetPasswordUrl: route('reset-password'),
    continueSignUpUrl: route('create/continue'),
    verifyEmailAddressUrl: route('create/verify-email-address'),
    verifyPhoneNumberUrl: route('create/verify-phone-number'),
    signInProtectCheckUrl: route('protect-check'),
    signUpProtectCheckUrl: route('create/protect-check'),
  };
}

type CallbackRun = {promise: Promise<unknown>; navigate: (to: string) => Promise<unknown>};
const callbackRuns = new WeakMap<object, CallbackRun>();

export function runClerkSsoCallback(clerk: LoadedClerk, navigate: (to: string) => Promise<unknown>) {
  // @clerk/react's proxy drops customNavigate and the callback promise. Use the
  // loaded browser runtime so errors, continuation and cross-island dedup work.
  const runtime = (clerk as LoadedClerk & {clerkjs?: LoadedClerk}).clerkjs || clerk;
  const previous = callbackRuns.get(runtime);
  if (previous) {
    // React can replace an effect while the request is pending (StrictMode).
    // Deliver continuation to the current mounted owner, without a second call.
    previous.navigate = navigate;
    return previous.promise;
  }
  ensureClerkCaptchaElement();
  const run: CallbackRun = {
    navigate,
    promise: Promise.resolve().then(() => runtime.handleRedirectCallback(ssoCallbackHandlerProps(), to => run.navigate(to))),
  };
  callbackRuns.set(runtime, run);
  return run.promise;
}

function withSiteSsoCallback(params: unknown) {
  const next = params && typeof params === 'object' ? {...params as Record<string, unknown>} : {};
  const callback = clerkSsoCallbackUrl();
  next.redirectUrl = callback;
  return next;
}

const oauthPatchedMethods = new WeakSet<object>();

function patchOAuthRedirectMethod(resource: object, name: string) {
  const current = (resource as Record<string, unknown>)[name];
  if (typeof current !== 'function' || oauthPatchedMethods.has(current)) return;
  const wrapped = function patchedOAuthRedirect(this: unknown, params?: unknown, ...rest: unknown[]) {
    return current.call(this, withSiteSsoCallback(params), ...rest);
  };
  oauthPatchedMethods.add(wrapped);
  (resource as Record<string, unknown>)[name] = wrapped;
}

function installOAuthSsoCallbackOnResource(clerk: LoadedClerk, resource: unknown, intent: 'signIn' | 'signUp') {
  if (!resource || typeof resource !== 'object') return;
  patchOAuthRedirectMethod(resource, 'authenticateWithRedirect');
  const current = (resource as Record<string, unknown>).authenticateWithPopup;
  if (typeof current === 'function' && !oauthPatchedMethods.has(current)) {
    const wrapped = (params: AuthenticateWithPopupParams) => startClerkOAuthPopup(
      clerk, resource as LoadedClerk['client']['signIn'] | LoadedClerk['client']['signUp'], intent, params, clerkSsoCallbackUrl(),
    );
    oauthPatchedMethods.add(wrapped);
    (resource as Record<string, unknown>).authenticateWithPopup = wrapped;
  }
}

export function installOAuthSsoCallback(clerk: object | null | undefined) {
  for (const target of googleOneTapClerkTargets(clerk)) {
    const client = (target as {client?: {signIn?: unknown; signUp?: unknown}}).client;
    installOAuthSsoCallbackOnResource(clerk as LoadedClerk, client?.signIn, 'signIn');
    installOAuthSsoCallbackOnResource(clerk as LoadedClerk, client?.signUp, 'signUp');
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
  // Callback and prebuilt UI own transfer. Parent islands only keep the OAuth
  // adapter installed as Clerk replaces resources; they must never race them.
  if (isSignedIn && !isClerkSsoCallbackHref(window.location.href, window.location)) clearClerkReturnUrl();
  const host = clerk as LoadedClerk & {addListener?: (listener: () => void) => unknown};
  if (typeof host.addListener !== 'function') return () => undefined;
  return unsubscribeClerkListener(host.addListener(() => {
    installOAuthSsoCallback(clerk);
  }));
}

export function finishClerkSsoCallback(
  location: ReturnUrlLocation = window.location,
  storage?: ReturnUrlStorage | null,
) {
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
    // The popup adapter keeps OAuth, transfer and any extra fields in the child
    // window; the opener activates the verified session without navigating.
    oauthFlow: 'popup' as const,
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
