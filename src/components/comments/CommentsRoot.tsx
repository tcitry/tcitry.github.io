import {useEffect, useState} from 'react';
import {SignInButton, useAuth} from '@clerk/react';
import {Button} from '@heroui/react';
import BlogClerkProvider from '../auth/BlogClerkProvider';
import ConvexSession from '../auth/ConvexSession';
import CommentThread from './CommentThread';
import {panelClerkRedirect} from '../auth/SignInPanel';
import surface from '../demos/DemoSurface.module.css';

function SignedInComments({pathname}: {pathname: string}) {
  const {isLoaded, userId} = useAuth();
  if (!isLoaded) return <p className="blog-comments__hint" role="status">正在连接登录状态…</p>;
  if (!userId) return <div className={`${surface.surface} blog-comments__signin`} data-book-island><p className="blog-comments__hint">登录后查看评论。</p><SignInButton mode="modal" withSignUp {...panelClerkRedirect()}><Button size="sm" variant="secondary">登录 / 注册</Button></SignInButton></div>;
  return <ConvexSession requireAuth><CommentThread pathname={pathname} /></ConvexSession>;
}

export default function CommentsRoot({pathname}: {pathname: string}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <p className="blog-comments__hint" role="status">正在加载评论…</p>;
  if (!import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY || !import.meta.env.PUBLIC_CONVEX_URL) {
    return <p className="blog-comments__hint">评论服务尚未开放。</p>;
  }
  return <BlogClerkProvider><SignedInComments pathname={pathname} /></BlogClerkProvider>;
}
