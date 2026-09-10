import {Component, useState, type ReactNode} from 'react';
import {SignInButton, useAuth} from '@clerk/react';
import {Button} from '@heroui/react';
import {useConvexAuth, useMutation, useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import BlogClerkProvider from '../auth/BlogClerkProvider';
import ConvexSession from '../auth/ConvexSession';
import CommentThread from './CommentThread';
import CommentQueryLoading, {useCommentQueryRetry} from './CommentQueryLoading';
import {HeartIcon} from './CommentIcons';
import {AuthLoading, panelClerkRedirect} from '../auth/SignInPanel';
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

function CommentsView({pathname, title, bookmarkable}: CommentsProps) {
  const {userId} = useAuth();
  const {isAuthenticated, isLoading} = useConvexAuth();
  const summaryQuery = useCommentQueryRetry();
  const summary = useQuery(api.comments.getSummary, summaryQuery.skip ? 'skip' : {pathname});
  const liked = useQuery(api.comments.getMyLike, isAuthenticated ? {pathname} : 'skip');
  const setLike = useMutation(api.comments.setLike);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [tooltipContainer, setTooltipContainer] = useState<HTMLDivElement | null>(null);
  if (!summary) return <div className={`${surface.surface} blog-comments__root`} data-book-island>
    <CommentQueryLoading key={summaryQuery.attempt} label="正在读取评论数量…"
      errorLabel="评论数量读取时间过长，请检查网络后重试。" retryLabel="重新读取评论数量" onRetry={summaryQuery.retry} />
  </div>;
  const likeButton = <Button size="sm" variant="ghost" aria-label="喜欢这篇文章" aria-pressed={Boolean(liked)}
    isPending={pending} isDisabled={Boolean(userId && (!isAuthenticated || liked === undefined))}
    className="blog-comments__like" onPress={isAuthenticated ? async () => {
      if (pending || liked === undefined) return;
      setPending(true); setError('');
      const articleTitle = title?.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim().slice(0, 160);
      try { await setLike({pathname, liked: !liked, ...(articleTitle ? {title: articleTitle} : {})}); }
      catch { setError('喜欢未能保存，请稍后重试。'); }
      finally { setPending(false); }
    } : undefined}>
    <HeartIcon filled={Boolean(liked)} /><span>{summary.likeCount.toLocaleString()}</span>
  </Button>;

  return <div ref={setTooltipContainer} className={`${surface.surface} blog-comments__root`} data-book-island>
    <div className="blog-comments__summary">
      <span className="blog-comments__count" role="status">{summary.commentCount.toLocaleString()} 条评论</span>
      <div className="blog-comments__article-actions">
        {!userId ? <SignInButton mode="modal" withSignUp {...panelClerkRedirect()}>{likeButton}</SignInButton> : likeButton}
        {bookmarkable && title && <BookmarkButton pathname={pathname} title={title} tooltipContainer={tooltipContainer} />}
      </div>
    </div>
    {error && <p className="blog-comments__error" role="alert">{error}</p>}
    {!userId ? <div className="blog-comments__signin">
      <p className="blog-comments__hint">登录后查看评论与参与讨论。</p>
      <SignInButton mode="modal" withSignUp {...panelClerkRedirect()}><Button size="sm" variant="secondary">登录 / 注册</Button></SignInButton>
    </div> : isLoading ? <AuthLoading label="正在连接登录状态…" />
      : isAuthenticated ? <CommentThread pathname={pathname} />
        : <p role="alert" className="blog-comments__error">登录状态暂时无法同步，请稍后刷新或重新登录。</p>}
  </div>;
}

export default function CommentsRoot({pathname, title, bookmarkable}: CommentsProps) {
  const [generation, setGeneration] = useState(0);
  if (!import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY || !import.meta.env.PUBLIC_CONVEX_URL) {
    return <p className="blog-comments__hint">评论服务尚未开放。</p>;
  }
  return <BlogClerkProvider><ConvexSession key={generation}>
    <CommentsBoundary onRetry={() => setGeneration(value => value + 1)}><CommentsView pathname={pathname} title={title} bookmarkable={bookmarkable} /></CommentsBoundary>
  </ConvexSession></BlogClerkProvider>;
}
