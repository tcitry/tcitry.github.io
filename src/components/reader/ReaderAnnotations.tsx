import {useEffect, useRef} from 'react';
import {useAuth, useClerk} from '@clerk/react';
import {useConvexAuth, useMutation, useQuery} from 'convex/react';
import {ConvexProviderWithClerk} from 'convex/react-clerk';
import {api} from '../../../convex/_generated/api';
import type {Id} from '../../../convex/_generated/dataModel';
import {openClerkSignIn} from '../auth/clerk-signin';
import useSessionConvexClient from '../auth/useSessionConvexClient';
import {
  clearAnnotationDraft,
  drainAnnotationSaves,
  enqueueAnnotationSave,
  parseAnnotationDraft,
  readAnnotationDraft,
  saveAnnotationDraft,
  subscribeAnnotationSaves,
  takeStoredMark,
} from '../../scripts/annotation-draft.mjs';
import {articleContentRoot, focusAnnotation, paintAnnotations} from '../../scripts/annotation-paint.mjs';

function announce(message: string) {
  const status = document.querySelector('[data-selection-status]');
  if (status) status.textContent = message;
}

function storage() {
  try { return window.sessionStorage; }
  catch { return null; }
}

function AnnotationIntent() {
  const {isLoaded, isSignedIn} = useAuth();
  const clerk = useClerk();
  const signedIn = Boolean(isLoaded && isSignedIn);
  const signedInRef = useRef(signedIn);
  const loadedRef = useRef(isLoaded);
  signedInRef.current = signedIn;
  loadedRef.current = isLoaded;

  useEffect(() => {
    const onAction = (event: Event) => {
      const draft = parseAnnotationDraft(event instanceof CustomEvent ? event.detail : null);
      if (!draft) return;
      const session = storage();
      if (!loadedRef.current || !signedInRef.current) {
        if (session) saveAnnotationDraft(session, {...draft, fresh: true});
        if (loadedRef.current && !signedInRef.current) {
          announce('登录后同步');
          openClerkSignIn(clerk);
        }
        return;
      }
      if (draft.type === 'note') {
        if (session) saveAnnotationDraft(session, {...draft, fresh: false});
        announce('在笔记里写下内容');
        document.dispatchEvent(new CustomEvent('blog:annotation-draft'));
        document.dispatchEvent(new CustomEvent('blog:open-assistant', {detail: {view: 'notes'}}));
        return;
      }
      enqueueAnnotationSave(draft);
    };
    document.addEventListener('blog:text-annotation', onAction);
    return () => document.removeEventListener('blog:text-annotation', onAction);
  }, [clerk]);

  useEffect(() => {
    if (!signedIn) return;
    const session = storage();
    if (!session) return;
    const draft = readAnnotationDraft(session);
    if (draft?.type === 'note' && draft.fresh) {
      saveAnnotationDraft(session, {...draft, fresh: false});
      document.dispatchEvent(new CustomEvent('blog:annotation-draft'));
      document.dispatchEvent(new CustomEvent('blog:open-assistant', {detail: {view: 'notes'}}));
      return;
    }
    const mark = takeStoredMark(session);
    if (mark) enqueueAnnotationSave(mark);
  }, [signedIn]);

  return null;
}

function AnnotationPainter({pathname}: {pathname: string}) {
  const {isAuthenticated} = useConvexAuth();
  const marks = useQuery(api.reader.listPageTextAnnotations, isAuthenticated ? {pathname} : 'skip');
  useEffect(() => {
    const root = articleContentRoot();
    if (!root || !marks) return undefined;
    const release = paintAnnotations(root, marks);
    const hash = window.location.hash;
    if (hash.startsWith('#annotation-')) focusAnnotation(decodeURIComponent(hash.slice('#annotation-'.length)));
    return release;
  }, [marks, pathname]);
  return null;
}

function AnnotationRemover() {
  const remove = useMutation(api.reader.deleteTextAnnotation);
  useEffect(() => {
    const onClear = (event: Event) => {
      const id = event instanceof CustomEvent ? event.detail?.id : undefined;
      if (typeof id !== 'string' || !id) return;
      void remove({id: id as Id<'textAnnotations'>})
        .then(() => announce('已取消高亮'))
        .catch(() => announce('未能取消高亮，请稍后重试。'));
    };
    document.addEventListener('blog:text-annotation-clear', onClear);
    return () => document.removeEventListener('blog:text-annotation-clear', onClear);
  }, [remove]);
  return null;
}

function AnnotationWriter() {
  const {isAuthenticated} = useConvexAuth();
  const create = useMutation(api.reader.createTextAnnotation);
  const createRef = useRef(create);
  createRef.current = create;

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let stopped = false;
    let working = false;
    let again = false;
    async function flush() {
      if (working) { again = true; return; }
      working = true;
      try {
        while (!stopped) {
          const batch = drainAnnotationSaves();
          if (!batch.length) break;
          for (let index = 0; index < batch.length; index++) {
            const draft = batch[index];
            if (stopped) {
              batch.slice(index).forEach(enqueueAnnotationSave);
              break;
            }
            try {
              await createRef.current({
                pathname: draft.pathname,
                title: draft.title,
                type: draft.type,
                quote: draft.quote,
                prefix: draft.prefix,
                suffix: draft.suffix,
              });
              const session = storage();
              const stored = session ? readAnnotationDraft(session) : null;
              if (session && stored && stored.type === draft.type && stored.pathname === draft.pathname && stored.quote === draft.quote) {
                clearAnnotationDraft(session);
              }
              announce('已高亮');
            } catch {
              announce('未能保存，请稍后重试。');
            }
          }
        }
      } finally {
        working = false;
        if (!stopped && again) {
          again = false;
          void flush();
        }
      }
    }
    const unsubscribe = subscribeAnnotationSaves(() => { void flush(); });
    void flush();
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [isAuthenticated]);
  return null;
}

function AnnotationSession({url, pathname}: {url: string; pathname: string}) {
  const client = useSessionConvexClient(url);
  return <ConvexProviderWithClerk client={client} useAuth={useAuth}>
    {pathname ? <AnnotationPainter pathname={pathname} /> : null}
    <AnnotationRemover />
    <AnnotationWriter />
  </ConvexProviderWithClerk>;
}

export default function ReaderAnnotations({launcher}: {launcher: HTMLElement}) {
  const url = import.meta.env.PUBLIC_CONVEX_URL ?? '';
  const pathname = launcher.closest<HTMLElement>('[data-blog-chat-widget]')?.dataset.readerPathname ?? '';
  const {isLoaded, isSignedIn, userId, sessionId} = useAuth();
  return <>
    <AnnotationIntent />
    {url && isLoaded && isSignedIn
      ? <AnnotationSession key={`${userId ?? ''}:${sessionId ?? ''}`} url={url} pathname={pathname} />
      : null}
  </>;
}
