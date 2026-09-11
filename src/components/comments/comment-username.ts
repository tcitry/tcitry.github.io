import {ConvexError} from 'convex/values';

export const COMMENT_USERNAME_MIN = 4;
export const COMMENT_USERNAME_MAX = 64;
// Clerk default username charset: Latin alphanumeric, underscore, hyphen.
export const COMMENT_USERNAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function normalizeCommentUsername(value: string) {
  return value.trim();
}

export function commentUsernameClientError(username: string) {
  if (!username) return '请先设置用户名，再发布评论。';
  if (username.length < COMMENT_USERNAME_MIN || username.length > COMMENT_USERNAME_MAX) {
    return `用户名须为 ${COMMENT_USERNAME_MIN}–${COMMENT_USERNAME_MAX} 个字符。`;
  }
  if (!COMMENT_USERNAME_PATTERN.test(username)) return '用户名只能包含字母、数字、下划线和连字符。';
  return '';
}

function clerkErrorItems(error: unknown): {code?: string; message?: string; longMessage?: string; meta?: {paramName?: string}}[] {
  if (typeof error !== 'object' || error === null || !('errors' in error) || !Array.isArray(error.errors)) return [];
  return error.errors.filter((item): item is {code?: string; message?: string; longMessage?: string; meta?: {paramName?: string}} => typeof item === 'object' && item !== null);
}

export function clerkUsernameErrorMessage(error: unknown) {
  const codes = clerkErrorItems(error).map(item => item.code ?? '');
  if (codes.some(code => code === 'form_identifier_exists' || code === 'form_username_exists')) {
    return '这个用户名已被使用，请换一个。';
  }
  if (codes.some(code => code.includes('length') || code === 'form_username_invalid_length' || code === 'form_param_length_too_short' || code === 'form_param_length_too_long')) {
    return `用户名须为 ${COMMENT_USERNAME_MIN}–${COMMENT_USERNAME_MAX} 个字符。`;
  }
  if (codes.some(code => code.includes('character') || code === 'form_username_invalid_character' || code === 'form_param_format_invalid' || code === 'form_username_invalid')) {
    return '用户名只能包含字母、数字、下划线和连字符。';
  }
  const detail = clerkErrorItems(error).map(item => item.longMessage || item.message).find(value => typeof value === 'string' && value.trim());
  if (detail) return detail;
  if (error instanceof Error && error.message.trim() && !clerkErrorItems(error).length) return error.message;
  return '用户名未能保存，请稍后重试。';
}

export function isUsernameUnavailableError(error: unknown) {
  return error instanceof ConvexError && typeof error.data === 'object' && error.data !== null &&
    'code' in error.data && error.data.code === 'USERNAME_UNAVAILABLE';
}

export function convexErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ConvexError && typeof error.data === 'object' && error.data !== null) {
    if ('kind' in error.data && error.data.kind === 'RateLimited') return '评论操作过于频繁，请稍后再试。';
    if ('message' in error.data && typeof error.data.message === 'string') return error.data.message;
  }
  return fallback;
}

type TokenOptions = {template?: 'convex'; skipCache?: boolean};

export async function refreshClerkConvexToken(
  getToken: (options?: TokenOptions) => Promise<string | null>,
  sessionClaims?: {aud?: unknown} | null,
) {
  try {
    if (sessionClaims?.aud === 'convex') return await getToken({skipCache: true});
    return await getToken({template: 'convex', skipCache: true});
  } catch {
    return null;
  }
}

export async function saveClerkUsername(options: {
  user: {update: (params: {username: string}) => Promise<unknown>};
  username: string;
  reloadSession?: () => Promise<unknown>;
  getToken: (options?: TokenOptions) => Promise<string | null>;
  sessionClaims?: {aud?: unknown} | null;
  refreshConvexToken?: (() => void) | null;
}) {
  const username = normalizeCommentUsername(options.username);
  const clientError = commentUsernameClientError(username);
  if (clientError) throw new Error(clientError);
  await options.user.update({username});
  await options.reloadSession?.();
  await refreshClerkConvexToken(options.getToken, options.sessionClaims);
  options.refreshConvexToken?.();
}
