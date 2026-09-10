import '../../src/styles/tailwind.css';
import {lazy, Suspense, useEffect, type LazyExoticComponent} from 'react';
import {flushSync} from 'react-dom';
import {createRoot, type Root} from 'react-dom/client';
import ServiceBoundary from '../../src/components/auth/ServiceBoundary';

// Real React and the production HeroUI boundary; only the failing child and
// connectivity events are controlled here. No auth, database or HTTP mock is
// needed because this fixture never instantiates those services.
type Mode = 'healthy' | 'transient' | 'persistent' | 'asset-failure';
type AssetErrorStyle = 'chromium' | 'webkit' | 'firefox';
type Options = {mode?: Mode; resetKey?: string; autoRetryDelayMs?: number; canClose?: boolean; assetErrorStyle?: AssetErrorStyle};
const privateError = 'fixture-private-service-detail';
const privateChunkURL = 'https://assets.example.com/_astro/private-fixture-chunk.js?session=fixture-secret';
const assetErrors = {
  chromium: `Failed to fetch dynamically imported module: ${privateChunkURL}`,
  webkit: `Importing a module script failed: ${privateChunkURL}`,
  firefox: `error loading dynamically imported module: ${privateChunkURL}`,
};
const stats = {caught: 0, renders: 0, mounts: 0, unmounts: 0, closes: 0, timerFired: 0, timerCleared: 0, lazyLoads: 0};
const warnings: unknown[][] = [];
const nativeWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(value => value instanceof Error ? {message: value.message, stack: value.stack} : value));
  nativeWarn(...args);
};
const bootId = crypto.randomUUID();
const trackedTimers = new Set<number>();
const nativeTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);
let options: Required<Options> = {mode: 'healthy', resetKey: 'view-a', autoRetryDelayMs: 347, canClose: true, assetErrorStyle: 'chromium'};
let failing = false;
let online = true;
let visibility: DocumentVisibilityState = 'visible';
let root: Root | undefined;
let LazyService: LazyExoticComponent<typeof Service> | undefined;
Object.defineProperty(navigator, 'onLine', {configurable: true, get: () => online});
Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => visibility});

// Observe the injected retry delay without replacing time or the callback. This
// lets the unmount regression distinguish clearing a timer from ignoring it.
window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
  if (delay !== options.autoRetryDelayMs || typeof handler !== 'function') return nativeTimeout(handler, delay, ...args);
  const id = nativeTimeout(() => {trackedTimers.delete(id); stats.timerFired++; handler(...args);}, delay);
  trackedTimers.add(id);
  return id;
}) as typeof window.setTimeout;
window.clearTimeout = (id?: number) => {
  if (id !== undefined && trackedTimers.delete(id)) stats.timerCleared++;
  nativeClearTimeout(id);
};

function Service() {
  stats.renders++;
  useEffect(() => {stats.mounts++; return () => {stats.unmounts++;};}, []);
  if (failing) throw new Error(privateError);
  return <section aria-label="服务内容"><p>连接已恢复</p><input aria-label="服务内草稿" defaultValue="新的服务实例" /></section>;
}

function render() {
  root ??= createRoot(document.getElementById('root')!, {onCaughtError(error) {
    if (!(error instanceof Error) || ![privateError, ...Object.values(assetErrors)].includes(error.message)) throw error;
    stats.caught++;
    if (options.mode === 'transient') failing = false;
  }});
  flushSync(() => root!.render(<ServiceBoundary
    resetKey={options.resetKey}
    autoRetryDelayMs={options.autoRetryDelayMs}
    onClose={options.canClose ? () => {stats.closes++; root?.unmount(); root = undefined;} : undefined}
  >{LazyService ? <Suspense fallback={<p role="status">正在加载功能</p>}><LazyService /></Suspense> : <Service />}</ServiceBoundary>));
}

Object.assign(window, {__serviceBoundary: {
  bootId,
  mount(next: Options = {}) {
    if (root) {flushSync(() => root?.unmount()); root = undefined;}
    Object.assign(stats, {caught: 0, renders: 0, mounts: 0, unmounts: 0, closes: 0, timerFired: 0, timerCleared: 0, lazyLoads: 0});
    warnings.length = 0;
    options = {mode: 'healthy', resetKey: 'view-a', autoRetryDelayMs: 347, canClose: true, assetErrorStyle: 'chromium', ...next};
    failing = options.mode !== 'healthy';
    // Keep this same lazy type across boundary retries. React itself caches the
    // rejected import promise, as it does for a missing deployed asset chunk.
    LazyService = options.mode === 'asset-failure' ? lazy(() => {
      stats.lazyLoads++;
      return Promise.reject(new TypeError(assetErrors[options.assetErrorStyle]));
    }) : undefined;
    render();
  },
  setFailure(value: boolean) {failing = value;},
  changeView(resetKey: string, mode: Mode = 'healthy') {
    options = {...options, resetKey, mode}; failing = mode !== 'healthy'; render();
  },
  rerender() {render();},
  connectivity(value: boolean) {online = value; window.dispatchEvent(new Event(value ? 'online' : 'offline'));},
  visibility(value: DocumentVisibilityState) {visibility = value; document.dispatchEvent(new Event('visibilitychange'));},
  unmount() {flushSync(() => root?.unmount()); root = undefined;},
  snapshot() {return {...stats, pendingTimers: trackedTimers.size, bootId, warnings: [...warnings]};},
}});
