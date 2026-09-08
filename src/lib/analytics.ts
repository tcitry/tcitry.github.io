import {flush, getClient, metrics} from '@sentry/astro';

export type AnalyticsEvent = 'project_cta_view' | 'project_click' | 'demo_start'
  | 'search_open' | 'search_query' | 'search_result_click';
const events = new Set<AnalyticsEvent>(['project_cta_view', 'project_click', 'demo_start', 'search_open', 'search_query', 'search_result_click']);
const labels = new Set(['project_id', 'placement', 'demo_id', 'action', 'source']);
const startedDemos = new Set<string>();

export function analyticsEnabled(): boolean {
  if (typeof window === 'undefined' || import.meta.env.PUBLIC_SITE_ENV !== 'production'
    || window.location.hostname !== 'yindongliang.com') return false;
  const client = getClient();
  return Boolean(client?.getDsn()) && client?.getOptions().enabled !== false;
}

function pathname(value: string): string {
  try { return new URL(value, window.location.origin).pathname.slice(0, 512); }
  catch { return ''; }
}

/** Count behavior without search text, DOM text, user identity or URL parameters. */
export function trackEvent(name: AnalyticsEvent, attributes: Record<string, string | number | boolean> = {}): boolean {
  if (!analyticsEnabled() || !events.has(name)) return false;
  try {
    const safe: Record<string, string | number> = {site: 'tcitry-blog', page_path: pathname(window.location.href)};
    for (const [key, value] of Object.entries(attributes)) {
      if (labels.has(key) && typeof value === 'string' && /^[a-zA-Z0-9_./:%-]{1,200}$/.test(value)) safe[key] = value;
      if (key === 'target_path' && typeof value === 'string') safe[key] = pathname(value);
      if (key === 'result_count' && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) safe[key] = value;
    }
    metrics.count(name, 1, {attributes: safe});
    return true;
  } catch {
    // Telemetry must never interrupt a user's action or navigation.
    return false;
  }
}

/** First meaningful action per demo and document, including repeated island mounts. */
export function trackDemoStart(demoId: string, action: string): void {
  if (startedDemos.has(demoId)) return;
  if (trackEvent('demo_start', {demo_id: demoId, action})) startedDemos.add(demoId);
}

/** Start sending queued counters before navigation; never delay the navigation. */
export function flushAnalytics(): void {
  if (!analyticsEnabled()) return;
  try { void Promise.resolve(flush(2000)).catch(() => {}); } catch { /* Keep navigation available. */ }
}
