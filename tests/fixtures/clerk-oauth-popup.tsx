import {StrictMode, useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import BlogClerkProvider from '../../src/components/auth/BlogClerkProvider';
import SsoCallback from '../../src/components/auth/SsoCallback';
import {openClerkSignIn} from '../../src/components/auth/clerk-signin';

// A same-origin account fixture shared through localStorage by browser windows.
// No Clerk script, account, OAuth provider, or external request is involved.
type Scenario = 'new' | 'returning' | 'missing';
type Call = {method: string; params?: unknown; pathname: string};
type AccountState = {
  scenario: Scenario;
  calls: Call[];
  signInStatus: string | null;
  verificationStatus: string | null;
  signUpStatus: string | null;
  sessionId: string | null;
  activeSessionId: string | null;
  sessionStatus?: 'active' | 'pending';
  currentTask?: {key: string} | null;
};
type CallbackParams = Record<string, any>;
const accountKey = 'clerk-oauth-popup-fixture';
const subscribers = new Set<() => void>();
const clerkListeners = new Set<(state: unknown) => void>();
let account: AccountState;
let revision = 0;
let modalOpen = false;
let modalOptions: CallbackParams = {};
let auth = {isLoaded: true, isSignedIn: false, sessionId: null as string | null};
const errors: string[] = [];

function backend(): AccountState {
  return JSON.parse(localStorage.getItem(accountKey)!);
}

function save(next: AccountState) {
  localStorage.setItem(accountKey, JSON.stringify(next));
}

function record(method: string, params?: unknown) {
  const next = backend();
  next.calls.push({method, params, pathname: location.pathname});
  save(next);
}

function notify() {
  revision += 1;
  auth = {isLoaded: true, isSignedIn: Boolean(account.activeSessionId), sessionId: account.activeSessionId};
  subscribers.forEach(listener => listener());
  clerkListeners.forEach(listener => listener({client, session: clerk.session}));
}

function refresh() {
  account = backend();
  notify();
}

function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

function report(error: unknown) {
  errors.push(error instanceof Error ? error.message : String(error));
  revision += 1;
  subscribers.forEach(listener => listener());
}

const resource = (kind: 'signIn' | 'signUp') => ({
  get status() { return kind === 'signIn' ? account.signInStatus : account.signUpStatus; },
  get createdSessionId() { return account.sessionId; },
  get missingFields() { return kind === 'signUp' && account.signUpStatus === 'missing_requirements' ? ['username'] : []; },
  get unverifiedFields() { return []; },
  get firstFactorVerification() {
    return {status: account.verificationStatus, error: account.verificationStatus === 'transferable' ? {code: 'external_account_not_found'} : null};
  },
  get verifications() { return {externalAccount: {status: account.signUpStatus ? 'verified' : null}}; },
  async create(params: CallbackParams) {
    record(`${kind}.create`, params);
    if (params.transfer) {
      // Keep the request pending long enough to expose two callback owners.
      await new Promise(resolve => setTimeout(resolve, 25));
      const next = backend();
      next.signInStatus = null;
      next.verificationStatus = null;
      next.signUpStatus = next.scenario === 'missing' ? 'missing_requirements' : 'complete';
      next.sessionId = next.scenario === 'missing' ? null : 'sess_fixture';
      save(next);
      refresh();
      return signUp;
    }
    const callback = String(params.redirectUrl);
    const provider = new URL('/mock-provider/', location.origin);
    provider.searchParams.set('callback', callback);
    const verification = {status: 'unverified', externalVerificationRedirectURL: provider.href};
    return kind === 'signIn'
      ? {firstFactorVerification: verification}
      : {verifications: {externalAccount: verification}};
  },
  async update(params: CallbackParams) {
    record(`${kind}.update`, params);
    const next = backend();
    next.signUpStatus = 'complete';
    next.sessionId = 'sess_fixture';
    save(next);
    refresh();
    return signUp;
  },
  async reload() {
    record(`${kind}.reload`);
    refresh();
    return kind === 'signIn' ? signIn : signUp;
  },
  async authenticateWithPopup() {
    throw new Error('The site must install its OAuth popup adapter before the provider button is used.');
  },
  async authenticateWithRedirect() {
    throw new Error('The popup test must never navigate the parent through authenticateWithRedirect.');
  },
});

const signIn = resource('signIn');
const signUp = resource('signUp');
const client = {
  signIn, signUp,
  get sessions() { return account.sessionId ? [{id: account.sessionId, status: account.sessionStatus || 'active', currentTask: account.currentTask || null}] : []; },
  async reload() {
    record('client.reload');
    if ((window as any).__fixtureRejectReload) throw new Error('Fixture session refresh failed');
    refresh();
    return client;
  },
};

const clerk = {
  client,
  loaded: true,
  load: async () => { record('clerk.load'); refresh(); },
  get session() { return account.activeSessionId ? {id: account.activeSessionId, status: account.sessionStatus || 'active', currentTask: account.currentTask || null} : null; },
  get user() { return account.activeSessionId ? {id: 'user_fixture'} : null; },
  addListener(listener: (state: unknown) => void) {
    clerkListeners.add(listener);
    return () => clerkListeners.delete(listener);
  },
  async setActive(params: CallbackParams) {
    record('setActive', {session: params.session});
    const next = backend();
    next.activeSessionId = params.session;
    save(next);
    // Clerk defers the authenticated React snapshot until its navigate callback
    // finishes; a hard navigation reloads the callback before emitting it.
    if (params.navigate) await params.navigate({session: {id: params.session, status: 'active', currentTask: null}});
    refresh();
  },
  openSignIn(options: CallbackParams = {}) {
    record('openSignIn', options);
    modalOptions = options;
    modalOpen = true;
    notify();
  },
  closeSignIn() { record('closeSignIn'); modalOpen = false; notify(); },
  closeSignUp() { record('closeSignUp'); modalOpen = false; notify(); },
  async navigate(to: string) {
    record('navigate', {to});
    location.assign(to);
    await new Promise(() => {});
  },
  async handleRedirectCallback(params: CallbackParams, customNavigate?: (to: string) => unknown) {
    record('handleRedirectCallback', params);
    const navigate = customNavigate || params.__internal_navigate || clerk.navigate;
    const activate = (to: string) => clerk.setActive({
      session: account.sessionId,
      // In Clerk JS 6.31.0 customNavigate controls intermediate steps only;
      // successful callback navigation uses clerk.navigate inside setActive.
      navigate: () => clerk.navigate(to),
    });
    const currentSignIn = signIn.status;
    const needsTransfer = signIn.firstFactorVerification.status === 'transferable';
    if (currentSignIn === 'complete' || signUp.status === 'complete') {
      await activate(params.signInForceRedirectUrl || params.signUpForceRedirectUrl || params.signInFallbackRedirectUrl || '/');
      return;
    }
    if (needsTransfer) await signUp.create({transfer: true});
    if (signUp.status === 'complete') {
      await activate(params.signUpForceRedirectUrl || params.signUpFallbackRedirectUrl || '/');
      return;
    }
    if (signUp.status === 'missing_requirements') {
      await navigate(params.continueSignUpUrl || 'https://accounts.invalid/sign-up#/continue');
      return;
    }
    throw new Error('Unexpected fixture callback state');
  },
};

export function useAuth() {
  return useSyncExternalStore(subscribe, () => auth);
}
export function useClerk() { return clerk; }
export function useSession() { return {...useAuth(), session: clerk.session}; }
export function useUser() { return {...useAuth(), user: clerk.user}; }
export function useSignIn() { return {isLoaded: true, signIn, setActive: clerk.setActive}; }
export function useSignUp() { return {isLoaded: true, signUp, setActive: clerk.setActive}; }
export function ClerkProvider({children}: {children: ReactNode}) { return children; }
export function ClerkLoaded({children}: {children: ReactNode}) { return children; }
export function ClerkLoading() { return null; }
export function ClerkFailed() { return null; }
export function AuthenticateWithRedirectCallback(props: CallbackParams) {
  useEffect(() => { void clerk.handleRedirectCallback(props).catch(report); }, []);
  return null;
}

export function SignUp(props: CallbackParams) {
  const [username, setUsername] = useState('');
  const complete = async () => {
    const result = await signUp.update({username});
    const destination = props.forceRedirectUrl || props.signUpForceRedirectUrl || props.fallbackRedirectUrl;
    await clerk.setActive({session: result.createdSessionId, ...(destination ? {navigate: () => clerk.navigate(destination)} : {})});
  };
  return <form data-fixture-complete-signup onSubmit={event => {event.preventDefault(); void complete().catch(report);}}>
    <label>用户名<input value={username} onChange={event => setUsername(event.target.value)} /></label>
    <button type="submit">完成注册</button>
  </form>;
}

export function SignIn(props: CallbackParams) {
  useSyncExternalStore(subscribe, () => revision);
  const {isSignedIn} = useAuth();
  useEffect(() => {
    // Model the prebuilt SignIn signed-in guard: leaving the parent's modal
    // mounted when its session becomes active would apply its force redirect.
    if (isSignedIn && props.forceRedirectUrl) void clerk.navigate(props.forceRedirectUrl);
  }, [isSignedIn, props.forceRedirectUrl]);
  if (signUp.status === 'missing_requirements') return <SignUp {...props} />;
  return <button type="button" onClick={() => {
    const popup = (window as any).__fixtureBlockPopups ? null : window.open('about:blank', 'clerk-oauth-fixture', 'popup=yes,width=640,height=760');
    (window as any).__oauthPopup = popup;
    void (signIn.authenticateWithPopup as (...args: any[]) => Promise<unknown>)({
      strategy: 'oauth_github', popup, redirectUrl: 'https://accounts.invalid/sign-in/sso-callback',
      redirectUrlComplete: location.href, continueSignUp: true,
    }).catch(report);
  }}>使用 GitHub 继续</button>;
}

function MainPage() {
  useSyncExternalStore(subscribe, () => revision);
  const {isSignedIn} = useAuth();
  return <>
    <div style={{height: 1200}}>公开文章测试内容</div>
    <section id="comments"><h1>评论</h1><p data-auth-state>{isSignedIn ? '已登录' : '未登录'}</p>
      <button type="button" onClick={() => openClerkSignIn(clerk)}>登录 / 注册</button>
    </section>
    <div style={{height: 1600}}>继续阅读</div>
    {modalOpen && <div role="dialog" aria-label="Clerk 登录" style={{position: 'fixed', top: 40, right: 40, padding: 24, background: 'white'}}>
      <SignIn {...modalOptions} />
    </div>}
    {errors.map((error, index) => <p key={index} data-fixture-error>{error}</p>)}
  </>;
}

export function startFixture() {
  if (!localStorage.getItem(accountKey)) {
    const scenario = new URL(location.href).searchParams.get('case') as Scenario || 'new';
    save({scenario, calls: [], signInStatus: null, verificationStatus: null, signUpStatus: null, sessionId: null, activeSessionId: null});
  }
  account = backend();
  auth = {isLoaded: true, isSignedIn: Boolean(account.activeSessionId), sessionId: account.activeSessionId};
  Object.assign(window, {__oauthFixture: {
    state: () => ({...backend(), modalOpen, errors}),
    clerk,
    authorize() {
      const next = backend();
      next.signInStatus = next.scenario === 'returning' ? 'complete' : 'needs_identifier';
      next.verificationStatus = next.scenario === 'returning' ? 'verified' : 'transferable';
      next.sessionId = next.scenario === 'returning' ? 'sess_fixture' : null;
      save(next);
      const callback = new URL(location.href).searchParams.get('callback');
      if (!callback) throw new Error('Fixture provider has no callback URL');
      location.replace(callback);
    },
  }});
  const host = document.getElementById('root')!;
  if (location.pathname === '/mock-provider/') {
    createRoot(host).render(<button onClick={() => (window as any).__oauthFixture.authorize()}>授权 GitHub</button>);
  } else if (location.pathname === '/sso-callback/') {
    createRoot(host).render(<StrictMode><SsoCallback /></StrictMode>);
  } else {
    createRoot(host).render(<StrictMode><BlogClerkProvider><MainPage /></BlogClerkProvider></StrictMode>);
  }
}
