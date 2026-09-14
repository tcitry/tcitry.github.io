export type ConvexAuthControlState = 'anonymous' | 'connecting' | 'unavailable' | 'ready';

export function convexAuthControlState(input: {
  userId?: string | null;
  isLoaded?: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
}): ConvexAuthControlState {
  if (input.isLoaded === false || input.isLoading) return 'connecting';
  if (!input.userId) return 'anonymous';
  if (!input.isAuthenticated) return 'unavailable';
  return 'ready';
}

export const AUTH_SYNC_UNAVAILABLE = '登录状态暂时无法同步，请稍后重试或重新登录。';
export const AUTH_SYNC_UNAVAILABLE_SHORT = '登录状态尚未同步。';
export const AUTH_SYNC_RETRY = '重试';
export const AUTH_SYNC_CONNECTING = '正在连接登录状态…';
export const AUTH_ACCOUNT_UNAVAILABLE = '账户暂时无法连接，请稍后重试或重新登录。';
export const AUTH_BOOKMARK_UNAVAILABLE = '收藏暂时无法同步，请稍后重试或重新登录。';

export function retryConvexAuth(refresh?: (() => void) | null) {
  if (refresh) refresh();
  else window.location.reload();
}

export function bookmarkAuthPresentation(state: ConvexAuthControlState, bookmarked = false) {
  if (state === 'anonymous') return {
    label: '收藏当前文章',
    tooltip: '登录后收藏当前文章',
    disabled: false,
  };
  if (state === 'connecting') return {
    label: '收藏当前文章',
    tooltip: AUTH_SYNC_CONNECTING,
    disabled: true,
  };
  if (state === 'unavailable') return {
    label: '重试后收藏当前文章',
    tooltip: '登录状态尚未同步，点击重试',
    disabled: false,
  };
  return {
    label: '收藏当前文章',
    tooltip: bookmarked ? '取消收藏' : '收藏文章',
    disabled: false,
  };
}

export function likeAuthPresentation(state: ConvexAuthControlState) {
  if (state === 'anonymous') return {label: '喜欢这篇文章', disabled: false};
  if (state === 'connecting') return {label: '喜欢这篇文章', disabled: true};
  if (state === 'unavailable') return {label: '重试后喜欢这篇文章', disabled: false};
  return {label: '喜欢这篇文章', disabled: false};
}
