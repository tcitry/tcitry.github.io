import {Component, useCallback, useEffect, useState, type ReactNode} from 'react';
import {useAuth} from '@clerk/react';
import {ConvexReactClient, useConvexAuth} from 'convex/react';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import SignInPanel, {AuthLoading} from './SignInPanel';

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

class ServiceBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() {
    return this.state.failed
      ? <p role="alert">暂时无法连接，请刷新页面后重试。</p>
      : this.props.children;
  }
}

function SessionContent({children, requireAuth}: {children: ReactNode; requireAuth: boolean}) {
  const {isLoaded, userId} = useAuth();
  const {isLoading, isAuthenticated} = useConvexAuth();
  if (!isLoaded || (requireAuth && isLoading)) return <AuthLoading label="正在连接…" />;
  if (requireAuth && !userId) return <SignInPanel title="登录后继续" description="使用同一个账户参与评论、保存对话和使用会员服务。" action />;
  if (requireAuth && !isAuthenticated) return <p role="status">账户暂时无法连接，请稍后重试或重新登录。</p>;
  return children;
}

function Client({url, children, requireAuth}: {url: string; children: ReactNode; requireAuth: boolean}) {
  const [client] = useState(() => new ConvexReactClient(url));
  useEffect(() => () => { void client.close(); }, [client]);
  return <ConvexProviderWithClerk client={client} useAuth={useConvexClerkAuth}>
    <ServiceBoundary><SessionContent requireAuth={requireAuth}>{children}</SessionContent></ServiceBoundary>
  </ConvexProviderWithClerk>;
}

// A new Clerk session gets a fresh client and query cache before children render.
// The wrapper lives under BlogClerkProvider; comment data also requires authentication.
export default function ConvexSession({children, requireAuth = false}: {children: ReactNode; requireAuth?: boolean}) {
  const {userId, sessionId} = useAuth();
  const url = import.meta.env.PUBLIC_CONVEX_URL ?? '';
  if (!url) return <p role="status">账户服务尚未开放，请稍后再来。</p>;
  return <Client key={`${userId ?? 'anonymous'}:${sessionId ?? ''}`} url={url} requireAuth={requireAuth}>{children}</Client>;
}
