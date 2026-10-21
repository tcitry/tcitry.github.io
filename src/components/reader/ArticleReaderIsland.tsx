import BlogClerkProvider from '../auth/BlogClerkProvider';
import ConvexSession from '../auth/ConvexSession';
import ArticleReader from './ArticleReader';

export default function ArticleReaderIsland({pathname, title}: {pathname: string; title: string}) {
  if (!import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY || !import.meta.env.PUBLIC_CONVEX_URL) {
    return <p>阅读与收藏功能尚未开放。</p>;
  }
  return <BlogClerkProvider><ConvexSession><ArticleReader pathname={pathname} title={title} /></ConvexSession></BlogClerkProvider>;
}
