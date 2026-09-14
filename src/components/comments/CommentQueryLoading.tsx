import {useEffect, useState} from 'react';
import {Button, Spinner} from '@heroui/react';

/** Resubscribe just the waiting query; keep the composer and its draft mounted. */
export function useCommentQueryRetry() {
  const [attempt, setAttempt] = useState(0);
  const [skip, setSkip] = useState(false);
  useEffect(() => {
    if (!skip) return;
    // Give the skipped query a committed render so Convex releases its old
    // subscription before starting the next one. Cancel on account unmount.
    const timer = window.setTimeout(() => setSkip(false), 0);
    return () => window.clearTimeout(timer);
  }, [skip]);
  return {attempt, skip, retry: () => {setAttempt(value => value + 1); setSkip(true);}};
}

export default function CommentQueryLoading({label, errorLabel, retryLabel, onRetry}: {
  label: string; errorLabel: string; retryLabel: string; onRetry: () => void;
}) {
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 15_000);
    return () => window.clearTimeout(timer);
  }, []);
  return timedOut ? <div className="blog-comments__status blog-comments__status--error">
    <p role="alert">{errorLabel}</p>
    <Button size="sm" variant="outline" onPress={onRetry}>{retryLabel}</Button>
  </div> : <div className="blog-comments__status" role="status">
    <div className="blog-comments__status-label">
      <Spinner size="sm" color="current" /><span>{label}</span>
    </div>
    <div className="blog-comments__skeleton" aria-hidden="true">
      <span className="blog-comments__skeleton-line" />
      <span className="blog-comments__skeleton-line" />
      <span className="blog-comments__skeleton-line" />
    </div>
  </div>;
}
