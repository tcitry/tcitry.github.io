import type {AuthenticateWithPopupParams, LoadedClerk} from '@clerk/shared/types';

export const clerkPopupStateParam = 'clerk_popup_state';
const completeMessage = 'blog-clerk-oauth:complete';
const ackMessage = 'blog-clerk-oauth:ack';
const errorMessage = 'blog-clerk-oauth:error';

type OAuthResource = LoadedClerk['client']['signIn'] | LoadedClerk['client']['signUp'];
type PopupParams = AuthenticateWithPopupParams & {unsafeMetadata?: SignUpUnsafeMetadata};

/** Clerk's native popup transport redirects the opener for unfinished sign-ups.
 * Keep the prebuilt modal's synchronously opened window, but use the public
 * Resource APIs so both OAuth outcomes return to our callback inside that window.
 */
export async function startClerkOAuthPopup(
  clerk: LoadedClerk,
  resource: OAuthResource,
  intent: 'signIn' | 'signUp',
  params: PopupParams,
  callbackUrl: string,
) {
  const popup = params.popup;
  if (!popup || popup.closed) throw new Error('登录弹窗被浏览器拦截，请允许弹窗后重试。');
  const state = crypto.randomUUID();
  const callback = new URL(callbackUrl);
  callback.searchParams.set(clerkPopupStateParam, state);
  const redirectUrl = callback.href;
  const origin = window.location.origin;

  let processing = false;
  let stopped = false;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener('message', onMessage);
    window.removeEventListener('pagehide', cancel);
    window.clearInterval(closedTimer);
    finish();
  };
  const cancel = () => { stop(); if (!popup.closed) popup.close(); };
  const onMessage = async (event: MessageEvent) => {
    if (stopped || processing || event.origin !== origin || event.source !== popup) return;
    const data = event.data;
    if (!data || data.type !== completeMessage || data.state !== state || typeof data.sessionId !== 'string') return;
    processing = true;
    try {
      // Unmount the prebuilt modal before activating a session: its signed-in
      // guard otherwise applies forceRedirectUrl and navigates the reading page.
      clerk.closeSignIn();
      clerk.closeSignUp();
      const client = await clerk.client.reload();
      const session = client.sessions.find(item => item.id === data.sessionId);
      if (!session || session.status !== 'active' || session.currentTask) throw new Error('Session is not ready');
      await clerk.setActive({session: session.id, navigate: async () => {}});
      popup.postMessage({type: ackMessage, state}, origin);
      stop();
      popup.close();
    } catch {
      // Leave the completed popup open so the user can retry synchronization.
      popup.postMessage({type: errorMessage, state}, origin);
      processing = false;
    }
  };
  const closedTimer = window.setInterval(() => { if (popup.closed) stop(); }, 500);
  window.addEventListener('message', onMessage);
  window.addEventListener('pagehide', cancel);

  try {
    const common = {
      strategy: params.strategy,
      redirectUrl,
      actionCompleteRedirectUrl: redirectUrl,
      oidcPrompt: params.oidcPrompt,
    };
    let externalUrl: URL | null;
    if (intent === 'signUp') {
      const signUp = resource as LoadedClerk['client']['signUp'];
      const fields = {...common, emailAddress: params.emailAddress, legalAccepted: params.legalAccepted, unsafeMetadata: params.unsafeMetadata};
      const attempt = await (params.continueSignUp && signUp.id ? signUp.update(fields) : signUp.create(fields));
      externalUrl = attempt.verifications.externalAccount.externalVerificationRedirectURL;
    } else {
      const signIn = resource as LoadedClerk['client']['signIn'];
      const attempt = await (params.continueSignIn && signIn.id
        ? signIn.prepareFirstFactor(params.strategy === 'enterprise_sso'
          ? {...common, strategy: 'enterprise_sso', enterpriseConnectionId: params.enterpriseConnectionId}
          : {...common, strategy: params.strategy})
        : signIn.create({...common, identifier: params.identifier}));
      externalUrl = attempt.firstFactorVerification.externalVerificationRedirectURL;
    }
    if (stopped || popup.closed) return;
    if (!externalUrl) throw new Error('登录服务未返回授权地址，请重试。');
    popup.location.href = externalUrl.toString();
    await finished;
  } catch (error) {
    cancel();
    throw error;
  }
}

/** A completion message is an invitation to reload server-verified sessions,
 * never an authentication credential. The opener acknowledges only after activation.
 */
export function notifyClerkPopupComplete(sessionId: string, onError: () => void) {
  const state = new URL(window.location.href).searchParams.get(clerkPopupStateParam);
  const opener: Window | null = window.opener;
  if (!state || !opener || opener.closed) return null;
  const origin = window.location.origin;
  let timer = 0;
  const send = () => opener.postMessage({type: completeMessage, state, sessionId}, origin);
  const cleanup = () => {
    window.clearInterval(timer);
    window.removeEventListener('message', onMessage);
  };
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== opener || event.data?.state !== state) return;
    if (event.data.type === ackMessage) { cleanup(); window.close(); }
    if (event.data.type === errorMessage) { cleanup(); onError(); }
  };
  window.addEventListener('message', onMessage);
  send();
  timer = window.setInterval(() => {
    if (opener.closed) { cleanup(); onError(); }
    else send();
  }, 500);
  return cleanup;
}
