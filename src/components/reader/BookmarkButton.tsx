import {useState} from 'react';
import {useAuth, useClerk} from '@clerk/react';
import {Bookmark, BookmarkFill} from '@gravity-ui/icons';
import {Button, Spinner, Tooltip} from '@heroui/react';
import {useConvexAuth, useMutation, useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import {panelClerkRedirect} from '../auth/SignInPanel';
import styles from './ReaderPanel.module.css';
import './reader.css';

export default function BookmarkButton({pathname, title, tooltipContainer, describedBy}: {
  pathname: string; title: string; tooltipContainer: HTMLElement | null; describedBy?: string;
}) {
  const {isLoaded, userId} = useAuth();
  const {openSignIn} = useClerk();
  const {isAuthenticated, isLoading} = useConvexAuth();
  const page = useQuery(api.reader.getPage, isAuthenticated ? {pathname} : 'skip');
  const setBookmark = useMutation(api.reader.setBookmark);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const loading = !isLoaded || Boolean(userId && (isLoading || (isAuthenticated && !page)));

  async function toggle() {
    if (!userId) {openSignIn(panelClerkRedirect()); return;}
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
        aria-label="收藏当前文章" aria-describedby={describedBy} aria-pressed={Boolean(page?.bookmarked)} data-article-bookmark
        isDisabled={loading || Boolean(userId && !isAuthenticated)} isPending={saving} onPress={() => {void toggle();}}>
        {loading || saving ? <Spinner size="sm" color="current" /> : page?.bookmarked ? <BookmarkFill width={20} height={20} aria-hidden="true" /> : <Bookmark width={20} height={20} aria-hidden="true" />}
      </Button>
      <Tooltip.Content className={styles.tooltip} placement="top end" offset={8} UNSTABLE_portalContainer={tooltipContainer ?? undefined}>
        {!userId ? '登录后收藏当前文章' : page?.bookmarked ? '取消收藏' : '收藏文章'}
      </Tooltip.Content>
    </Tooltip>
    {error && <span className={styles.bookmarkError} role="alert">{error}</span>}
  </div>;
}
