const siteHosts = new Set(['yindongliang.com', 'www.yindongliang.com', 'tcitry.github.io']);

/** Stable identifiers for explicitly marked Portfolio links; no query strings or labels. */
export function projectIdFromHref(href: string): string | undefined {
  try {
    const url = new URL(href, 'https://yindongliang.com');
    if (!['https:', 'http:'].includes(url.protocol)) return;
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'github.com' && parts.length >= 2) return `github/${parts[0]}/${parts[1]}`.toLowerCase();
    if (url.hostname === 'apps.apple.com') {
      const app = parts.find((part) => /^id\d+$/.test(part));
      if (app) return `appstore/${app.slice(2)}`;
    }
    if (siteHosts.has(url.hostname)) return `site/${parts.join('/') || 'home'}`;
    return `${url.hostname}/${parts.join('/')}`;
  } catch {
    return;
  }
}

/** Only recognize owned/contributed projects, never arbitrary outbound references. */
export function recognizedProject(href: string): string | undefined {
  const id = projectIdFromHref(href);
  if (id?.startsWith('github/tcitry/')) return id;
  if (id && ['appstore/6744550176', 'github/luojilab/django-mirage-field', 'github/cgfly/jeecf-cli'].includes(id)) return id;
}
