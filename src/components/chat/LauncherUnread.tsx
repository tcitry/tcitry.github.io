import {createPortal} from 'react-dom';
import {useEffect} from 'react';
import {useAuth} from '@clerk/react';
import {useConvexAuth, useQuery} from 'convex/react';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import {api} from '../../../convex/_generated/api';
import useSessionConvexClient from '../auth/useSessionConvexClient';
import {formatUnreadCount, unreadLauncherLabel} from './unread-count';

function UnreadBadge({launcher}: {launcher: HTMLElement}) {
  const {isAuthenticated} = useConvexAuth();
  const count = useQuery(api.notifications.unreadCount, isAuthenticated ? {} : 'skip');
  useEffect(() => {
    launcher.setAttribute('aria-label', unreadLauncherLabel(count));
    const tooltip = launcher.querySelector('.blog-chat-widget__tooltip');
    if (tooltip) tooltip.textContent = count ? `博客助手（${formatUnreadCount(count)} 条未读）` : '博客助手';
    return () => {
      launcher.setAttribute('aria-label', unreadLauncherLabel(undefined));
      if (tooltip) tooltip.textContent = '博客助手';
    };
  }, [launcher, count]);
  if (!count) return null;
  return createPortal(
    <span className="blog-chat-widget__unread" data-notification-unread="launcher" aria-hidden="true">{formatUnreadCount(count)}</span>,
    launcher,
  );
}

function UnreadSession({url, launcher}: {url: string; launcher: HTMLElement}) {
  const client = useSessionConvexClient(url);
  return <ConvexProviderWithClerk client={client} useAuth={useAuth}>
    <UnreadBadge launcher={launcher} />
  </ConvexProviderWithClerk>;
}

export default function LauncherUnread({launcher}: {launcher: HTMLElement}) {
  const url = import.meta.env.PUBLIC_CONVEX_URL ?? '';
  const {isLoaded, isSignedIn, userId, sessionId} = useAuth();
  if (!url || !isLoaded || !isSignedIn) return null;
  return <UnreadSession key={`${userId}:${sessionId ?? ''}`} url={url} launcher={launcher} />;
}
