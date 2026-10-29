import {useEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react';
import {usePaginatedQuery, useMutation} from 'convex/react';
import {Segment} from '@heroui-pro/react/segment';
import {api} from '../../../convex/_generated/api';
import type {Id} from '../../../convex/_generated/dataModel';
import {formatReadingDate} from './reading-list';
import {
  annotationFilterType,
  annotationFilters,
  annotationTypeLabel,
  sameArticlePath,
  type AnnotationFilter,
  type AnnotationType,
} from './annotation-filters';
import {clearAnnotationDraft, readAnnotationDraft} from '../../scripts/annotation-draft.mjs';
import {focusAnnotation} from '../../scripts/annotation-paint.mjs';
import styles from './ReaderPanel.module.css';

const emptyCopy: Record<AnnotationFilter, string> = {
  all: '还没有划线、高亮或笔记。选中正文后，右下角头像会展开工具。',
  underline: '还没有划线。',
  highlight: '还没有高亮。',
  note: '还没有笔记。',
};

type NoteDraft = NonNullable<ReturnType<typeof readAnnotationDraft>>;

function readNoteDraft(): NoteDraft | null {
  try {
    const draft = readAnnotationDraft(window.sessionStorage);
    return draft?.type === 'note' ? draft : null;
  } catch {
    return null;
  }
}

function isFilter(value: string): value is AnnotationFilter {
  return annotationFilters.some(item => item.id === value);
}

export default function TextAnnotationsPanel({pathname = ''}: {pathname?: string}) {
  const [filter, setFilter] = useState<AnnotationFilter>('all');
  const [draft, setDraft] = useState<NoteDraft | null>(readNoteDraft);
  const [noteBody, setNoteBody] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const type = annotationFilterType(filter);
  const list = usePaginatedQuery(api.reader.listTextAnnotations, type ? {type} : {}, {initialNumItems: 20});
  const create = useMutation(api.reader.createTextAnnotation);
  const remove = useMutation(api.reader.deleteTextAnnotation);
  const currentPath = pathname || (typeof window === 'undefined' ? '' : window.location.pathname);
  const loading = list.status === 'LoadingFirstPage';

  useEffect(() => {
    const sync = () => setDraft(readNoteDraft());
    document.addEventListener('blog:annotation-draft', sync);
    return () => document.removeEventListener('blog:annotation-draft', sync);
  }, []);

  function discardDraft() {
    try { clearAnnotationDraft(window.sessionStorage); } catch { /* ignore */ }
    setDraft(null);
    setNoteBody('');
    setError('');
  }

  async function saveNote() {
    if (!draft || savingRef.current) return;
    const note = noteBody.trim();
    if (!note) { setError('请先写下笔记内容。'); return; }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await create({
        pathname: draft.pathname,
        title: draft.title,
        type: 'note',
        quote: draft.quote,
        prefix: draft.prefix,
        suffix: draft.suffix,
        note,
      });
      discardDraft();
    } catch {
      setError('笔记未能保存，请稍后重试。');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function deleteAnnotation(id: Id<'textAnnotations'>) {
    setError('');
    try { await remove({id}); }
    catch { setError('未能删除，请稍后重试。'); }
  }

  return <section className={styles.panel} aria-label="笔记" aria-busy={loading} data-text-annotations data-annotation-filter={filter} data-sentry-mask data-pagefind-ignore>
    <div className={styles.filters}>
      <Segment aria-label="笔记分类" size="sm" selectedKey={filter} onSelectionChange={key => {
        const next = String(key);
        if (isFilter(next)) setFilter(next);
      }}>
        {annotationFilters.map(item => <Segment.Item key={item.id} id={item.id}>{item.label}</Segment.Item>)}
      </Segment>
    </div>
    {draft && <form className={styles.composer} data-annotation-composer onSubmit={event => { event.preventDefault(); void saveNote(); }}>
      <p className={styles.composerLabel}>写笔记</p>
      <blockquote className={styles.quote}>{draft.quote}</blockquote>
      <textarea value={noteBody} maxLength={4000} rows={4} placeholder="写下想记住的内容" aria-label="笔记内容" onChange={event => setNoteBody(event.target.value)} />
      <div className={styles.rowActions}>
        <Button size="sm" type="submit" isPending={saving} onPress={() => { void saveNote(); }}>保存笔记</Button>
        <Button size="sm" variant="ghost" onPress={discardDraft}>取消</Button>
      </div>
    </form>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading
      ? <p className={styles.message} role="status">正在读取笔记…</p>
      : <>
        {list.results.length === 0
          ? <p className={styles.empty}>{emptyCopy[filter]}</p>
          : <ul className={styles.list} data-annotation-list>
            {list.results.map(item => {
              const here = sameArticlePath(currentPath, item.pathname);
              const label = annotationTypeLabel(item.type as AnnotationType);
              return <li key={item.id} className={styles.item}>
                <div className={styles.annotationRow}>
                  <a className={styles.itemLink} href={`${item.pathname}#annotation-${encodeURIComponent(item.id)}`}
                    onClick={event => {
                      if (here && focusAnnotation(item.id)) event.preventDefault();
                    }}>
                    <span className={styles.quote}>{item.quote}</span>
                    {item.note ? <span className={styles.noteBody}>{item.note}</span> : null}
                    <span className={styles.itemMeta}>{label}{here ? ' · 本页' : ` · ${item.title}`} · {formatReadingDate(item.updatedAt)}</span>
                  </a>
                  <Button className={styles.remove} size="sm" variant="ghost" aria-label={`删除这条${label}`} onPress={() => { void deleteAnnotation(item.id); }}>删除</Button>
                </div>
              </li>;
            })}
          </ul>}
        {(list.status === 'CanLoadMore' || list.status === 'LoadingMore') && <Button className={styles.loadMore} size="sm" variant="outline" isPending={list.status === 'LoadingMore'} onPress={() => list.loadMore(20)}>加载更多</Button>}
      </>}
  </section>;
}
