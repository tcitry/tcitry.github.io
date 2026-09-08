import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTENT_DENIED, PUBLIC_SECTIONS, ROOT_PAGES } from '../legacy-content.mjs';
import { PUBLIC_DOWNLOADS } from '../public-downloads.mjs';

const siteRoot = fileURLToPath(new URL('../../', import.meta.url));
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

export function classifyBlogChange(relative) {
  const parts = relative.split(path.sep);
  if (parts.some(part => part.startsWith('.') || /^(?:private|node_modules)$/i.test(part))) return;
  if (ROOT_PAGES.has(relative)) return 'content';
  if (PUBLIC_SECTIONS.includes(parts[0]) && !parts.some(part => CONTENT_DENIED.test(part)) && /\.mdx?$/i.test(relative)) return 'content';
  if (PUBLIC_DOWNLOADS.includes(relative.split(path.sep).join('/'))) return 'assets';
  if (parts[0] === 'static' && (parts[1] === 'demos' || parts.length === 2 && /\.(?:avif|gif|ico|jpe?g|png|svg|webp|mp4|webm|mp3|ogg|pdf)$/i.test(relative))) return 'assets';
}

/** Coalesce saves, keep imports serial, and retain changes received during a run. */
export function createImportQueue({ run, onSuccess = () => {}, onError = () => {}, delay = 200 }) {
  const pending = new Set();
  const failed = new Set();
  const waiters = new Set();
  let timer, active, controller, closed = false;
  const settle = () => { for (const resolve of waiters) resolve(); waiters.clear(); };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(flush, delay); };
  async function flush() {
    if (active || closed || !pending.size) return;
    const batch = new Set(pending);
    pending.clear();
    controller = new AbortController();
    active = (async () => {
      try {
        await run(batch, controller.signal);
        if (!closed) await onSuccess(batch);
      } catch (error) {
        if (!closed) {
          for (const kind of batch) failed.add(kind);
          onError(error);
        }
      }
    })();
    await active;
    active = undefined;
    if (pending.size && !closed) {
      for (const kind of failed) pending.add(kind);
      failed.clear();
      schedule();
    }
    else settle();
  }
  return {
    enqueue(kind) {
      if (closed || !kind) return;
      for (const retry of failed) pending.add(retry);
      failed.clear();
      pending.add(kind);
      schedule();
    },
    whenIdle() { return active || pending.size ? new Promise(resolve => waiters.add(resolve)) : Promise.resolve(); },
    async close() {
      closed = true;
      clearTimeout(timer);
      pending.clear();
      failed.clear();
      controller?.abort();
      await active;
      settle();
    },
  };
}

function prepare(task, root, blogRoot, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', task], {
      cwd: root,
      env: { ...process.env, BLOG_DIR: blogRoot },
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    });
    const abort = () => {
      try {
        if (process.platform === 'win32') child.kill('SIGTERM');
        else if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch (error) { if (error.code !== 'ESRCH') reject(error); }
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.once('error', reject);
    child.once('close', code => {
      signal.removeEventListener('abort', abort);
      if (code === 0 && !signal.aborted) resolve();
      else reject(new Error(`${task} failed; fix the source and save again.`));
    });
  });
}

/** Reuse Vite's watcher without exposing BLOG_DIR through its file server. */
export function blogContentDev({ root = siteRoot, blogRoot = path.resolve(process.env.BLOG_DIR || path.join(homedir(), 'Blog')) } = {}) {
  let queue, detach;
  const generated = path.join(root, '.generated');
  const publicDir = path.join(root, 'astro-public');
  const staticDir = path.join(root, 'static');
  return {
    name: 'tcitry-blog-content-dev',
    apply: 'serve',
    configureServer(server) {
      queue = createImportQueue({
        async run(batch, signal) {
          server.config.logger.info('[blog-content] Importing saved changes…');
          if (batch.has('content')) await prepare('prepare:content', root, blogRoot, signal);
          if (batch.has('assets')) await prepare('prepare:assets', root, blogRoot, signal);
        },
        onSuccess(batch) {
          // JSON changes use Astro's HMR hook to invalidate SSR and dynamic routes.
          // Assets have no module import, so explicitly refresh after copying ends.
          if (batch.has('assets')) server.ws.send({ type: 'full-reload' });
          server.config.logger.info('[blog-content] Updated. Watching for changes.');
        },
        onError(error) { server.config.logger.error(`[blog-content] ${error.message}`); },
      });
      const changed = (event, file) => {
        if (!['add', 'change', 'unlink'].includes(event)) return;
        if (inside(blogRoot, file)) queue.enqueue(classifyBlogChange(path.relative(blogRoot, file)));
        else if (inside(staticDir, file)) queue.enqueue('assets');
      };
      server.watcher.add([
        ...PUBLIC_SECTIONS.map(section => path.join(blogRoot, section)),
        ...[...ROOT_PAGES, ...PUBLIC_DOWNLOADS, 'static'].map(file => path.join(blogRoot, file)),
        staticDir,
      ]);
      server.watcher.on('all', changed);
      detach = () => server.watcher.off('all', changed);
      // A reload or manual navigation must not read JSON/assets mid-import.
      server.middlewares.use((_req, _res, next) => { void queue.whenIdle().then(() => next(), next); });
      server.config.logger.info('[blog-content] Watching Blog Markdown and public assets.');
    },
    hotUpdate: {
      order: 'pre',
      async handler({ file }) {
        // Keep Vite's public-file registry up to date, but delay HMR until the
        // complete batch is ready. Astro then invalidates its own SSR runner.
        if (inside(generated, file) || inside(publicDir, file)) await queue?.whenIdle();
      },
    },
    async closeBundle() { detach?.(); await queue?.close(); },
  };
}
