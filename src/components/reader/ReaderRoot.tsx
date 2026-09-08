import {Component, useEffect, useState, type ReactNode} from 'react';
import {ClerkFailed, ClerkLoaded, ClerkLoading, ClerkProvider, SignIn, useAuth, useClerk} from '@clerk/react';
import {ConvexReactClient, useConvexAuth} from 'convex/react';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import {Button} from '@heroui/react';
import ArticleReader from './ArticleReader';
import ReaderLibrary from './ReaderLibrary';
import surfaceStyles from '../demos/DemoSurface.module.css';
import './reader-shell.css';

interface ReaderProps {pathname?: string; title?: string; library?: boolean}

class ReaderBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() {
    return this.state.failed
      ? <p role="alert">阅读账户暂时无法连接。请稍后刷新页面重试，文章仍可正常阅读。</p>
      : this.props.children;
  }
}

function ReaderAccount(props: ReaderProps) {
  const clerk = useClerk();
  const {userId, sessionId} = useAuth();
  const {isAuthenticated, isLoading} = useConvexAuth();
  const [accountError, setAccountError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!isLoading) return;
    const timeout = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timeout);
  }, [isLoading, sessionId]);

  async function signOut() {
    if (!window.dispatchEvent(new CustomEvent('reader:before-signout', {cancelable: true}))) return;
    setPending(true);
    setAccountError('');
    try { await clerk.signOut(); }
    catch { setAccountError('退出未完成，请重试。'); }
    finally { setPending(false); }
  }

  return <>
    <div className="reader-account-bar">
      <span className="reader-account-caption">{props.library ? '你的私人阅读空间' : '阅读账户'}</span>
      <div className="reader-account-actions">
        {userId
          ? <Button size="sm" variant="ghost" isPending={pending} onPress={signOut}>退出登录</Button>
          : <Button size="sm" variant="secondary" onPress={() => {
            setAccountError('');
            setSigningIn(true);
          }}>登录 / 注册</Button>}
      </div>
    </div>
    {signingIn && !userId && <div className="reader-inline-signin">
      <SignIn routing="hash" withSignUp forceRedirectUrl={window.location.href} signUpForceRedirectUrl={window.location.href} />
    </div>}
    {accountError && <p role="alert">{accountError}</p>}
    {isLoading
      ? <p role="status">{slow ? '连接仍在进行中，请检查网络或稍后刷新。' : '正在连接阅读账户…'}</p>
      : userId && isAuthenticated
        ? <ReaderBoundary key={`${userId}:${sessionId}`}>
          {props.pathname && <ArticleReader pathname={props.pathname} title={props.title!} />}
          {props.library && <ReaderLibrary />}
        </ReaderBoundary>
        : <p className="reader-account-hint">{userId
          ? '阅读数据暂时无法同步，请稍后刷新或重新登录。'
          : '登录后收藏文章、继续上次阅读，并保存仅自己可见的笔记。'}</p>}
  </>;
}

function SessionClient({convexUrl, ...props}: ReaderProps & {convexUrl: string}) {
  const [client] = useState(() => new ConvexReactClient(convexUrl));
  useEffect(() => () => { void client.close(); }, [client]);
  return <ConvexProviderWithClerk client={client} useAuth={useAuth}>
    <ReaderAccount {...props} />
  </ConvexProviderWithClerk>;
}

function SessionReader(props: ReaderProps & {convexUrl: string}) {
  const {userId, sessionId} = useAuth();
  // Auth-sensitive queries share their function/args across users. Discard the
  // entire client cache synchronously when the Clerk session changes.
  return <SessionClient key={`${userId ?? 'anonymous'}:${sessionId ?? ''}`} {...props} />;
}

function ConnectedReader({clerkKey, ...props}: ReaderProps & {clerkKey: string; convexUrl: string}) {
  return <ClerkProvider publishableKey={clerkKey} signInFallbackRedirectUrl="/me/" signUpFallbackRedirectUrl="/me/">
    <ClerkLoading><p role="status">正在加载阅读账户…</p></ClerkLoading>
    <ClerkFailed><p role="alert">登录服务暂时无法连接，请稍后重试。</p></ClerkFailed>
    <ClerkLoaded>
      <SessionReader {...props} />
    </ClerkLoaded>
  </ClerkProvider>;
}

export default function ReaderRoot(props: ReaderProps) {
  const clerkKey = import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  const convexUrl = import.meta.env.PUBLIC_CONVEX_URL ?? '';
  return <section className={`${surfaceStyles.surface} reader-shell`} aria-label={props.library ? '我的阅读账户' : '文章阅读工具'}
    data-book-island data-reader-root data-pagefind-ignore data-sentry-mask>
    <ReaderBoundary>
      {clerkKey && convexUrl
        ? <ConnectedReader {...props} clerkKey={clerkKey} convexUrl={convexUrl} />
        : <p className="reader-account-hint">阅读账户尚未开放。你可以继续阅读全部公开文章。</p>}
    </ReaderBoundary>
  </section>;
}
