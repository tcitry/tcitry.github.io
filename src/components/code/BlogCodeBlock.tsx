import {Component, memo, useLayoutEffect, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {CodeBlock} from '@heroui-pro/react/code-block';
import styles from '../demos/DemoSurface.module.css';
import './code-vendor.css';

export interface CodeEntry {
  id: number;
  code: string;
  language: string;
  target: HTMLElement;
  fallback: HTMLElement;
}

const BlogCodeBlock = memo(function BlogCodeBlock({entry}: {entry: CodeEntry}) {
  useLayoutEffect(() => {
    entry.fallback.hidden = true;
    entry.target.parentElement?.setAttribute('data-blog-code-ready', '');
    return () => {
      entry.fallback.hidden = false;
      entry.target.parentElement?.removeAttribute('data-blog-code-ready');
    };
  }, [entry]);
  return <CodeBlock className={styles.surface} data-book-island data-blog-pro-code>
    <CodeBlock.Header data-pagefind-ignore>
      <span className="text-xs text-muted">{entry.language}</span>
      <CodeBlock.CopyButton code={entry.code} aria-label="复制代码" />
    </CodeBlock.Header>
    <CodeBlock.Code code={entry.code} language={entry.language} theme="github-light" darkTheme="github-dark" />
  </CodeBlock>;
});

class CodeFallback extends Component<{entry: CodeEntry; children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch() { this.props.entry.fallback.hidden = false; }
  render() { return this.state.failed ? null : this.props.children; }
}

/** One React root per page; memoized portals share all framework/component chunks. */
export function createCodeMounts() {
  const host = document.createElement('div');
  host.dataset.blogCodeRoot = '';
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  const entries: CodeEntry[] = [];
  return {
    add(entry: CodeEntry) {
      entries.push(entry);
      root.render(entries.map((value) => createPortal(
        <CodeFallback entry={value}><BlogCodeBlock entry={value} /></CodeFallback>, value.target, String(value.id),
      )));
    },
    destroy() { root.unmount(); host.remove(); },
  };
}
