import Calendar from '@gravity-ui/icons/Calendar';
import CircleLetterX from '@gravity-ui/icons/CircleLetterX';
import Code from '@gravity-ui/icons/Code';
import CodePullRequest from '@gravity-ui/icons/CodePullRequest';
import FileText from '@gravity-ui/icons/FileText';
import Link from '@gravity-ui/icons/Link';
import Picture from '@gravity-ui/icons/Picture';
import Pin from '@gravity-ui/icons/Pin';
import Play from '@gravity-ui/icons/Play';
import SquareArticle from '@gravity-ui/icons/SquareArticle';
import Star from '@gravity-ui/icons/Star';
import {Card, Chip} from '@heroui/react';
import {ChatSource, ChatSources} from '@heroui-pro/react/chat-source';
import {NativeSelect} from '@heroui-pro/react/native-select';
import {Timeline} from '@heroui-pro/react/timeline';
import type {TimelineItem} from './special-pages';
import {getTimelinePresentation, hubLinkLabel, splitHubRelatedReading, timelineFaviconUrl, type TimelineKind, type TimelineRelatedSource} from './timeline-presentation';
import './ContentSections.css';
import styles from './ContentSections.module.css';

export interface TimelineViewProps {
  items: TimelineItem[];
  years?: {label: string; value: string}[];
  selected?: string;
}

function RelatedReading({sources}: {sources: TimelineRelatedSource[]}) {
  if (sources.length === 0) return null;
  return <div className={styles.related} data-timeline-related="">
    <p className={styles.relatedLabel}>关联阅读</p>
    <ChatSources className={styles.relatedSources} defaultExpanded>
      <ChatSources.Trigger>{sources.length} 条关联</ChatSources.Trigger>
      <ChatSources.Content>
        <ChatSources.List>
          {sources.map((source, index) => <ChatSource
            key={`${source.href}-${index}`}
            href={source.href}
            title={source.title}
            description={source.description}
            faviconUrl={timelineFaviconUrl(source.href)}
            enablePreview={false}
          >
            <ChatSource.Trigger>
              <ChatSource.Icon />
              <span className={styles.relatedSourceCopy}>
                <ChatSource.Title />
                {source.description ? <span className={styles.relatedSourceNote}>{source.description}</span> : null}
              </span>
            </ChatSource.Trigger>
          </ChatSource>)}
        </ChatSources.List>
      </ChatSources.Content>
    </ChatSources>
  </div>;
}

const eventIcons: Record<TimelineKind, typeof Pin> = {
  pinned: Pin, star: Star, x: CircleLetterX, publish: SquareArticle, weekly: Calendar,
  repository: CodePullRequest, media: Play, image: Picture, code: Code, link: Link, note: FileText,
};

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
        const reading = presentation.hub ? splitHubRelatedReading(item.html) : undefined;
        const content = <div className={styles.authored} data-timeline-entry dangerouslySetInnerHTML={{__html: reading?.html ?? item.html}} />;
        const linkLabel = presentation.hub
          ? hubLinkLabel(presentation.publishCount ?? 0, presentation.relatedCount ?? 0)
          : presentation.linkCount > 0 ? `${presentation.linkCount} 个链接` : undefined;

        return <Timeline.Item className={styles.event} key={item.id || `${item.label}-${index}`} id={item.id} data-timeline-kind={presentation.kind} data-timeline-links-only={presentation.linksOnly} data-timeline-hub={presentation.hub}>
          <Timeline.Content className={styles.eventMeta} side="start" data-timeline-meta data-book-island>
            <h2 className={styles.eventDate}>
              <a href={item.id ? `#${item.id}` : undefined}>{presentation.weekday ? <time dateTime={item.label}>{item.label}</time> : item.label}</a>
            </h2>
            {!presentation.linksOnly && <>
              {presentation.weekday && <span className={styles.eventWeekday}>{presentation.weekday}</span>}
              <Chip className={styles.eventKind} size="sm" variant="soft">{presentation.label}</Chip>
              {linkLabel && <span className={styles.eventLinks}>{linkLabel}</span>}
            </>}
          </Timeline.Content>
          <Timeline.Marker className={styles.eventMarker} aria-hidden="true"><Icon /></Timeline.Marker>
          <Timeline.Content className={styles.eventContent} side="end" data-timeline-body>
            <Card className={styles.eventPanel} variant="transparent">
              {content}
              {reading ? <RelatedReading sources={reading.sources} /> : null}
            </Card>
          </Timeline.Content>
        </Timeline.Item>;
      })}
    </Timeline>
  </section>;
}
