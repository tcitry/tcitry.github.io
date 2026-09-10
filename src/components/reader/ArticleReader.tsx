import {useId, useState} from 'react';
import {useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import surface from '../demos/DemoSurface.module.css';
import styles from './ReaderPanel.module.css';
import BookmarkButton from './BookmarkButton';
import './reader.css';

interface ArticleReaderProps {
  pathname: string;
  title: string;
}

export default function ArticleReader({pathname, title}: ArticleReaderProps) {
  const page = useQuery(api.reader.getPage, {pathname});
  const [tooltipContainer, setTooltipContainer] = useState<HTMLElement | null>(null);
  const titleId = useId();

  return <section ref={setTooltipContainer} className={`${surface.surface} ${styles.panel} ${styles.currentArticle}`} aria-label="文章收藏" data-reader-article data-book-island>
    <div className={styles.currentRow}>
      <div className={styles.currentText}>
        <div className={styles.currentLabel}>当前文章{page?.bookmarked && <span> · 已收藏</span>}</div>
        <p id={titleId} className={styles.currentTitle}>{title}</p>
      </div>
      <BookmarkButton pathname={pathname} title={title} tooltipContainer={tooltipContainer} describedBy={titleId} />
    </div>
  </section>;
}
