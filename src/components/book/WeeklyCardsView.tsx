import {Card, Chip} from '@heroui/react';
import type {WeeklyCardItem} from './special-pages';
import './ContentSections.css';
import styles from './ContentSections.module.css';

function dateTime(label?: string) {
  return label && /^\d{4}\.\d{2}\.\d{2}$/.test(label) ? label.replaceAll('.', '-') : undefined;
}

export default function WeeklyCardsView({items}: {items: WeeklyCardItem[]}) {
  return <section className={styles.section} data-book-island data-content-collection="weekly" data-pagefind-body>
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>Weekly</h1>
        <p className={styles.intro}>每周的阅读、发现与生活切片。</p>
      </div>
      <Chip size="sm" variant="soft"><Chip.Label>本页 {items.length} 期</Chip.Label></Chip>
    </header>
    <div className={styles.weeklyGrid}>
      {items.map((item) => <a className={`${styles.weeklyLink} weekly-card`} href={item.href} key={item.href}>
        <Card className={styles.weeklyCard}>
          <img className={styles.weeklyImage} src={item.image.src} alt={item.image.alt} loading="lazy" />
          <Card.Content className={styles.weeklyBody}>
            <h2 className={styles.weeklyTitle}>{item.label}</h2>
            {item.description && <p className={styles.weeklyDescription}>{item.description}</p>}
            <div className={styles.weeklyMeta}>
              {item.dateLabel && <time className={styles.count} dateTime={dateTime(item.dateLabel)}>{item.dateLabel}</time>}
              <span className="text-xs text-accent">阅读本期 <span aria-hidden="true">↗</span></span>
            </div>
          </Card.Content>
        </Card>
      </a>)}
    </div>
  </section>;
}
