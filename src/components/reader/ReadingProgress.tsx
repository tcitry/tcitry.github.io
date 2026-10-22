import {useEffect, useState} from 'react';
import {articleProgress} from './reading-progress';
import styles from './ReaderPanel.module.css';

// Hairline fill fixed over the viewport top. It does not take document-flow
// height. The fill is the current scroll ratio of the article in this
// viewport. Percent stays on the progressbar for assistive tech; nothing else
// is painted. Saved reading progress is not read or written here.

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

export default function ReadingProgress() {
  const [ratio, setRatio] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const article = findArticle();
        setRatio(article ? measure(article, scrollParent(article)) : 0);
      });
    };
    update();
    document.addEventListener('scroll', update, {capture: true, passive: true});
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('scroll', update, {capture: true});
      window.removeEventListener('resize', update);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const percent = Math.round(ratio * 100);
  return <div className={styles.progress} data-reading-progress data-sentry-mask data-pagefind-ignore>
    <div className={styles.progressTrack} role="progressbar" aria-label="进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}%`}>
      <div className={styles.progressFill} style={{width: `${ratio * 100}%`}} />
    </div>
  </div>;
}
