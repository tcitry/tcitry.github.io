import {useState} from 'react';
import {useAuth, useClerk} from '@clerk/react';
import {Bookmark, BookmarkFill} from '@gravity-ui/icons';
import {Button, Spinner, Tooltip} from '@heroui/react';
import {useConvexAuth, useMutation, useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import {openClerkSignIn} from '../auth/clerk-signin';
import {useRefreshConvexToken} from '../auth/convex-token-refresh';
import {
  AUTH_SYNC_UNAVAILABLE_SHORT,
  bookmarkAuthPresentation,
  convexAuthControlState,
  retryConvexAuth,
} from '../auth/convex-auth-control';
import styles from './ReaderPanel.module.css';
import './reader.css';

export default function BookmarkButton({pathname, title, tooltipContainer, describedBy, onAuthRetry, unavailableNotice = true}: {
  pathname: string; title: string; tooltipContainer: HTMLElement | null; describedBy?: string;
  onAuthRetry?: () => void; unavailableNotice?: boolean;
}) {
  const {isLoaded, userId} = useAuth();
  const clerk = useClerk();
  const {isAuthenticated, isLoading} = useConvexAuth();
  const refreshConvexToken = useRefreshConvexToken();
  const page = useQuery(api.reader.getPage, isAuthenticated ? {pathname} : 'skip');
  const setBookmark = useMutation(api.reader.setBookmark);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const authState = convexAuthControlState({userId, isLoaded, isAuthenticated, isLoading});
  const waitingForPage = authState === 'ready' && !page;
  const presentation = bookmarkAuthPresentation(waitingForPage ? 'connecting' : authState, Boolean(page?.bookmarked));
  const loading = presentation.disabled;

  async function toggle() {
    if (authState === 'connecting') return;
    if (authState === 'anonymous') {openClerkSignIn(clerk); return;}
    if (authState === 'unavailable') {
      if (onAuthRetry) onAuthRetry();
      else retryConvexAuth(refreshConvexToken);
      return;
    }
    if (!page || saving) return;
    setSaving(true);
    setError('');
    try {await setBookmark({pathname, title, bookmarked: !page.bookmarked});}
    catch {setError('收藏未能保存，请稍后重试。');}
    finally {setSaving(false);}
  }

  return <div className={styles.bookmarkAction}>
    <Tooltip delay={400}>
      <Button isIconOnly variant="ghost" className={styles.bookmarkButton}
        aria-label={presentation.label} aria-describedby={describedBy} aria-pressed={Boolean(page?.bookmarked)} data-article-bookmark
        isDisabled={loading} isPending={saving} onPress={() => {void toggle();}}>
        {loading || saving ? <Spinner size="sm" color="current" /> : page?.bookmarked ? <BookmarkFill width={20} height={20} aria-hidden="true" /> : <Bookmark width={20} height={20} aria-hidden="true" />}
      </Button>
      <Tooltip.Content className={styles.tooltip} placement="top end" offset={8} UNSTABLE_portalContainer={tooltipContainer ?? undefined}>
        {presentation.tooltip}
      </Tooltip.Content>
    </Tooltip>
    {authState === 'unavailable' && unavailableNotice && <span className={styles.bookmarkError} role="alert">{AUTH_SYNC_UNAVAILABLE_SHORT}</span>}
    {error && <span className={styles.bookmarkError} role="alert">{error}</span>}
  </div>;
}
