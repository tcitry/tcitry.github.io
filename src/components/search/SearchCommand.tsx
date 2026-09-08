import {useEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {Command} from '@heroui-pro/react/command';
import {searchContent} from '../../lib/search-client';
import {loadRecentUpdates} from '../../lib/search-recent-client';
import type {SearchEntry, SearchResponse} from '../../lib/search-types';
import surfaceStyles from '../demos/DemoSurface.module.css';
import styles from './SearchCommand.module.css';
import './search-vendor.css';

const PAGE_SIZE = 8;
const acceptAll = () => true;
const sectionNames: Record<string, string> = {
  docs: '文档', posts: '文章', weekly: '周刊', links: '链接', about: '关于', timeline: '时间线',
};

interface Props {
  onClose: () => void;
}

interface ResultState extends SearchResponse {
  query: string;
  limit: number;
}

function SearchCommand({onClose}: Props) {
  const [recent, setRecent] = useState<SearchEntry[]>([]);
  const [recentState, setRecentState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [recentRetry, setRecentRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<ResultState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const compositionEndedAt = useRef(-Infinity);
  const requestVersion = useRef(0);
  const backdrop = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim();

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setRecentState('loading');
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    void loadRecentUpdates(controller.signal).then((entries) => {
      if (!active) return;
      setRecent(entries);
      setRecentState('ready');
    }).catch(() => { if (active) setRecentState('error'); })
      .finally(() => window.clearTimeout(timeout));
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [recentRetry]);

  const changeQuery = (value: string) => {
    if (value === query) return;
    // Invalidate immediately, before the next effect can cancel an older request.
    requestVersion.current += 1;
    setQuery(value);
    setLimit(PAGE_SIZE);
    setRetry(0);
    setResult(null);
    setFailed(false);
    setBusy(Boolean(value.trim()) && !composingRef.current);
  };

  useEffect(() => {
    const version = ++requestVersion.current;
    if (!normalizedQuery || composing) {
      setBusy(false);
      return;
    }
    setBusy(true);
    setFailed(false);
    const timer = window.setTimeout(() => {
      void searchContent(normalizedQuery, limit).then((response) => {
        if (requestVersion.current !== version) return;
        setResult({...response, query: normalizedQuery, limit});
        setBusy(false);
      }).catch(() => {
        if (requestVersion.current !== version) return;
        setFailed(true);
        setBusy(false);
      });
    }, limit === PAGE_SIZE && retry === 0 ? 150 : 0);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [query, limit, retry, composing]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      backdrop.current?.style.setProperty('--search-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
      backdrop.current?.style.setProperty('--search-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    };
    update();
    const frame = requestAnimationFrame(update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const activeResult = result?.query === normalizedQuery ? result : null;
  const entries = normalizedQuery ? activeResult?.results ?? [] : recent.slice(0, 6);
  const hasMore = Boolean(normalizedQuery && activeResult && activeResult.limit < activeResult.total);
  const status = composing ? '正在输入…'
    : busy ? (entries.length ? '正在加载更多…' : '正在搜索…')
    : failed ? '搜索暂时不可用，请重试。'
    : normalizedQuery ? `找到 ${activeResult?.total ?? 0} 条结果${hasMore ? `，已显示 ${entries.length} 条` : ''}`
    : recentState === 'loading' ? '正在加载最近更新…'
    : recentState === 'error' ? '最近更新暂时不可用，仍可输入关键词搜索。'
    : `最近更新 · ${entries.length} 篇`;
  const emptyMessage = composing ? '完成输入后即可搜索。'
    : busy ? '正在搜索…'
    : failed ? '暂时无法搜索，请稍后重试。'
    : normalizedQuery ? '没有找到匹配内容，试试其他关键词。'
    : recentState === 'loading' ? '正在加载最近更新…'
    : recentState === 'error' ? '暂时无法加载最近更新，可以重试或直接搜索。'
    : '暂无最近更新的文章。';

  return <Command>
    <Command.Backdrop
      ref={backdrop}
      isOpen
      isDismissable
      isKeyboardDismissDisabled={composing}
      onOpenChange={(open) => { if (!open) onClose(); }}
      className={`${surfaceStyles.surface} ${styles.backdrop}`}
      data-blog-search-command
      data-book-island
      data-pagefind-ignore
    >
      <Command.Container size="lg" className={styles.container}>
        <Command.Dialog
          aria-label="搜索博客"
          inputValue={query}
          onInputChange={changeQuery}
          filter={acceptAll}
          className={styles.dialog}
          data-search-dialog
          data-blog-command
          data-search-state={composing ? 'composing' : busy ? 'loading' : failed ? 'error' : normalizedQuery ? 'results' : recentState === 'loading' ? 'recent-loading' : recentState === 'error' ? 'recent-error' : 'recent'}
        >
          <Command.InputGroup aria-label="搜索博客" className={styles.inputGroup}>
            <Command.InputGroup.Prefix>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" />
              </svg>
            </Command.InputGroup.Prefix>
            <Command.InputGroup.Input
              aria-label="搜索博客"
              placeholder="search"
              enterKeyHint="search"
              autoComplete="off"
              className={styles.input}
              data-search-input
              data-blog-search-input
              data-search-composing={composing || undefined}
              onKeyDownCapture={(event) => {
                const native = event.nativeEvent;
                if (composingRef.current || native.isComposing || native.keyCode === 229
                  || (event.key === 'Enter' && performance.now() - compositionEndedAt.current < 50)) {
                  // Preserve IME input without activating a result or dismissing the dialog.
                  event.stopPropagation();
                }
              }}
              onCompositionStart={() => {
                composingRef.current = true;
                requestVersion.current += 1;
                setComposing(true);
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                compositionEndedAt.current = performance.now();
                setComposing(false);
                changeQuery(event.currentTarget.value);
              }}
            />
            <Command.InputGroup.ClearButton aria-label="清除搜索" isDisabled={!query} className={styles.clearButton} />
            <Command.InputGroup.Suffix>
              <button type="button" className={styles.close} aria-label="关闭搜索" onClick={onClose}>关闭</button>
            </Command.InputGroup.Suffix>
          </Command.InputGroup>

          <Command.List
            aria-label={normalizedQuery ? '搜索结果' : '最近更新'}
            aria-busy={busy || (!normalizedQuery && recentState === 'loading') || undefined}
            className={styles.list}
            data-search-results
            onAction={() => { queueMicrotask(onClose); }}
            renderEmptyState={() => <div className={styles.empty}>{emptyMessage}</div>}
          >
            {entries.length > 0 && <Command.Group heading={normalizedQuery ? '搜索结果' : '最近更新'}>
              {entries.map((entry) => {
                const date = entry.updated?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
                return <Command.Item key={entry.url} id={entry.url} href={entry.url} textValue={entry.title} aria-label={entry.title} className={styles.item} data-search-result data-blog-search-result>
                  <div className={styles.entry}>
                    <span className={styles.title}>{entry.title}</span>
                    {normalizedQuery && entry.excerpt && <span className={styles.excerpt}>{entry.excerpt}</span>}
                    {(entry.section || date) && <span className={styles.meta}>
                      {entry.section && <span>{sectionNames[entry.section] ?? entry.section}</span>}
                      {date && <time dateTime={entry.updated}>{date}</time>}
                    </span>}
                  </div>
                </Command.Item>;
              })}
            </Command.Group>}
          </Command.List>

          <Command.Footer className={styles.footer}>
            <span role="status" aria-live="polite" aria-atomic="true" className={styles.status} data-search-status>{status}</span>
            {failed ? <button type="button" className={styles.action} onClick={() => { setBusy(true); setRetry((value) => value + 1); }}>重试</button>
              : !normalizedQuery && recentState === 'error' ? <button type="button" className={styles.action} data-search-recent-retry onClick={() => { setRecentState('loading'); setRecentRetry((value) => value + 1); }}>重试最近更新</button>
              : hasMore ? <button type="button" className={styles.action} disabled={busy} onClick={() => { setBusy(true); setLimit((value) => value + PAGE_SIZE); }}>{busy ? '加载中…' : '加载更多'}</button>
                : <span className={styles.hint} aria-hidden="true">↑ ↓ 选择 · Enter 打开</span>}
          </Command.Footer>
        </Command.Dialog>
      </Command.Container>
    </Command.Backdrop>
  </Command>;
}

export interface SearchCommandController {
  open(): void;
  close(): void;
  destroy(): void;
}

/** The caller imports and mounts this module only on the first search request. */
export function mountSearchCommand(host: HTMLElement, onClose: () => void): SearchCommandController {
  const root = createRoot(host);
  let opened = false;
  let destroyed = false;
  let session = 0;

  const close = () => {
    if (!opened || destroyed) return;
    opened = false;
    session += 1;
    // Release the modal focus scope before the caller restores the trigger's focus.
    flushSync(() => root.render(null));
    onClose();
  };

  return {
    open() {
      if (opened || destroyed) return;
      opened = true;
      const current = ++session;
      root.render(<SearchCommand onClose={() => { if (session === current) close(); }} />);
    },
    close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      opened = false;
      session += 1;
      root.unmount();
    },
  };
}
