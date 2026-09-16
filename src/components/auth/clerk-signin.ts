import type {LoadedClerk} from '@clerk/shared/types';
import {authWindowState, authWindowUrl, openClerkAuthWindow} from './clerk-auth-window';

// The existing route hosts Clerk's complete sign-in-or-up tree. Its hash routes
// own OAuth callbacks, profile completion, verification and session tasks.
export const clerkSignInPath = '/sso-callback/';

export function clerkAfterAuthFallbackUrl(location: Pick<Location, 'href'> = window.location) {
  const url = new URL(location.href);
  if (typeof window !== 'undefined' && location === window.location) {
    const state = authWindowState();
    if (state) return authWindowUrl(state);
  }
  // Visiting the auth page directly must not redirect a signed-in user to itself.
  return url.pathname.replace(/\/$/, '') === clerkSignInPath.replace(/\/$/, '') ? '/' : url.href;
}

export function openClerkSignIn(clerk: Pick<LoadedClerk, 'client' | 'setActive'>, onError: (message: string) => void) {
  openClerkAuthWindow(clerk, onError);
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

function installGoogleOneTapSignInOrUpOn(clerk: object) {
  const instance = clerk as GoogleOneTapClerk;
  if (!instance.authenticateWithGoogleOneTap || !instance.handleGoogleOneTapCallback) return;
  if (installedGoogleOneTapClerks.has(instance)) return;
  installedGoogleOneTapClerks.add(instance);

  const authenticate = instance.authenticateWithGoogleOneTap.bind(instance);
  const handleCallback = instance.handleGoogleOneTapCallback.bind(instance);

  instance.authenticateWithGoogleOneTap = async (params) => {
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
