import Code from '@gravity-ui/icons/Code';
import CodePullRequest from '@gravity-ui/icons/CodePullRequest';
import FileText from '@gravity-ui/icons/FileText';
import Link from '@gravity-ui/icons/Link';
import Picture from '@gravity-ui/icons/Picture';
import Pin from '@gravity-ui/icons/Pin';
import Play from '@gravity-ui/icons/Play';
import Star from '@gravity-ui/icons/Star';
import {Card, Chip} from '@heroui/react';
import {NativeSelect} from '@heroui-pro/react/native-select';
import {Timeline} from '@heroui-pro/react/timeline';
import type {TimelineItem} from './special-pages';
import {getTimelinePresentation} from './timeline-presentation';
import './ContentSections.css';
import styles from './ContentSections.module.css';

export interface TimelineViewProps {
  items: TimelineItem[];
  years?: {label: string; value: string}[];
  selected?: string;
}

const eventIcons = {pinned: Pin, star: Star, repository: CodePullRequest, media: Play, image: Picture, code: Code, link: Link, note: FileText};

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
        <NativeSelect.Trigger id="timeline-year-select" aria-label="时间线年份" defaultValue={selected} data-timeline-year-select>
          {years.map((item) => <NativeSelect.Option key={item.value} value={item.value}>{item.label}</NativeSelect.Option>)}
          <NativeSelect.Indicator />
        </NativeSelect.Trigger>
      </NativeSelect>}
    </header>
    <p className={styles.count} data-book-island>{items.length} 组记录</p>
    <Timeline className={styles.timeline} axis="center" placement="end" size="sm" aria-label={year ? `${year} 年记录` : '日期记录'}>
      {items.map((item, index) => {
        const presentation = getTimelinePresentation(item);
        const Icon = eventIcons[presentation.kind];
        const content = <div className={styles.authored} data-timeline-entry dangerouslySetInnerHTML={{__html: item.html}} />;

        return <Timeline.Item className={styles.event} key={item.id || `${item.label}-${index}`} id={item.id} data-timeline-kind={presentation.kind} data-timeline-links-only={presentation.linksOnly}>
          <Timeline.Content className={styles.eventMeta} side="start" data-timeline-meta data-book-island>
            <h2 className={styles.eventDate}>
              <a href={item.id ? `#${item.id}` : undefined}>{presentation.weekday ? <time dateTime={item.label}>{item.label}</time> : item.label}</a>
            </h2>
            {!presentation.linksOnly && <>
              {presentation.weekday && <span className={styles.eventWeekday}>{presentation.weekday}</span>}
              <Chip className={styles.eventKind} size="sm" variant="soft">{presentation.label}</Chip>
              {presentation.linkCount > 0 && <span className={styles.eventLinks}>{presentation.linkCount} 个链接</span>}
            </>}
          </Timeline.Content>
          <Timeline.Marker className={styles.eventMarker} aria-hidden="true"><Icon /></Timeline.Marker>
          <Timeline.Content className={styles.eventContent} side="end" data-timeline-body>
            <Card className={styles.eventPanel} variant="transparent">{content}</Card>
          </Timeline.Content>
        </Timeline.Item>;
      })}
    </Timeline>
  </section>;
}
