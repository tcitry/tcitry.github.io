import type {Id} from '../../../convex/_generated/dataModel';

export const commentImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const commentImageLimit = 5 * 1024 * 1024;
export type ImageTokenGetter = () => Promise<string | null>;

const uploadMessages = {
  CONFIGURATION: '图片服务暂时不可用，请稍后重试。',
  INVALID_FILE: '图片格式或内容不符合要求，请重新选择 JPEG、PNG、WebP 或 GIF 图片。',
  FILE_TOO_LARGE: '每张图片不能超过 5 MB，请缩小图片后重试。',
  UNAUTHENTICATED: '登录状态已过期，请重新登录后上传图片。',
  AUTH_UNAVAILABLE: '暂时无法确认登录状态，请稍后重试或重新登录。',
  FORBIDDEN: '图片服务暂时不允许上传，请稍后重试。',
  RATE_LIMITED: '图片上传过于频繁，请稍后重试。',
  TIMEOUT: '图片上传超时，请检查网络后重试。',
  NETWORK: '无法连接图片服务，请检查网络后重试。',
  INVALID_RESPONSE: '图片服务返回异常，请稍后重试。',
  UPLOAD_FAILED: '图片上传未完成，请稍后重试。',
  ABORTED: '上传已取消。',
} as const;

export class ImageUploadError extends Error {
  constructor(readonly code: keyof typeof uploadMessages) {
    super(uploadMessages[code]);
    this.name = 'ImageUploadError';
  }
}

function interruption(signal: AbortSignal) {
  return new ImageUploadError(signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED');
}

// A stalled token request must not keep a removed account's upload pending.
async function getUploadToken(getToken: ImageTokenGetter, signal: AbortSignal) {
  if (signal.aborted) throw interruption(signal);
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(interruption(signal));
    signal.addEventListener('abort', onAbort, {once: true});
  });
  try {
    return await Promise.race([Promise.resolve().then(getToken), aborted]);
  } catch (failure) {
    if (signal.aborted) throw interruption(signal);
    throw new ImageUploadError('AUTH_UNAVAILABLE');
  } finally {signal.removeEventListener('abort', onAbort);}
}

function rejectedUpload(status: number, result: unknown) {
  if (status === 401) return new ImageUploadError('UNAUTHENTICATED');
  if (status === 403) return new ImageUploadError('FORBIDDEN');
  if (status === 413) return new ImageUploadError('FILE_TOO_LARGE');
  if (status === 429) return new ImageUploadError('RATE_LIMITED');
  if (status === 400 && result && typeof result === 'object' && 'code' in result && result.code === 'INVALID_ARGUMENT') {
    return new ImageUploadError('INVALID_FILE');
  }
  return new ImageUploadError('UPLOAD_FAILED');
}

export function commentImageEndpoint(path: string) {
  const configured = import.meta.env.PUBLIC_CONVEX_SITE_URL?.trim();
  const deployment = import.meta.env.PUBLIC_CONVEX_URL ?? '';
  const origin = configured || (/^https:\/\/[a-z0-9-]+\.convex\.cloud\/?$/.test(deployment) ? deployment.replace('.convex.cloud', '.convex.site') : '');
  if (!origin) throw new ImageUploadError('CONFIGURATION');
  let url: URL;
  try {url = new URL(origin);} catch {throw new ImageUploadError('CONFIGURATION');}
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new ImageUploadError('CONFIGURATION');
  return new URL(path, url);
}

export async function uploadCommentImage(file: File, getToken: ImageTokenGetter, options: {purpose?: 'comment' | 'consultation'; signal?: AbortSignal} = {}): Promise<Id<'commentImages'>> {
  if (file.size > commentImageLimit) throw new ImageUploadError('FILE_TOO_LARGE');
  if (!commentImageTypes.includes(file.type) || file.size === 0) throw new ImageUploadError('INVALID_FILE');
  const endpoint = commentImageEndpoint('/comment-images/upload');
  if (options.purpose === 'consultation') endpoint.searchParams.set('purpose', options.purpose);
  const timeout = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const token = await getUploadToken(getToken, signal);
  if (signal.aborted) throw interruption(signal);
  if (!token) throw new ImageUploadError('UNAUTHENTICATED');
  let response: Response;
  try {
    response = await fetch(endpoint, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': file.type}, body: file, signal, redirect: 'error', credentials: 'omit'});
  } catch {
    throw signal.aborted ? interruption(signal) : new ImageUploadError('NETWORK');
  }
  let result: unknown;
  try {result = await response.json();}
  catch {
    if (signal.aborted) throw interruption(signal);
    throw response.ok ? new ImageUploadError('INVALID_RESPONSE') : rejectedUpload(response.status, null);
  }
  if (signal.aborted) throw interruption(signal);
  // Only known codes select local copy. Never expose arbitrary response messages.
  if (!response.ok) throw rejectedUpload(response.status, result);
  if (!result || typeof result !== 'object' || !('imageId' in result) || typeof result.imageId !== 'string' || !result.imageId.trim()) throw new ImageUploadError('INVALID_RESPONSE');
  return result.imageId as Id<'commentImages'>;
}
