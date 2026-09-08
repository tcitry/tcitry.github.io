import {Button, Card, Chip, Label} from '@heroui/react';
import {ItemCard} from '@heroui-pro/react/item-card';
import {NativeSelect} from '@heroui-pro/react/native-select';
import type {PortfolioItem} from './special-pages';
import {projectIdFromHref} from '../../lib/project-analytics';
import './ContentSections.css';
import styles from './ContentSections.module.css';

export default function PortfolioView({items}: {items: PortfolioItem[]}) {
  const tags = [...new Set(items.flatMap((item) => item.tags || []))].sort((a, b) => a.localeCompare(b));

  return <section className={styles.section} data-content-collection="portfolio" data-pagefind-body>
    <header className={styles.header} data-book-island>
      <div>
        <h1 className={styles.title}>Portfolio</h1>
        <p className={styles.intro}>做过的应用、工具与开源项目。</p>
      </div>
      <Chip size="sm" variant="soft"><Chip.Label>{items.length} 个项目</Chip.Label></Chip>
    </header>

    <ItemCard className={styles.summary} variant="secondary" data-book-island>
      <ItemCard.Content>
        <ItemCard.Title className={styles.summaryText}>从想法到作品</ItemCard.Title>
        <ItemCard.Description className={styles.summaryText}>按时间倒序记录，保留项目介绍、技术标签和相关链接。</ItemCard.Description>
      </ItemCard.Content>
    </ItemCard>

    <div className={`${styles.header} ${styles.filter}`} data-book-island data-pagefind-ignore>
      <NativeSelect className="w-full max-w-[18rem]" fullWidth>
        <Label htmlFor="portfolio-tag-filter">按技术标签筛选</Label>
        <NativeSelect.Trigger id="portfolio-tag-filter" defaultValue="" data-portfolio-filter>
          <NativeSelect.Option value="">全部项目</NativeSelect.Option>
          {tags.map((value) => <NativeSelect.Option key={value} value={value}>{value}</NativeSelect.Option>)}
          <NativeSelect.Indicator />
        </NativeSelect.Trigger>
      </NativeSelect>
      <div className={styles.controls}>
        <span className={styles.count} role="status" aria-live="polite" data-portfolio-count>显示 {items.length} / {items.length} 个项目</span>
        <span hidden data-portfolio-clear-wrapper><Button size="sm" variant="ghost" data-portfolio-clear>清除筛选</Button></span>
      </div>
    </div>

    <div className={styles.projects}>
      {items.map((item, index) => <div key={`${item.href}-${index}`} className={styles.project} data-portfolio-tags={JSON.stringify(item.tags || [])}>
        <Card className={styles.projectCard}>
          <Card.Header data-book-island>
            <span className={styles.projectPeriod}>{item.period}</span>
            <h2 className={styles.projectTitle}><a href={item.href} data-analytics-project={projectIdFromHref(item.href)} data-analytics-placement="portfolio_title" target={item.target} rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}>{item.label}</a></h2>
          </Card.Header>
          {item.imageHTML && <div className={styles.projectImage} dangerouslySetInnerHTML={{__html: item.imageHTML}} />}
          {!!item.tags?.length && <div className={styles.tags} data-book-island>
            {item.tags.map((value) => <Chip key={value} size="sm" variant="soft"><Chip.Label>{value}</Chip.Label></Chip>)}
          </div>}
          <Card.Content className={styles.details}>
            {(item.detailsHTML || []).map((html, detailIndex) => <div className={`markdown ${styles.authored}`} key={detailIndex} dangerouslySetInnerHTML={{__html: html}} />)}
          </Card.Content>
          <Card.Footer className={styles.projectFooter} data-book-island>
            <a href={item.href} data-analytics-project={projectIdFromHref(item.href)} data-analytics-placement="portfolio_footer" target={item.target} rel={item.target === '_blank' ? 'noopener noreferrer' : undefined} className={styles.projectLink} aria-label={`查看项目：${item.label}`}>查看项目 <span aria-hidden="true">↗</span></a>
          </Card.Footer>
        </Card>
      </div>)}
    </div>
    <noscript><p className={styles.intro}>当前显示全部项目；启用 JavaScript 后可按技术标签筛选。</p></noscript>
  </section>;
}
