import BlogClerkProvider from '../auth/BlogClerkProvider';
import ConvexSession from '../auth/ConvexSession';
import ReadingProgress from './ReadingProgress';

export default function ReadingProgressIsland({pathname, title}: {pathname: string; title: string}) {
  if (!import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY || !import.meta.env.PUBLIC_CONVEX_URL) return null;
  return <BlogClerkProvider><ConvexSession><ReadingProgress pathname={pathname} title={title} /></ConvexSession></BlogClerkProvider>;
}
