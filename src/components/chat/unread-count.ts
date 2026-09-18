export const UNREAD_COUNT_CAP = 99;

export function formatUnreadCount(count: number) {
  return count > UNREAD_COUNT_CAP ? `${UNREAD_COUNT_CAP}+` : String(count);
}

export function unreadMessagesLabel(count: number | undefined) {
  if (!count) return '消息';
  return `消息（${formatUnreadCount(count)} 条未读）`;
}

export function unreadLauncherLabel(count: number | undefined) {
  if (!count) return '打开博客助手';
  return `打开博客助手（${formatUnreadCount(count)} 条未读）`;
}
