/** @typedef {'chat' | 'consult' | 'reading' | 'membership'} AssistantView */

const storageKey = 'blog-assistant-ui';
const views = new Set(['chat', 'consult', 'reading', 'membership']);

/**
 * Only the public page and selected tab survive a full-page sign-in callback.
 * Absence of a record means closed. Private data stays in session-scoped React.
 * @param {() => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} storage
 * @param {string} pathname
 */
export function assistantUIState(storage, pathname) {
  return {
    /** @returns {AssistantView | undefined} */
    restore() {
      try {
        const state = JSON.parse(storage().getItem(storageKey) || 'null');
        return state?.pathname === pathname && views.has(state.view) ? state.view : undefined;
      } catch { return undefined; }
    },
    /** @param {AssistantView} view */
    save(view) {
      if (!views.has(view)) return;
      try { storage().setItem(storageKey, JSON.stringify({pathname, view})); } catch {}
    },
    clear() {
      try { storage().removeItem(storageKey); } catch {}
    },
  };
}
