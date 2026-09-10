import {Component, type ReactNode} from 'react';
import {Button} from '@heroui/react';
import styles from './ServiceBoundary.module.css';

type Props = {
  children: ReactNode;
  onClose?: () => void;
  resetKey?: string;
  autoRetryDelayMs?: number;
};

// Never include an error message, stack, query arguments or identity in logs.
export function serviceErrorCategory(error: unknown) {
  if (!(error instanceof Error)) return 'unknown';
  if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(error.message)) return 'asset_load_failed';
  if (error.message.includes('ConvexReactClient has already been closed')) return 'client_closed';
  if (error.name === 'ConvexError') return 'query_rejected';
  if (error.message.includes('[CONVEX Q(')) return 'query_failed';
  return 'render_failed';
}

/** A local render/query failure must not require a full-page reload. */
export default class ServiceBoundary extends Component<Props, {failed: boolean; category: ReturnType<typeof serviceErrorCategory> | null}> {
  state: {failed: boolean; category: ReturnType<typeof serviceErrorCategory> | null} = {failed: false, category: null};
  private mounted = false;
  private automaticRetries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  static getDerivedStateFromError(error: unknown) { return {failed: true, category: serviceErrorCategory(error)}; }

  componentDidMount() {
    this.mounted = true;
    window.addEventListener('online', this.resume);
    document.addEventListener('visibilitychange', this.resume);
  }

  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV) console.warn('[Account service] View failed.', {category: serviceErrorCategory(error)});
    // A disconnected Convex socket normally reconnects itself without throwing.
    // Only retry a caught error once, even if many browser events fire later.
    if (serviceErrorCategory(error) !== 'asset_load_failed' && this.automaticRetries === 0 && navigator.onLine !== false) {
      this.clearTimer();
      this.timer = setTimeout(this.automaticRetry, this.props.autoRetryDelayMs ?? 1000);
    }
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey) {
      this.clearTimer();
      this.automaticRetries = 0;
      if (this.state.failed) this.setState({failed: false, category: null});
    }
  }

  componentWillUnmount() {
    this.mounted = false;
    this.clearTimer();
    window.removeEventListener('online', this.resume);
    document.removeEventListener('visibilitychange', this.resume);
  }

  private clearTimer = () => { clearTimeout(this.timer); this.timer = undefined; };
  private retry = () => {
    this.clearTimer();
    if (this.mounted && this.state.failed) this.setState({failed: false, category: null});
  };
  private automaticRetry = () => {
    if (!this.mounted || !this.state.failed || this.state.category === 'asset_load_failed' || this.automaticRetries >= 1
        || navigator.onLine === false || document.visibilityState !== 'visible') return;
    this.automaticRetries += 1;
    this.retry();
  };
  private resume = () => {
    if (document.visibilityState === 'visible') this.automaticRetry();
  };

  render() {
    return this.state.failed ? <section className={styles.panel} data-service-boundary="failed" aria-label="服务连接提示">
      <div role="alert">
        <h2 className={styles.title}>此功能暂时无法打开</h2>
        <p className={styles.description}>{this.state.category === 'asset_load_failed'
          ? '页面内容可能已更新，请更新页面后重新打开此功能。'
          : '请稍后重试，或收起后继续阅读。'}</p>
      </div>
      <div className={styles.actions}>
        {this.state.category === 'asset_load_failed'
          ? <Button size="sm" variant="secondary" onPress={() => window.location.reload()}>更新页面</Button>
          : <Button size="sm" variant="secondary" onPress={this.retry}>重试</Button>}
        {this.props.onClose && <Button size="sm" variant="ghost" onPress={this.props.onClose}>关闭博客助手</Button>}
      </div>
    </section> : this.props.children;
  }
}
