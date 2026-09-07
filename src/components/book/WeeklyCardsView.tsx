import {useEffect, useState} from 'react';
import {Button, Card, Chip, Label, SearchField} from '@heroui/react';
import {EmptyState} from '@heroui-pro/react/empty-state';
import {ItemCard} from '@heroui-pro/react/item-card';
import type {WeeklyCardItem} from './special-pages';
import './ContentSections.css';
import styles from './ContentSections.module.css';

export default function WeeklyCardsView({items}: {items: WeeklyCardItem[]}) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const normalized = query.trim().toLocaleLowerCase();
  const matches = items.filter((item) => `${item.label} ${item.description || ''} ${item.dateLabel || ''}`.toLocaleLowerCase().includes(normalized));

  return <section className={styles.section} data-book-island data-content-collection="weekly" data-hydrated={hydrated} data-pagefind-body>
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>Weekly</h1>
        <p className={styles.intro}>每周的阅读、发现与生活切片。</p>
      </div>
      <Chip size="sm" variant="soft"><Chip.Label>本页 {items.length} 期</Chip.Label></Chip>
    </header>
    <ItemCard className={styles.summary} variant="secondary">
      <ItemCard.Icon aria-hidden="true">W</ItemCard.Icon>
      <ItemCard.Content>
        <ItemCard.Title className={styles.summaryText}>找一期想读的周刊</ItemCard.Title>
        <ItemCard.Description className={styles.summaryText}>按标题、封面说明或日期搜索，也可以切换为紧凑列表。</ItemCard.Description>
      </ItemCard.Content>
    </ItemCard>

    <div className={styles.header} data-pagefind-ignore>
      <SearchField className={styles.search} value={query} onChange={setQuery} isDisabled={!hydrated}>
        <Label>搜索本页周刊</Label>
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input placeholder="标题、封面说明或日期" />
          <SearchField.ClearButton aria-label="清除周刊搜索" />
        </SearchField.Group>
      </SearchField>
      <div className={styles.viewButtons} role="group" aria-label="周刊展示方式">
        <Button size="sm" variant={view === 'cards' ? 'secondary' : 'ghost'} aria-pressed={view === 'cards'} onPress={() => setView('cards')} isDisabled={!hydrated}>卡片</Button>
        <Button size="sm" variant={view === 'list' ? 'secondary' : 'ghost'} aria-pressed={view === 'list'} onPress={() => setView('list')} isDisabled={!hydrated}>列表</Button>
      </div>
    </div>
    <p className={`${styles.count} mb-4`} role="status" aria-live="polite" data-pagefind-ignore>显示 {matches.length} / {items.length} 期</p>

    {matches.length > 0 ? <div className={view === 'cards' ? styles.weeklyGrid : styles.weeklyList} data-weekly-view={view}>
      {matches.map((item) => <a className={`${styles.weeklyLink} weekly-card`} href={item.href} key={item.href}>
        {view === 'cards' ? <Card className={styles.weeklyCard}>
          <img className={styles.weeklyImage} src={item.image.src} alt={item.image.alt} loading="lazy" />
          <Card.Content className={styles.weeklyBody}>
            <h2 className={styles.weeklyTitle}>{item.label}</h2>
            {item.description && <p className={styles.weeklyDescription}>{item.description}</p>}
            <div className={styles.weeklyMeta}>
              {item.dateLabel && <time className={styles.count} dateTime={/^\d{4}\.\d{2}\.\d{2}$/.test(item.dateLabel) ? item.dateLabel.replaceAll('.', '-') : undefined}>{item.dateLabel}</time>}
              <span className="text-xs text-accent">阅读本期 <span aria-hidden="true">↗</span></span>
            </div>
          </Card.Content>
        </Card> : <ItemCard className={styles.weeklyRow} variant="transparent">
          <img className={styles.weeklyRowImage} src={item.image.src} alt={item.image.alt} loading="lazy" />
          <ItemCard.Content className={styles.weeklyRowContent}>
            <ItemCard.Title className={styles.weeklyRowTitle} role="heading" aria-level={2}>{item.label}</ItemCard.Title>
            {item.dateLabel && <time className={styles.count} dateTime={/^\d{4}\.\d{2}\.\d{2}$/.test(item.dateLabel) ? item.dateLabel.replaceAll('.', '-') : undefined}>{item.dateLabel}</time>}
            {item.description && <ItemCard.Description className={styles.weeklyRowDescription}>{item.description}</ItemCard.Description>}
          </ItemCard.Content>
        </ItemCard>}
      </a>)}
    </div> : <EmptyState className={styles.empty} data-pagefind-ignore>
      <EmptyState.Header>
        <EmptyState.Title>本页没有匹配的周刊</EmptyState.Title>
        <EmptyState.Description>换个关键词，或清除搜索后继续浏览。</EmptyState.Description>
      </EmptyState.Header>
      <EmptyState.Content><Button variant="secondary" onPress={() => setQuery('')}>清除搜索</Button></EmptyState.Content>
    </EmptyState>}
    <noscript><p className={styles.intro}>本页周刊已完整显示；启用 JavaScript 后可搜索和切换展示方式。</p></noscript>
  </section>;
}
