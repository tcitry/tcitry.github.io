import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {createChatMiddleware} from './lib/chat-dev.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const endpoint = '/api/internal/retrieve';
const headers = {'cache-control': 'no-store', 'x-content-type-options': 'nosniff'};

async function createCloudflareProxy(options) {
  // Wrangler must not print credentials or provider error bodies to this console.
  process.env.WRANGLER_LOG = 'none';
  process.env.WRANGLER_WRITE_LOGS = 'false';
  process.env.WRANGLER_SEND_METRICS = 'false';
  const {getPlatformProxy} = await import('wrangler');
  return getPlatformProxy(options);
}

/** A loopback-only JSON bridge; no assets, login routes or model API are served. */
export async function startRetrievalDev({directory = root, port = 4359, createProxy = createCloudflareProxy} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid retrieval port.');
  let secret;
  let references;
  try {
    secret = parseEnv(await readFile(path.join(directory, '.dev.vars'), 'utf8')).RAG_BRIDGE_SECRET;
  } catch { throw new Error('Missing local .dev.vars configuration.'); }
  if (typeof secret !== 'string' || !/^\S{32,512}$/u.test(secret)) {
    throw new Error('Set a random RAG_BRIDGE_SECRET of 32–512 non-whitespace characters in .dev.vars.');
  }
  try {
    references = JSON.parse(await readFile(path.join(directory, '.generated/ai-search/references.json'), 'utf8'));
    if (!Array.isArray(references.documents)) throw new Error();
  } catch { throw new Error('Missing article references. Run npm run prepare:content first.'); }

  let connection;
  let stopped = false;
  let closing;
  const bindings = {
    RAG_BRIDGE_SECRET: secret,
    BLOG_SEARCH: {async search(input) {
      if (stopped) throw new Error('Retrieval server closed.');
      // Authentication and input validation run before any remote connection.
      connection ??= Promise.resolve().then(() => createProxy({
        configPath: path.join(directory, 'wrangler.jsonc'), envFiles: ['.dev.vars'],
        remoteBindings: true, persist: false,
      })).catch(() => {connection = undefined; throw new Error('Cloud connection unavailable.');});
      const proxy = await connection;
      if (stopped) throw new Error('Retrieval server closed.');
      return proxy.env.BLOG_SEARCH.search(input);
    }},
  };
  const middleware = createChatMiddleware({
    getBindings: async () => bindings,
    readReferences: async () => references,
    onError: () => {},
  });
  const server = createServer((req, res) => {
    // Match the raw request target: queries, aliases and normalized paths fail closed.
    if (req.url !== endpoint) {req.resume(); res.writeHead(404, headers); res.end(); return;}
    if (req.method !== 'POST') {req.resume(); res.writeHead(405, {...headers, allow: 'POST'}); res.end(); return;}
    middleware(req, res, () => {res.writeHead(404, headers); res.end();});
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.timeout = 30_000;

  const close = () => closing ??= (async () => {
    stopped = true;
    await new Promise(resolve => {server.close(resolve); server.closeAllConnections();});
    const proxy = await connection?.catch(() => undefined);
    await proxy?.dispose();
  })();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {server.off('error', reject); resolve();});
    });
  } catch { await close(); throw new Error('Unable to listen on the local retrieval port.'); }
  return {origin: `http://127.0.0.1:${server.address().port}`, close};
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1]))) {
    throw new Error('Usage: npm run dev:retrieval -- --port 4359');
  }
  const service = await startRetrievalDev({port: args.length ? Number(args[1]) : 4359});
  console.log(`[rag-dev] Listening on ${service.origin}${endpoint}`);
  const stop = () => {void service.close().catch(() => {process.exitCode = 1;});};
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error('[rag-dev] Unable to start. Check .dev.vars RAG_BRIDGE_SECRET (32–512 non-whitespace characters), generated article references, and --port.');
    process.exitCode = 1;
  });
}
