import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react';
import {useConvexAuth, useMutation, useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import {
  PROGRESS_MIN_DELTA,
  PROGRESS_MIN_INTERVAL_MS,
  articleProgress,
  flushProgress,
  noteProgress,
  readingProgressFrame,
  scrollOffsetForProgress,
  type ProgressSyncState,
} from './reading-progress';
import styles from './ReaderPanel.module.css';

function findArticle() {
  return document.querySelector<HTMLElement>('article.book-article, article.book-post');
}

function scrollParent(article: HTMLElement): HTMLElement | Window {
  let node = article.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const {overflowY} = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && node.scrollHeight > node.clientHeight + 1) return node;
    node = node.parentElement;
  }
  return window;
}

function isElementScroller(scroller: HTMLElement | Window): scroller is HTMLElement {
  return scroller instanceof HTMLElement;
}

function viewportHeight(scroller: HTMLElement | Window) {
  return isElementScroller(scroller) ? scroller.clientHeight : window.innerHeight;
}

function measure(article: HTMLElement, scroller: HTMLElement | Window) {
  const top = isElementScroller(scroller)
    ? article.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    : article.getBoundingClientRect().top;
  return articleProgress(top, article.offsetHeight, viewportHeight(scroller));
}

function scrollToRatio(article: HTMLElement, scroller: HTMLElement | Window, progress: number) {
  const offset = scrollOffsetForProgress(article.offsetHeight, viewportHeight(scroller), progress);
  if (!isElementScroller(scroller)) {
    window.scrollTo({top: window.scrollY + article.getBoundingClientRect().top + offset, behavior: 'auto'});
    return;
  }
  scroller.scrollTo({
    top: scroller.scrollTop + article.getBoundingClientRect().top - scroller.getBoundingClientRect().top + offset,
    behavior: 'auto',
  });
}

function scrollToStart(article: HTMLElement | null) {
  if (!article) {
    window.scrollTo({top: 0, behavior: 'auto'});
    return;
  }
  const scroller = scrollParent(article);
  if (!isElementScroller(scroller)) window.scrollTo({top: 0, behavior: 'auto'});
  else scroller.scrollTo({top: 0, behavior: 'auto'});
}

function quantize(progress: number) {
  return Math.round(progress * 100) / 100;
}

function shownBox(element: Element | null) {
  if (!(element instanceof HTMLElement)) return null;
  const style = getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return null;
  const box = element.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return null;
  return box;
}

function readProgressFrame() {
  const page = shownBox(document.querySelector('.book-page'));
  const header = shownBox(document.querySelector('.book-page > .book-header'));
  const obstacles = [...document.querySelectorAll('.book-brand, [data-sidebar-tools], .book-search')].flatMap(element => {
    const box = shownBox(element);
    return box ? [{left: box.left, right: box.right, top: box.top, bottom: box.bottom}] : [];
  });
  return readingProgressFrame({
    viewportWidth: window.innerWidth,
    page: page ? {left: page.left, right: page.right} : null,
    headerBottom: header && header.top <= 80 && header.bottom > 0 ? header.bottom : null,
    obstacles,
  });
}

function applyProgressFrame(node: HTMLElement) {
  const frame = readProgressFrame();
  node.style.top = `${frame.top}px`;
  node.style.left = `${frame.left}px`;
  node.style.right = `${frame.right}px`;
}

export default function ReadingProgress({pathname, title}: {pathname: string; title: string}) {
  const {isAuthenticated} = useConvexAuth();
  const saved = useQuery(api.reader.getReadingProgress, isAuthenticated ? {pathname} : 'skip');
  const setProgress = useMutation(api.reader.setReadingProgress);
  const [shown, setShown] = useState<number | null>(null);
  const [offerSkip, setOfferSkip] = useState(false);
  const labelId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const sync = useRef<ProgressSyncState>({lastSent: 0, lastSentAt: 0, pending: null});
  const acked = useRef(0);
  const shownRef = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const suppress = useRef(false);
  const ready = useRef(false);
  const peak = useRef(0);
  const decidedPath = useRef<string | null>(null);
  const failures = useRef(0);
  const mounted = useRef(true);
  const saveRef = useRef(setProgress);
  const pageRef = useRef({pathname, title});
  saveRef.current = setProgress;
  pageRef.current = {pathname, title};

  function clearTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function show(progress: number) {
    if (shownRef.current !== null && progress <= shownRef.current) return;
    shownRef.current = progress;
    setShown(progress);
  }

  function arm(waitMs: number) {
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const result = flushProgress(sync.current, Date.now());
      sync.current = result.state;
      if (result.send !== null) {
        show(result.send);
        void persist(result.send);
      }
    }, waitMs);
  }

  async function persist(progress: number) {
    const page = pageRef.current;
    try {
      const stored = await saveRef.current({pathname: page.pathname, title: page.title, progress});
      if (!mounted.current) return;
      failures.current = 0;
      acked.current = Math.max(acked.current, stored);
      if (sync.current.lastSent < stored) {
        const pending = sync.current.pending !== null && sync.current.pending > stored ? sync.current.pending : null;
        sync.current = {lastSent: stored, lastSentAt: sync.current.lastSentAt, pending};
        if (pending !== null) arm(PROGRESS_MIN_INTERVAL_MS);
      }
      show(Math.max(stored, sync.current.pending ?? stored));
    } catch {
      if (!mounted.current) return;
      failures.current += 1;
      const retry = Math.max(progress, sync.current.pending ?? 0, sync.current.lastSent);
      sync.current = {
        lastSent: acked.current,
        lastSentAt: Date.now(),
        pending: retry > acked.current ? retry : null,
      };
      if (sync.current.pending !== null && failures.current <= 2) arm(PROGRESS_MIN_INTERVAL_MS);
    }
  }

  function observe(progress: number) {
    const result = noteProgress(sync.current, quantize(progress), Date.now());
    sync.current = result.state;
    show(Math.max(result.state.lastSent, result.state.pending ?? 0));
    if (result.send !== null) {
      clearTimer();
      void persist(result.send);
    } else if (result.waitMs !== null) arm(result.waitMs);
  }

  const placed = isAuthenticated && saved !== undefined;
  useLayoutEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    let frame = 0;
    const syncFrame = () => applyProgressFrame(node);
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        syncFrame();
      });
    };
    syncFrame();
    const observer = new ResizeObserver(schedule);
    for (const element of document.querySelectorAll('.book-page, .book-page > .book-header, .book-menu, .book-menu-content, .book-toc')) observer.observe(element);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, {capture: true, passive: true});
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, {capture: true});
    };
  }, [offerSkip, pathname, placed]);

  useEffect(() => {
    mounted.current = true;
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => {
      mounted.current = false;
      clearTimer();
      history.scrollRestoration = previousRestoration;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    const onScroll = () => {
      const article = findArticle();
      if (!article) return;
      const progress = measure(article, scrollParent(article));
      if (progress > peak.current) peak.current = progress;
      if (!ready.current || suppress.current) return;
      observe(progress);
    };
    const onHide = () => {
      const result = flushProgress(sync.current, Date.now());
      sync.current = result.state;
      clearTimer();
      if (result.send !== null) void persist(result.send);
    };
    document.addEventListener('scroll', onScroll, {capture: true, passive: true});
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('scroll', onScroll, {capture: true});
      window.removeEventListener('pagehide', onHide);
      clearTimer();
    };
  }, [isAuthenticated, pathname]);

  useEffect(() => {
    if (!isAuthenticated || saved === undefined || decidedPath.current === pathname) return;
    decidedPath.current = pathname;
    clearTimer();
    ready.current = false;
    peak.current = 0;
    failures.current = 0;
    const savedProgress = saved.progress ?? 0;
    const quantizedSaved = quantize(savedProgress);
    acked.current = savedProgress;
    shownRef.current = null;
    setShown(null);
    setOfferSkip(false);
    const article = findArticle();
    const measured = article ? measure(article, scrollParent(article)) : 0;
    if (article && measured < PROGRESS_MIN_DELTA && savedProgress >= PROGRESS_MIN_DELTA) {
      const scroller = scrollParent(article);
      suppress.current = true;
      scrollToRatio(article, scroller, savedProgress);
      const restored = quantize(measure(article, scroller));
      sync.current = {lastSent: Math.max(quantizedSaved, restored), lastSentAt: Date.now(), pending: null};
      show(sync.current.lastSent);
      setOfferSkip(true);
      queueMicrotask(() => {suppress.current = false;});
      ready.current = true;
      return;
    }
    const best = Math.max(measured, peak.current);
    sync.current = {
      lastSent: quantizedSaved,
      lastSentAt: savedProgress > 0 ? Date.now() : 0,
      pending: null,
    };
    show(Math.max(quantizedSaved, quantize(best)));
    if (quantize(best) > sync.current.lastSent) observe(best);
    ready.current = true;
  }, [isAuthenticated, pathname, saved]);

  if (!isAuthenticated || saved === undefined) return null;
  const value = shown ?? saved.progress ?? 0;
  const percent = Math.round(value * 100);
  return <div ref={frameRef} className={styles.progress} data-reading-progress data-sentry-mask data-pagefind-ignore>
    <div className={styles.progressMeta}>
      <span id={labelId}>进度</span>
      <span>{percent}%</span>
    </div>
    <div className={styles.progressTrack} role="progressbar" aria-labelledby={labelId} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}%`}>
      <div className={styles.progressFill} style={{width: `${percent}%`}} />
    </div>
    {offerSkip && <Button size="sm" variant="outline" onPress={() => {
      setOfferSkip(false);
      scrollToStart(findArticle());
    }}>跳过本次</Button>}
  </div>;
}
