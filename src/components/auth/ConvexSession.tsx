import {useCallback, type ReactNode} from 'react';
import {useAuth} from '@clerk/react';
import {useConvexAuth} from 'convex/react';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import SignInPanel, {AuthLoading} from './SignInPanel';
import useSessionConvexClient from './useSessionConvexClient';
import ServiceBoundary from './ServiceBoundary';
export {default as ServiceBoundary} from './ServiceBoundary';

function useConvexClerkAuth() {
  const auth = useAuth();
  const getToken = useCallback(async (options: Parameters<typeof auth.getToken>[0]) => {
    try {
      const token = await auth.getToken(options);
      if (import.meta.env.DEV && !token) console.warn('[Convex authentication] Clerk returned no token.');
      return token;
    } catch (error) {
      if (import.meta.env.DEV) {
        const details = error as {status?: number; errors?: {code?: string}[]};
        // Never log tokens, claims, account identifiers, or raw provider errors.
        console.warn('[Convex authentication] Clerk token request failed. ' + JSON.stringify({
          status: details.status, code: details.errors?.[0]?.code,
        }));
      }
      throw error;
    }
  }, [auth.getToken]);
  return {...auth, getToken};
}

export function ConvexAuthGate({children, requireAuth = true}: {children: ReactNode; requireAuth?: boolean}) {
  const {isLoaded, userId} = useAuth();
  const {isLoading, isAuthenticated} = useConvexAuth();
  if (!isLoaded || (requireAuth && isLoading)) return <AuthLoading label="正在连接…" />;
  if (requireAuth && !userId) return <SignInPanel title="登录后继续" description="使用同一个账户参与评论、保存对话和使用会员服务。" action />;
  if (requireAuth && !isAuthenticated) return <p role="status">账户暂时无法连接，请稍后重试或重新登录。</p>;
  return children;
}

function Client({url, children, requireAuth}: {url: string; children: ReactNode; requireAuth: boolean}) {
  const client = useSessionConvexClient(url);
  return <ConvexProviderWithClerk client={client} useAuth={useConvexClerkAuth}>
    <ConvexAuthGate requireAuth={requireAuth}>{children}</ConvexAuthGate>
  </ConvexProviderWithClerk>;
}

// A new Clerk session gets a fresh client and query cache before children render.
// The wrapper lives under BlogClerkProvider; comment data also requires authentication.
export default function ConvexSession({children, requireAuth = false, disableBoundary = false, onErrorClose}: {
  children: ReactNode; requireAuth?: boolean; disableBoundary?: boolean; onErrorClose?: () => void;
}) {
  const {userId, sessionId} = useAuth();
  const url = import.meta.env.PUBLIC_CONVEX_URL ?? '';
  if (!url) return <p role="status">账户服务尚未开放，请稍后再来。</p>;
  const sessionKey = `${userId ?? 'anonymous'}:${sessionId ?? ''}`;
  const content = <Client key={sessionKey} url={url} requireAuth={requireAuth}>{children}</Client>;
  // An outer retry must also replace a failed/closed client. Local boundaries
  // inside a healthy provider can retry one private view without replacing it.
  return disableBoundary ? content : <ServiceBoundary key={sessionKey} onClose={onErrorClose}>{content}</ServiceBoundary>;
}
