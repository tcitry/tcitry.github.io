export const NOTE_MAX_LENGTH = 10_000;
export const PROGRESS_SAVE_INTERVAL = 10_000;

export interface NoteSnapshot {
  note: string;
  updatedAt: number | null;
}

export interface NoteDraft {
  text: string;
  base: NoteSnapshot;
  remote: NoteSnapshot;
  remoteChanged: boolean;
  saving: boolean;
}

export function receiveNote(draft: NoteDraft | null, remote: NoteSnapshot): NoteDraft {
  if (!draft || (!draft.saving && draft.text === draft.base.note)) return {text: remote.note, base: remote, remote, remoteChanged: false, saving: false};
  return {...draft, remote, remoteChanged: draft.remoteChanged || remote.updatedAt !== draft.remote.updatedAt || remote.note !== draft.remote.note};
}

export function beginNoteSave(draft: NoteDraft): NoteDraft {
  return {...draft, saving: true, remoteChanged: false};
}

export function failNoteSave(draft: NoteDraft): NoteDraft {
  return receiveNote({...draft, saving: false}, draft.remote);
}

export function noteHasConflict(draft: NoteDraft): boolean {
  return draft.text !== draft.base.note && draft.base.updatedAt !== draft.remote.updatedAt;
}

/** A save acknowledgement must not erase edits made after the submitted text. */
export function acknowledgeNote(draft: NoteDraft, submitted: string, saved: NoteSnapshot): NoteDraft {
  const next = {text: draft.text === submitted ? saved.note : draft.text, base: saved, remote: saved, remoteChanged: false, saving: false};
  // A deletion has no timestamp. Track observed changes rather than ordering
  // nullable versions: a query may observe a later deletion before this ack.
  return draft.remoteChanged && (draft.remote.updatedAt !== saved.updatedAt || draft.remote.note !== saved.note)
    ? receiveNote(next, draft.remote)
    : next;
}

export interface ArticlePosition {
  top: number;
  height: number;
  viewportHeight: number;
}

/** The article alone defines the denominator; comments and the page footer do not. */
export function readingProgress(position: ArticlePosition, scrollY: number): number {
  const distance = Math.max(0, position.height - position.viewportHeight);
  if (distance === 0) return scrollY + position.viewportHeight >= position.top + position.height ? 100 : 0;
  return Math.max(0, Math.min(100, Math.floor((scrollY - position.top) / distance * 100)));
}

export function resumeScrollY(position: ArticlePosition, progress: number): number {
  return Math.max(0, position.top + Math.max(0, position.height - position.viewportHeight) * Math.max(0, Math.min(100, progress)) / 100);
}

interface ProgressReporterOptions {
  initialProgress: number;
  save: (progress: number) => Promise<number>;
  onError: () => void;
  onSaved: (progress: number) => void;
  now?: () => number;
  schedule?: (callback: () => void, delay: number) => number;
  cancel?: (timer: number) => void;
}

/** Only observe() creates work. Mount, resize, remote updates, and flush never create progress. */
export function createProgressReporter(options: ProgressReporterOptions) {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((callback: () => void, delay: number) => window.setTimeout(callback, delay));
  const cancel = options.cancel ?? ((timer: number) => window.clearTimeout(timer));
  let saved = options.initialProgress;
  let pending = saved;
  let lastAttempt = now();
  let timer: number | undefined;
  let saving = false;
  let disposed = false;

  function queue() {
    if (disposed || saving || timer !== undefined || pending <= saved) return;
    timer = schedule(() => {timer = undefined; void flush();}, Math.max(0, PROGRESS_SAVE_INTERVAL - (now() - lastAttempt)));
  }

  async function flush() {
    if (disposed || saving || pending <= saved) return;
    if (timer !== undefined) {cancel(timer); timer = undefined;}
    saving = true;
    lastAttempt = now();
    const submitted = pending;
    let succeeded = false;
    try {
      saved = Math.max(saved, await options.save(submitted));
      succeeded = true;
      if (!disposed) options.onSaved(saved);
    } catch {
      if (!disposed) options.onError();
    } finally {
      saving = false;
      // A failed request waits for the next user scroll or explicit retry.
      if (succeeded) queue();
    }
  }

  return {
    observe(progress: number) {
      if (!Number.isFinite(progress)) return;
      pending = Math.max(pending, Math.max(0, Math.min(100, Math.floor(progress))));
      queue();
    },
    updateRemote(progress: number) {saved = Math.max(saved, progress);},
    flush,
    dispose() {disposed = true; if (timer !== undefined) cancel(timer);},
  };
}
