import * as Sentry from '@sentry/astro';
import {setupProjectAnalytics} from './src/scripts/project-analytics';

// The DSN is a public ingestion address. Upload credentials stay in build secrets.
if (import.meta.env.PUBLIC_SITE_ENV === 'production' && window.location.hostname === 'yindongliang.com') {
  Sentry.init({
    dsn: 'https://2d586cd4bb2209030ebb9bc1022f7da1@o721268.ingest.us.sentry.io/4512049347035136',
    environment: 'production',
    release: import.meta.env.PUBLIC_SENTRY_RELEASE,
    sendDefaultPii: false,
    integrations: [
      Sentry.breadcrumbsIntegration({ console: false }),
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
    ],
    sampleRate: 1,
    tracesSampleRate: 0.1,
    // This static site has no application API to receive distributed trace headers.
    tracePropagationTargets: [],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1,
    initialScope: { tags: { site: 'tcitry-blog' } },
    beforeSend(event) {
      event.tags = { ...event.tags, page_path: window.location.pathname };
      if (event.request?.url) event.request.url = withoutQuery(event.request.url);
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) {
        for (const key of ['url', 'from', 'to']) {
          if (typeof breadcrumb.data[key] === 'string') breadcrumb.data[key] = withoutQuery(breadcrumb.data[key]);
        }
      }
      return breadcrumb;
    },
  });
  setupProjectAnalytics();
}

function withoutQuery(value: string): string {
  try {
    const url = new URL(value, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}
