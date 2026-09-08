import {useEffect, useId, useRef, useState} from 'react';
import {Button, TextArea} from '@heroui/react';
import {useMutation, useQuery} from 'convex/react';
import {ConvexError} from 'convex/values';
import {api} from '../../../convex/_generated/api';
import {acknowledgeNote, beginNoteSave, createProgressReporter, failNoteSave, NOTE_MAX_LENGTH, noteHasConflict, readingProgress, receiveNote, resumeScrollY, type NoteDraft} from './reader-state';
import surface from '../demos/DemoSurface.module.css';
import styles from './ReaderPanel.module.css';
import './reader.css';

interface ArticleReaderProps {
  pathname: string;
  title: string;
}

function articlePosition() {
  const article = document.querySelector<HTMLElement>('#main-content article[data-pagefind-body]:is(.book-article, .book-post)');
  if (!article) return null;
  const rect = article.getBoundingClientRect();
  return {top: rect.top + window.scrollY, height: rect.height, viewportHeight: window.innerHeight};
}

function isTextInput(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'));
}

function isNoteConflict(error: unknown) {
  return error instanceof ConvexError && typeof error.data === 'object' && error.data !== null && 'code' in error.data && error.data.code === 'NOTE_CONFLICT';
}

export default function ArticleReader({pathname, title}: ArticleReaderProps) {
  const page = useQuery(api.reader.getPage, {pathname});
  const setBookmark = useMutation(api.reader.setBookmark);
  const saveNote = useMutation(api.reader.saveNote);
  const saveProgress = useMutation(api.reader.saveProgress);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [savingBookmark, setSavingBookmark] = useState(false);
  const [noteMessage, setNoteMessage] = useState('');
  const [noteError, setNoteError] = useState(false);
  const [bookmarkError, setBookmarkError] = useState('');
  const [progressError, setProgressError] = useState(false);
  const [resumeProgress, setResumeProgress] = useState<number | null>(null);
  const progressReporter = useRef<ReturnType<typeof createProgressReporter> | null>(null);
  const resumeCaptured = useRef(false);
  const dirty = Boolean(draft && draft.text !== draft.base.note);
  const conflict = Boolean(draft && noteHasConflict(draft));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const noteId = useId();
  const noteHelpId = useId();

  useEffect(() => {
    if (!page) return;
    setDraft((current) => receiveNote(current, {note: page.note, updatedAt: page.noteUpdatedAt}));
    if (!resumeCaptured.current) {
      resumeCaptured.current = true;
      setResumeProgress(page.progress);
    }
    progressReporter.current?.updateRemote(page.progress ?? 0);
  }, [page]);

  useEffect(() => {
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const warnBeforeSignout = (event: Event) => {
      if (dirtyRef.current && !window.confirm('私有笔记还有未保存的修改。退出后将丢失这些修改，仍要退出吗？')) event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    window.addEventListener('reader:before-signout', warnBeforeSignout);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      window.removeEventListener('reader:before-signout', warnBeforeSignout);
    };
  }, []);

  const ready = page !== undefined;
  useEffect(() => {
    if (!ready) return;
    const reporter = createProgressReporter({
      initialProgress: page?.progress ?? 0,
      save: (progress) => saveProgress({pathname, title, progress}),
      onError: () => setProgressError(true),
      onSaved: () => setProgressError(false),
    });
    progressReporter.current = reporter;
    let userIntentUntil = 0;
    const markScrollIntent = (event: Event) => {
      if (event.isTrusted && !isTextInput(event.target)) userIntentUntil = performance.now() + 2_000;
    };
    const markKeyIntent = (event: KeyboardEvent) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) markScrollIntent(event);
    };
    const markScrollbarIntent = (event: PointerEvent) => {
      if (event.clientX >= document.documentElement.clientWidth) markScrollIntent(event);
    };
    const recordScroll = () => {
      if (performance.now() > userIntentUntil || document.visibilityState !== 'visible') return;
      const position = articlePosition();
      if (position) reporter.observe(readingProgress(position, window.scrollY));
    };
    const flushWhenHidden = () => {if (document.visibilityState === 'hidden') void reporter.flush();};
    const flush = () => {void reporter.flush();};
    window.addEventListener('wheel', markScrollIntent, {passive: true});
    window.addEventListener('touchmove', markScrollIntent, {passive: true});
    window.addEventListener('keydown', markKeyIntent);
    window.addEventListener('pointerdown', markScrollbarIntent, {passive: true});
    window.addEventListener('scroll', recordScroll, {passive: true});
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      reporter.dispose();
      progressReporter.current = null;
      window.removeEventListener('wheel', markScrollIntent);
      window.removeEventListener('touchmove', markScrollIntent);
      window.removeEventListener('keydown', markKeyIntent);
      window.removeEventListener('pointerdown', markScrollbarIntent);
      window.removeEventListener('scroll', recordScroll);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flushWhenHidden);
    };
    // Subscription changes update the reporter without resetting its throttle or pending work.
  }, [ready, pathname, title, saveProgress]);

  async function toggleBookmark() {
    if (!page || savingBookmark) return;
    setSavingBookmark(true);
    setBookmarkError('');
    try {await setBookmark({pathname, title, bookmarked: !page.bookmarked});}
    catch {setBookmarkError('收藏未能保存，请稍后重试。');}
    finally {setSavingBookmark(false);}
  }

  async function submitNote(text: string) {
    if (!draft || savingNote || noteHasConflict(draft)) return;
    setSavingNote(true);
    setDraft((current) => current ? beginNoteSave(current) : current);
    setNoteError(false);
    setNoteMessage('');
    try {
      const saved = await saveNote({pathname, title, note: text, expectedUpdatedAt: draft.base.updatedAt});
      setDraft((current) => current ? acknowledgeNote(current, draft.text, saved) : receiveNote(null, saved));
      setNoteMessage(saved.note ? '笔记已保存。' : '笔记已清空。');
    } catch (error) {
      setDraft((current) => current ? failNoteSave(current) : current);
      setNoteError(true);
      setNoteMessage(isNoteConflict(error) ? '云端笔记已有更新。你的输入已保留，请对照最新版本后继续。' : '笔记未能保存，你的输入仍在当前页面。请稍后重试。');
    } finally {setSavingNote(false);}
  }

  function clearNote() {
    if (!draft || !window.confirm('清空这篇文章的私有笔记？当前未保存的修改也会移除。')) return;
    // Keep the previous text until the server confirms deletion.
    void submitNote('');
  }

  function continueReading() {
    const position = articlePosition();
    if (!position || resumeProgress === null) return;
    window.scrollTo({top: resumeScrollY(position, resumeProgress), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
    setResumeProgress(null);
  }

  return <section className={`${surface.surface} ${styles.panel}`} aria-label="个人阅读工具" data-reader-article data-book-island>
    <div className={styles.toolbar}>
      <Button size="sm" variant={page?.bookmarked ? 'secondary' : 'outline'} isDisabled={!page} isPending={savingBookmark} aria-pressed={Boolean(page?.bookmarked)} onPress={() => {void toggleBookmark();}}>{page?.bookmarked ? '已收藏' : '收藏这篇'}</Button>
      <Button size="sm" variant="ghost" isDisabled={!draft} aria-expanded={noteOpen} aria-controls={noteId} onPress={() => setNoteOpen(!noteOpen)}>私有笔记{dirty ? ' · 未保存' : page?.note ? ' · 已保存' : ''}</Button>
      {resumeProgress !== null && resumeProgress > 0 && resumeProgress < 100 && <Button size="sm" variant="ghost" onPress={continueReading}>继续阅读 · {resumeProgress}%</Button>}
      <span className={styles.muted}>{!page ? '读取个人记录…' : page.progress === 100 ? '已读完' : page.progress ? `已读 ${page.progress}%` : '滚动阅读后同步进度'}</span>
    </div>
    {bookmarkError && <div className={`${styles.message} ${styles.error}`} role="alert">{bookmarkError}</div>}
    {progressError && <div className={`${styles.message} ${styles.error}`} role="status">阅读进度暂未同步。<Button size="sm" variant="ghost" onPress={() => {void progressReporter.current?.flush();}}>重试</Button></div>}
    <div id={noteId} className={styles.note} hidden={!noteOpen}>
      <label className={styles.noteLabel} htmlFor={`${noteId}-input`}>这篇文章的私有笔记</label>
      <TextArea id={`${noteId}-input`} className={styles.textarea} value={draft?.text ?? ''} disabled={!draft || savingNote} maxLength={NOTE_MAX_LENGTH} rows={6} aria-describedby={noteHelpId} placeholder="记下你的想法、问题或下一步。" onChange={(event) => {
        const text = event.currentTarget.value;
        setDraft((current) => current ? {...current, text} : current);
        setNoteMessage('');
      }} />
      <div className={styles.noteFooter}>
        <span className={styles.muted} id={noteHelpId}>仅当前账号可见 · {draft?.text.length ?? 0} / {NOTE_MAX_LENGTH}</span>
        <div className={styles.toolbar}>
          <Button size="sm" isDisabled={!dirty || conflict} isPending={savingNote} onPress={() => {if (draft) void submitNote(draft.text);}}>保存笔记</Button>
          <Button size="sm" variant="ghost" isDisabled={!draft || (!draft.text && !draft.base.note) || savingNote || conflict} onPress={clearNote}>清空</Button>
        </div>
      </div>
      {conflict && draft && <div className={styles.conflict} role="alert">
        <div>另一个页面或设备更新了这篇笔记。你的草稿已保留，请对照云端内容调整输入。</div>
        <pre className={styles.remoteNote} aria-label="最新云端笔记">{draft.remote.note || '（云端笔记已清空）'}</pre>
        <Button size="sm" variant="secondary" isDisabled={savingNote} onPress={() => {
          setDraft((current) => current ? {...current, base: current.remote, remoteChanged: false} : current);
          setNoteMessage('已采用最新版本作为保存基础。请确认输入框中的合并结果，再保存。');
          setNoteError(false);
        }}>已对照，保留草稿继续编辑</Button>
      </div>}
      {noteMessage && <div className={`${styles.message} ${noteError ? styles.error : ''}`} role={noteError ? 'alert' : 'status'}>{noteMessage}</div>}
    </div>
  </section>;
}
