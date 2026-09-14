import {Button} from '@heroui/react';
import {AUTH_SYNC_RETRY, AUTH_SYNC_UNAVAILABLE} from './convex-auth-control';

export default function AuthSyncRetry({
  onRetry,
  message = AUTH_SYNC_UNAVAILABLE,
}: {
  onRetry: () => void;
  message?: string;
}) {
  return <div className="blog-chat__auth-status">
    <p role="alert">{message}</p>
    <Button size="sm" variant="outline" onPress={onRetry}>{AUTH_SYNC_RETRY}</Button>
  </div>;
}
