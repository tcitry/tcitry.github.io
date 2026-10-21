import {useState} from 'react';
import {useAuth, useClerk} from '@clerk/react';
import {Button} from '@heroui/react';
import {useConvexAuth, useMutation, useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import {openClerkSignIn} from '../auth/clerk-signin';
import {convexAuthControlState, retryConvexAuth} from '../auth/convex-auth-control';
import {useRefreshConvexToken} from '../auth/convex-token-refresh';
import ReadingStatusMenu, {type ReadingStatus} from './ReadingStatusMenu';
import styles from './ReaderPanel.module.css';

export default function ReadingMarkControl({pathname, title, container}: {pathname: string; title: string; container: HTMLElement | null}) {
  const {isLoaded, userId} = useAuth();
  const clerk = useClerk();
  const {isAuthenticated, isLoading} = useConvexAuth();
  const refreshToken = useRefreshConvexToken();
  const authState = convexAuthControlState({userId, isLoaded, isAuthenticated, isLoading});
  const mark = useQuery(api.reader.getReadingMark, isAuthenticated ? {pathname} : 'skip');
  const setMark = useMutation(api.reader.setReadingMark);
  const clearMark = useMutation(api.reader.clearReadingMark);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(status: ReadingStatus | null) {
    if (authState !== 'ready' || !mark || saving) return;
    setSaving(true);
    setError('');
    try {
      if (status === null) await clearMark({pathname});
      else await setMark({pathname, title, status});
    } catch {setError('阅读标记未能保存，请稍后重试。');}
    finally {setSaving(false);}
  }

  return <div className={styles.readingAction} data-reading-mark data-sentry-mask data-pagefind-ignore>
    {authState === 'anonymous' || authState === 'unavailable'
      ? <Button size="sm" variant="outline" onPress={() => {
        if (authState === 'anonymous') openClerkSignIn(clerk);
        else retryConvexAuth(refreshToken);
      }}>{authState === 'anonymous' ? '登录后标记阅读' : '重试同步阅读标记'}</Button>
      : <ReadingStatusMenu value={mark?.status ?? null} emptyLabel="未标记" label="阅读标记"
        disabled={authState === 'connecting' || !mark || saving} pending={saving} container={container}
        onChange={status => {void save(status);}} />}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
