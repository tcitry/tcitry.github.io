import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { once } from 'node:events';
import { readCorpus } from './lib/ai-search-corpus.mjs';
import { validateMessages } from '../worker/chat.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = path.join(root, 'dist');
const port = Number(process.env.BLOG_CHAT_PREVIEW_PORT || 4330);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid BLOG_CHAT_PREVIEW_PORT');
const origin = `http://127.0.0.1:${port}`;
const { documents } = await readCorpus(path.join(root, '.generated/ai-search'));
await stat(path.join(assets, 'chat/index.html'));
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const stopWords = new Set(['的', '了', '是', '有', '在', '中', '和', '与', '吗', '呢', '我', '想', '请', '介绍', '一下', '哪些', '什么', '如何', '怎样', '关于', '相关', '作者', '博客', '文章', '找出', '并', '概括', '要点']);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.xml': 'application/xml', '.txt': 'text/plain', '.wasm': 'application/wasm' };
const banner = `<aside role="note" data-local-chat-demo style="margin:16px 0;padding:12px 16px;border:1px solid #c7a24d;border-radius:10px;background:#fff8e5;color:#594311;font-size:14px;line-height:1.7"><strong>本地交互演示 · 未连接大模型</strong><br>从 ${documents.length} 篇本地公开文章中按关键词查找并展示原文摘录；逐字输出用于体验界面，不是 AI 生成或 Cloudflare AI Search 检索。可试试「Astro 博客迁移」或「前端测试」。</aside>`;

function bodyText(document) {
  return document.markdown.split(/来源类型：[^\n]*\n/).slice(1).join('\n')
    .replace(/(`{3,})[^\n]*\n[\s\S]*?\1/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '').replace(/\\([*_\[\]<>])/g, '$1');
}
const corpus = documents.map(document => ({ ...document, text: bodyText(document), titleSearch: `${document.title} ${document.url}`.toLowerCase() }));

function lookup(question) {
  const terms = [...new Set([...segmenter.segment(question.toLowerCase())].filter(part => part.isWordLike && !stopWords.has(part.segment)).map(part => part.segment))];
  if (!terms.length) return { sources: [], text: '这是本地界面演示。请输入具体主题，例如「Astro 博客迁移」或「前端测试」，查看文章摘录与出处。' };
  const ranked = corpus.map(document => {
    const text = document.text.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (document.titleSearch.includes(term) ? 15 : 0) + Math.min(3, text.split(term).length - 1), 0);
    return { document, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  const sources = ranked.map(({ document }, index) => ({ id: String(index + 1), title: document.title, url: document.url, sourceKind: document.sourceKind }));
  if (!ranked.length) return { sources, text: '本地关键词检索没有找到匹配文章。可以换一个更具体的技术名称；连接 Cloudflare 后才会使用语义检索与模型回答。' };
  const excerpts = ranked.map(({ document }, index) => {
    const paragraphs = document.text.split(/\n\s*\n/).map(value => value.trim()).filter(value => value.length > 40 && !/^\s*[#|]/.test(value));
    const best = paragraphs.map((text, order) => ({ text, order, score: terms.filter(term => text.toLowerCase().includes(term)).length }))
      .sort((a, b) => b.score - a.score || a.order - b.order)[0]?.text || document.text.trim();
    const excerpt = best.replace(/\s+/g, ' ').slice(0, 360);
    return `### ${document.title} [${index + 1}]\n\n> ${excerpt}${best.length > 360 ? '…' : ''}${document.sourceKind === 'ai-assisted' ? '\n\n这篇文章标记为 AI 对话整理。' : ''}`;
  });
  return { sources, text: '以下是**本地关键词检索**找到的公开文章摘录，尚未经过大模型归纳。\n\n' + excerpts.join('\n\n') };
}

function json(response, status, message) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ message }));
}

const server = createServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('x-robots-tag', 'noindex, nofollow');
  response.setHeader('x-content-type-options', 'nosniff');
  if (![new URL(origin).host, `localhost:${port}`].includes(request.headers.host)) return json(response, 403, 'Local preview only');
  try {
    const url = new URL(request.url, origin);
    if (url.pathname === '/api/chat') {
      if (request.method !== 'POST') return json(response, 405, 'Use POST');
      if (request.headers.origin && ![origin, `http://localhost:${port}`].includes(request.headers.origin)) return json(response, 403, 'Local preview only');
      if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return json(response, 415, 'Use JSON');
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 32_768) { request.resume(); return json(response, 413, '对话过长，请开始新对话。'); }
        chunks.push(chunk);
      }
      let messages;
      try { messages = validateMessages(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { return json(response, 400, '请输入有效问题，每次最多 2000 字。'); }
      const { sources, text } = lookup(messages.at(-1).content);
      response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
      const controller = new AbortController();
      response.once('close', () => controller.abort());
      const emit = async event => {
        if (!response.write(JSON.stringify(event) + '\n')) await once(response, 'drain', { signal: controller.signal });
      };
      try {
        await pause(350, undefined, { signal: controller.signal });
        await emit({ type: 'sources', sources });
        for (let index = 0; index < text.length; index += 10) {
          await emit({ type: 'text', text: text.slice(index, index + 10) });
          await pause(30, undefined, { signal: controller.signal });
        }
        await emit({ type: 'done' });
        response.end();
      } catch (error) { if (!controller.signal.aborted) throw error; }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, 'Use GET');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) return json(response, 400, 'Invalid path');
    let filename = path.resolve(assets, '.' + pathname);
    if (!filename.startsWith(assets + path.sep) && filename !== assets) return json(response, 403, 'Invalid path');
    let info;
    try { info = await stat(filename); } catch { return json(response, 404, 'Not found'); }
    if (info.isDirectory()) {
      if (!url.pathname.endsWith('/')) { response.writeHead(307, { location: url.pathname + '/' + url.search }); return response.end(); }
      filename = path.join(filename, 'index.html');
      try { info = await stat(filename); } catch { return json(response, 404, 'Not found'); }
    }
    if (!info.isFile()) return json(response, 404, 'Not found');
    const extension = path.extname(filename);
    response.setHeader('content-type', mime[extension] || 'application/octet-stream');
    if (request.method === 'HEAD') return response.end();
    if (extension === '.html') {
      let html = await readFile(filename, 'utf8');
      // Preview the existing build without mutating the sealed production files.
      html = html.replace(/<script\b[^>]*\bsrc=["']https:\/\/(?:www\.googletagmanager\.com|pagead2\.googlesyndication\.com|giscus\.app)["'\s\S]*?<\/script>/gi, '');
      html = html.replace('</head>', '<meta name="robots" content="noindex, nofollow"></head>');
      if (url.pathname === '/chat/') html = html.replace(/(<h1\b[^>]*>[\s\S]*?<\/h1>)/, '$1' + banner);
      return response.end(html);
    }
    createReadStream(filename).on('error', () => response.destroy()).pipe(response);
  } catch {
    if (!response.headersSent) json(response, 500, '本地预览出现错误，请检查启动终端。');
    else response.destroy();
  }
});
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use; set BLOG_CHAT_PREVIEW_PORT to another port.` : 'Could not start the local chat preview.'); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Local chat demo: ${origin}/chat/\n${documents.length} public articles; local keyword excerpts only. No Cloudflare or model calls.`));
