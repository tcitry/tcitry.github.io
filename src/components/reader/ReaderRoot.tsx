import {Component, useEffect, useState, type ReactNode} from 'react';
import {useAuth} from '@clerk/react';
import {ConvexReactClient, useConvexAuth} from 'convex/react';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import SignInPanel, {AuthLoading} from '../auth/SignInPanel';
import ArticleReader from './ArticleReader';
import ReaderLibrary from './ReaderLibrary';
import surfaceStyles from '../demos/DemoSurface.module.css';
import './reader.css';
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
  const {isLoaded, userId, sessionId} = useAuth();
  const {isAuthenticated, isLoading} = useConvexAuth();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!isLoading) return;
    const timeout = window.setTimeout(() => setSlow(true), 15000);
    return () => window.clearTimeout(timeout);
  }, [isLoading, sessionId]);

  if (!isLoaded) return <AuthLoading label="正在加载登录…" />;

  return <>
    <div className="reader-account-bar">
      <span className="reader-account-caption">{props.library ? '你的私人阅读空间' : '阅读账户'}</span>
    </div>
    {!userId
      ? <SignInPanel
        title="登录后阅读"
        description="登录后收藏文章、继续上次阅读，并保存仅自己可见的笔记。"
        action
      />
      : isLoading
        ? <AuthLoading label={slow ? '连接仍在进行中，请检查网络或稍后刷新。' : '正在连接阅读账户…'} />
        : isAuthenticated
          ? <ReaderBoundary key={`${userId}:${sessionId}`}>
            {props.pathname && <ArticleReader pathname={props.pathname} title={props.title!} />}
            {props.library && <ReaderLibrary />}
          </ReaderBoundary>
          : <p className="reader-account-hint">阅读数据暂时无法同步，请稍后刷新或重新登录。</p>}
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

export default function ReaderRoot(props: ReaderProps) {
  const clerkKey = import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  const convexUrl = import.meta.env.PUBLIC_CONVEX_URL ?? '';
  return <section className={`${surfaceStyles.surface} reader-shell`} aria-label={props.library ? '我的阅读账户' : '文章阅读工具'}
    data-book-island data-reader-root data-pagefind-ignore data-sentry-mask>
    <ReaderBoundary>
      {clerkKey && convexUrl
        ? <SessionReader {...props} convexUrl={convexUrl} />
        : <p className="reader-account-hint">阅读账户尚未开放。你可以继续阅读全部公开文章。</p>}
    </ReaderBoundary>
  </section>;
}
