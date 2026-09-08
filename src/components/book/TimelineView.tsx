import {Label} from '@heroui/react';
import {NativeSelect} from '@heroui-pro/react/native-select';
import {Timeline} from '@heroui-pro/react/timeline';
import type {TimelineItem} from './special-pages';
import './ContentSections.css';
import styles from './ContentSections.module.css';

export interface TimelineViewProps {
  items: TimelineItem[];
  years?: {label: string; value: string}[];
  selected?: string;
}

/** Render only on the server: authored HTML remains owned by Book's enhancements. */
export default function TimelineView({items, years = [], selected}: TimelineViewProps) {
  const year = years.find((item) => item.value === selected)?.label;

  return <section className={styles.section} data-content-collection="timeline" aria-label="时间线">
    <header className={styles.header} data-book-island>
      <div>
        <h1 className={styles.title}>Timeline</h1>
        <p className={styles.intro}>工作、学习与发现，按时间留下记录。</p>
      </div>
      {years.length > 0 && <NativeSelect className={styles.yearSelect} fullWidth>
        <Label htmlFor="timeline-year-select">时间线年份</Label>
        <NativeSelect.Trigger id="timeline-year-select" defaultValue={selected} data-timeline-year-select>
          {years.map((item) => <NativeSelect.Option key={item.value} value={item.value}>{item.label}</NativeSelect.Option>)}
          <NativeSelect.Indicator />
        </NativeSelect.Trigger>
      </NativeSelect>}
    </header>
    <p className={styles.count} data-book-island>{items.length} 组记录</p>
    <Timeline className={styles.timeline} aria-label={year ? `${year} 年记录` : '日期记录'}>
      {items.map((item, index) => <Timeline.Item className={styles.event} key={item.id || `${item.label}-${index}`} id={item.id}>
        <Timeline.Rail><Timeline.Marker /><Timeline.Connector /></Timeline.Rail>
        <Timeline.Content className={styles.eventContent}>
          <h2 className={styles.eventDate} data-book-island>
            <a href={item.id ? `#${item.id}` : undefined}>{/^\d{4}-\d{2}-\d{2}$/.test(item.label) ? <time dateTime={item.label}>{item.label}</time> : item.label}</a>
          </h2>
          <div className={styles.authored} data-timeline-entry dangerouslySetInnerHTML={{__html: item.html}} />
        </Timeline.Content>
      </Timeline.Item>)}
    </Timeline>
  </section>;
}
