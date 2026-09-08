import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {clerkIssuerFromPublishableKey, normalizeClerkIssuer} from './clerk-issuer.mjs';
import {ChatError, handleChat} from '../../worker/chat.mjs';

export function withClerkSession(env, processEnv = process.env) {
  const issuer = normalizeClerkIssuer(processEnv.CLERK_JWT_ISSUER)
    || clerkIssuerFromPublishableKey(processEnv.PUBLIC_CLERK_PUBLISHABLE_KEY)
    || normalizeClerkIssuer(env?.CLERK_JWT_ISSUER)
    || clerkIssuerFromPublishableKey(env?.PUBLIC_CLERK_PUBLISHABLE_KEY);
  const key = processEnv.CLERK_JWT_KEY || env?.CLERK_JWT_KEY;
  return new Proxy(env ?? {}, {
    get(target, prop, receiver) {
      if (prop === 'CLERK_JWT_ISSUER') return issuer;
      if (prop === 'CLERK_JWT_KEY') return key;
      return Reflect.get(target, prop, receiver);
    },
  });
}

const configPath = fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url));
const referencesPath = fileURLToPath(new URL('../../.generated/ai-search/references.json', import.meta.url));

// Never log SDK error bodies: provider messages can contain account/session data.
function report(error) {
  const status = Number(error?.status ?? error?.statusCode);
  console.warn(`[blog-chat] Cloudflare connection failed${Number.isFinite(status) ? ` (HTTP ${status})` : ''}. Check Wrangler login or CLOUDFLARE_API_TOKEN permissions for this account (AI Search and Workers AI).`);
}

function requestBody(req) {
  // Canceling a Web reader must not destroy IncomingMessage's shared response
  // socket: oversized chunked requests still need to receive the handler's 413.
  let output;
  let settled = false;
  const detach = () => {
    req.removeListener('data', data);
    req.removeListener('end', ended);
    req.removeListener('aborted', aborted);
  };
  const data = chunk => {
    if (settled) return;
    output.enqueue(chunk);
    if (output.desiredSize <= 0) req.pause();
  };
  const ended = () => {
    if (settled) return;
    settled = true; detach(); output.close();
  };
  const failed = error => {
    if (settled) return;
    settled = true; detach(); output.error(error);
  };
  const aborted = () => failed(new DOMException('Stopped', 'AbortError'));
  return new ReadableStream({
    start(controller) {
      output = controller;
      req.pause();
      req.on('data', data);
      req.once('end', ended);
      req.once('aborted', aborted);
      req.once('error', failed);
      req.once('close', () => {
        if (!settled) aborted();
        req.removeListener('error', failed);
      });
    },
    pull() { if (!settled) req.resume(); },
    cancel() {
      settled = true; detach();
      if (!req.destroyed) req.resume();
    },
  });
}

/** Adapt the production handler to Node's HTTP streams without buffering answers. */
export function createChatMiddleware({getBindings, readReferences, onError = report}) {
  return (req, res, next) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname !== '/api/chat' && pathname !== '/api/chat/') return next();
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableFinished) controller.abort(); };
    req.once('aborted', disconnected);
    res.once('close', disconnected);
    void (async () => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
        else if (value !== undefined) headers.set(key, value);
      }
      const request = new Request(new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`), {
        method: req.method, headers, signal: controller.signal,
        ...(!['GET', 'HEAD'].includes(req.method) ? {body: requestBody(req), duplex: 'half'} : {}),
      });
      let references;
      try { references = await readReferences(); }
      catch {
        console.warn('[blog-chat] Missing article references. Run npm run prepare:content.');
        throw new ChatError('博客资料尚未准备完成，请稍后重试。', 503);
      }
      const response = await handleChat(request, async () => {
        try { return await getBindings(); }
        catch (error) {
          onError(error);
          throw new ChatError('博客助手尚未完成云端连接，请稍后重试。', 503);
        }
      }, references);
      if (request.body && !request.bodyUsed) await request.body.cancel();
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body), res, {signal: controller.signal});
      else res.end();
    })().catch(error => {
      if (controller.signal.aborted || res.destroyed) return;
      if (!res.headersSent) {
        res.writeHead(error instanceof ChatError ? error.status : 500, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
        res.end(JSON.stringify({message: error instanceof ChatError ? error.message : '博客助手暂时无法连接，请稍后重试。'}));
      } else res.destroy();
    }).finally(() => {
      req.removeListener('aborted', disconnected);
      res.removeListener('close', disconnected);
    });
  };
}

/** Local dev only; no extra application Worker or Gateway is deployed. */
export function blogChatDev() {
  let connection;
  let stopped = false;
  return {
    name: 'tcitry-blog-chat-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(createChatMiddleware({
        readReferences: async () => JSON.parse(await readFile(referencesPath, 'utf8')),
        getBindings: async () => {
          if (stopped) throw new Error('Development server closed');
          connection ??= import('wrangler').then(({getPlatformProxy}) => getPlatformProxy({
            configPath, remoteBindings: true, persist: false,
          })).then(async proxy => {
            if (stopped) { await proxy.dispose(); throw new Error('Development server closed'); }
            return proxy;
          }).catch(error => { connection = undefined; throw error; });
          return withClerkSession((await connection).env);
        },
      }));
      server.httpServer?.once('close', () => {
        stopped = true;
        void connection?.then(proxy => proxy.dispose()).catch(() => {});
      });
    },
  };
}
