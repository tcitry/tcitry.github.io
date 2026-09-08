import {captureException, getClient, startSpan, withScope} from '@sentry/astro';

type Feature = 'search' | 'code';
type Operation = 'load' | 'recent_load' | 'query' | 'render' | 'render_recoverable';

function monitoringEnabled() {
  const client = getClient();
  return typeof window !== 'undefined' && Boolean(client) && client?.getOptions().enabled !== false;
}

function tags(feature: Feature, operation: Operation) {
  return {feature, operation, page_path: window.location.pathname};
}

/** Keep caught failures observable without attaching input, code, or component props. */
export function captureFeatureError(error: unknown, feature: Feature, operation: Operation) {
  if (!monitoringEnabled()) return;
  try {
    withScope((scope) => {
      scope.setTags(tags(feature, operation));
      captureException(error);
    });
  } catch {
    // A reporting failure must never prevent the existing UI fallback.
  }
}

/** Stable span names describe work, never the search term or code being processed. */
export function withFeatureSpan<T>(feature: Feature, operation: Operation, callback: () => T): T {
  if (!monitoringEnabled()) return callback();
  return startSpan({
    name: `blog.${feature}.${operation}`,
    op: `${feature}.${operation}`,
    attributes: tags(feature, operation),
  }, callback);
}
