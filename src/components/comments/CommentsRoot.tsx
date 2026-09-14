import {Component, useState, type ReactNode} from 'react';
import {useAuth} from '@clerk/react';
import {Button} from '@heroui/react';
import {useConvexAuth, useMutation, useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import BlogClerkProvider from '../auth/BlogClerkProvider';
import ConvexSession from '../auth/ConvexSession';
import AuthSyncRetry from '../auth/AuthSyncRetry';
import {convexAuthControlState, likeAuthPresentation} from '../auth/convex-auth-control';
import CommentThread from './CommentThread';
import CommentQueryLoading, {useCommentQueryRetry} from './CommentQueryLoading';
import {HeartIcon} from './CommentIcons';
import {AuthLoading} from '../auth/SignInPanel';
import ClerkSignInButton from '../auth/ClerkSignInButton';
import surface from '../demos/DemoSurface.module.css';
import BookmarkButton from '../reader/BookmarkButton';

interface CommentsProps {pathname: string; title?: string; bookmarkable?: boolean}

class CommentsBoundary extends Component<{children: ReactNode; onRetry: () => void}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() {
    return this.state.failed ? <div className="blog-comments__connection-error">
      <p role="alert">评论服务暂时无法连接，请稍后重试。</p>
      <Button size="sm" variant="outline" onPress={this.props.onRetry}>重新连接</Button>
    </div> : this.props.children;
  }
}

function CommentsView({pathname, title, bookmarkable, onRetrySession}: CommentsProps & {onRetrySession: () => void}) {
  const {userId} = useAuth();
  const {isAuthenticated, isLoading} = useConvexAuth();
  const summaryQuery = useCommentQueryRetry();
  const summary = useQuery(api.comments.getSummary, summaryQuery.skip ? 'skip' : {pathname});
  const liked = useQuery(api.comments.getMyLike, isAuthenticated ? {pathname} : 'skip');
  const setLike = useMutation(api.comments.setLike);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [tooltipContainer, setTooltipContainer] = useState<HTMLDivElement | null>(null);
  const authState = convexAuthControlState({userId, isAuthenticated, isLoading});
  const likePresentation = likeAuthPresentation(authState);
  const likeBusy = pending || authState === 'connecting' || (authState === 'ready' && liked === undefined);
  if (!summary) return <div className={`${surface.surface} blog-comments__root`} data-book-island>
    <CommentQueryLoading key={summaryQuery.attempt} label="正在读取评论数量…"
      errorLabel="评论数量读取时间过长，请检查网络后重试。" retryLabel="重新读取评论数量" onRetry={summaryQuery.retry} />
  </div>;

  async function toggleLike() {
    if (authState === 'unavailable') {onRetrySession(); return;}
    if (authState !== 'ready' || pending || liked === undefined) return;
    setPending(true); setError('');
    const articleTitle = title?.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, 160);
    try { await setLike({pathname, liked: !liked, ...(articleTitle ? {title: articleTitle} : {})}); }
    catch { setError('喜欢未能保存，请稍后重试。'); }
    finally { setPending(false); }
  }

  const likeButton = <Button size="sm" variant="ghost" aria-label={likePresentation.label} aria-pressed={Boolean(liked)}
    isPending={likeBusy}
    className="blog-comments__like" onPress={authState === 'anonymous' ? undefined : () => {void toggleLike();}}>
    <HeartIcon filled={Boolean(liked)} /><span>{summary.likeCount.toLocaleString()}</span>
  </Button>;

  return <div ref={setTooltipContainer} className={`${surface.surface} blog-comments__root`} data-book-island>
    <div className="blog-comments__summary">
      <span className="blog-comments__count" role="status">{summary.commentCount.toLocaleString()} 条评论</span>
      <div className="blog-comments__article-actions">
        {!userId ? <ClerkSignInButton>{likeButton}</ClerkSignInButton> : likeButton}
        {bookmarkable && title && <BookmarkButton pathname={pathname} title={title} tooltipContainer={tooltipContainer} onAuthRetry={onRetrySession} unavailableNotice={false} />}
      </div>
    </div>
    {error && <p className="blog-comments__error" role="alert">{error}</p>}
    {!userId ? <div className="blog-comments__signin">
      <p className="blog-comments__hint">登录后发表评论</p>
      <ClerkSignInButton><Button size="sm" variant="primary">登录 / 注册</Button></ClerkSignInButton>
    </div> : authState === 'connecting' ? <AuthLoading label="正在连接登录状态…" />
      : authState === 'ready' ? <CommentThread pathname={pathname} />
        : <AuthSyncRetry onRetry={onRetrySession} />}
  </div>;
}

export default function CommentsRoot({pathname, title, bookmarkable}: CommentsProps) {
  const [generation, setGeneration] = useState(0);
  if (!import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY || !import.meta.env.PUBLIC_CONVEX_URL) {
    return <p className="blog-comments__hint">评论服务尚未开放。</p>;
  }
  const retrySession = () => setGeneration(value => value + 1);
  return <BlogClerkProvider><ConvexSession key={generation}>
    <CommentsBoundary onRetry={retrySession}><CommentsView pathname={pathname} title={title} bookmarkable={bookmarkable} onRetrySession={retrySession} /></CommentsBoundary>
  </ConvexSession></BlogClerkProvider>;
}
