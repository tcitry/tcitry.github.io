import type {CodeEntry} from '../components/code/BlogCodeBlock';

let cleanup: (() => void) | undefined;
let library: Promise<typeof import('../components/code/BlogCodeBlock')> | undefined;

function initializeBlogCode() {
  cleanup?.();
  const blocks = Array.from(document.querySelectorAll<HTMLElement>('#main-content [data-blog-code]'))
    .filter((block) => !block.closest('[data-demo], [data-book-island], .expressive-code'));
  if (!blocks.length) return;
  let stopped = false;
  let frame = 0;
  let loading = false;
  let mounts: ReturnType<typeof import('../components/code/BlogCodeBlock')['createCodeMounts']> | undefined;
  const pending = new Set<HTMLElement>();
  const mounted = new Set<HTMLElement>();
  const targets: HTMLElement[] = [];
  let id = 0;

  async function next() {
    frame = 0;
    if (stopped || loading || !pending.size) return;
    loading = true;
    try {
      // These portals also run on Markdown pages without an Astro React island,
      // where Astro does not inject React's development refresh initialization.
      if (import.meta.env.DEV) await import('@vitejs/plugin-react/preamble');
      library ??= import('../components/code/BlogCodeBlock');
      const module = await library;
      if (stopped || !pending.size) return;
      mounts ??= module.createCodeMounts();
      // One block per animation frame prevents long articles from mounting every fence at once.
      const block = pending.values().next().value!;
      pending.delete(block);
      const fallback = block.querySelector<HTMLElement>('[data-blog-code-fallback]');
      const pre = fallback?.querySelector('pre');
      if (fallback && pre && block.isConnected) {
        const target = document.createElement('div');
        block.appendChild(target); targets.push(target);
        const entry: CodeEntry = {id: id++, code: pre.textContent ?? '', language: block.dataset.blogCodeLanguage || 'text', fallback, target};
        mounts.add(entry); mounted.add(block); observer?.unobserve(block);
      }
    } catch (error) {
      // A failed chunk or component never removes the readable static code.
      if (import.meta.env.DEV) console.error('[blog-code] Could not load the Pro code renderer.', error);
      library = undefined; pending.clear();
    } finally {
      loading = false;
      if (!stopped && pending.size) frame = requestAnimationFrame(() => void next());
    }
  }
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver((changes) => {
    for (const {target, isIntersecting} of changes) {
      const block = target as HTMLElement;
      if (isIntersecting && !mounted.has(block)) pending.add(block);
      else pending.delete(block);
    }
    if (pending.size && !frame && !loading) frame = requestAnimationFrame(() => void next());
  }, {rootMargin: '300px 0px'}) : undefined;
  if (observer) blocks.forEach((block) => observer.observe(block));
  else { blocks.forEach((block) => pending.add(block)); frame = requestAnimationFrame(() => void next()); }
  cleanup = () => {
    stopped = true; observer?.disconnect(); cancelAnimationFrame(frame); pending.clear();
    mounts?.destroy(); targets.forEach((target) => target.remove());
  };
}

initializeBlogCode();
document.addEventListener('astro:page-load', initializeBlogCode);
document.addEventListener('astro:before-swap', () => cleanup?.());
