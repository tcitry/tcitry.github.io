// Keep external links and existing redirect articles behaving as in Hugo.
const internalOrigins = new Set([location.origin, 'https://yindongliang.com', 'https://www.yindongliang.com', 'https://tcitry.github.io']);
document.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
  if (link.hasAttribute('target') || link.hasAttribute('download')) return;
  try { const destination = new URL(link.href, location.href); if (/^https?:$/.test(destination.protocol) && !internalOrigins.has(destination.origin)) { link.target = '_blank'; link.relList.add('noopener', 'noreferrer'); } } catch {}
});
const redirect = document.querySelector<HTMLElement>('[data-external-redirect]')?.dataset.externalRedirect;
if (redirect) { try { const destination = new URL(redirect, location.href); if (/^https?:$/.test(destination.protocol)) location.replace(destination.href); } catch {} }
