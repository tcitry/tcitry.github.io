import {analyticsEnabled, flushAnalytics, trackEvent} from '../lib/analytics';
import {recognizedProject} from '../lib/project-analytics';

/** Called after Sentry initialization; all selectors describe public project links. */
export function setupProjectAnalytics(): void {
  if (!analyticsEnabled()) return;
  const start = () => {
    document.querySelectorAll<HTMLAnchorElement>('article.markdown a[href]').forEach((link) => {
      if (link.dataset.analyticsProject) return;
      const id = recognizedProject(link.href);
      if (!id) return;
      link.dataset.analyticsProject = id;
      link.dataset.analyticsPlacement = 'article_link';
    });

    const selector = 'a[data-analytics-project][data-analytics-placement]';
    const links = [...document.querySelectorAll<HTMLAnchorElement>(selector)];
    const viewed = new Set<string>();
    const timers = new Map<Element, number>();
    const attributes = (link: HTMLAnchorElement) => ({
      project_id: link.dataset.analyticsProject!, placement: link.dataset.analyticsPlacement!,
    });
    const key = (link: HTMLAnchorElement) => `${link.dataset.analyticsProject}|${link.dataset.analyticsPlacement}`;
    const cancel = (link: Element) => { window.clearTimeout(timers.get(link)); timers.delete(link); };
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const link = entry.target as HTMLAnchorElement;
        cancel(link);
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5 || document.visibilityState !== 'visible' || viewed.has(key(link))) continue;
        timers.set(link, window.setTimeout(() => {
          timers.delete(link);
          if (document.visibilityState !== 'visible' || viewed.has(key(link))) return;
          if (trackEvent('project_cta_view', attributes(link))) {
            viewed.add(key(link));
            observer?.unobserve(link);
          }
        }, 1000));
      }
    }, {threshold: [0, 0.5]});
    links.forEach((link) => observer?.observe(link));

    const clicked = (event: MouseEvent) => {
      if (!event.isTrusted || event.defaultPrevented || (event.type === 'click' ? event.button !== 0 : event.button !== 1)) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>(selector) : null;
      if (!link) return;
      trackEvent('project_click', {...attributes(link), target_path: link.href});
      flushAnalytics();
    };
    document.addEventListener('click', clicked);
    document.addEventListener('auxclick', clicked);
    document.addEventListener('visibilitychange', () => {
      for (const link of timers.keys()) cancel(link);
      if (document.visibilityState === 'hidden') flushAnalytics();
      else {
        // Re-evaluate entries after a background tab becomes visible.
        observer?.disconnect();
        links.filter((link) => !viewed.has(key(link))).forEach((link) => observer?.observe(link));
      }
    });
    window.addEventListener('pagehide', () => {
      for (const link of timers.keys()) cancel(link);
      flushAnalytics();
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
  else start();
}
