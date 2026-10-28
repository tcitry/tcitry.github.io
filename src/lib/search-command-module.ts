export interface SearchCommandModule {
  mountSearchCommand: typeof import('../components/search/SearchCommand').mountSearchCommand;
}

/** One in-flight import. A rejected download is forgotten so the next call can retry. */
export function createSearchCommandLoader(load: () => Promise<SearchCommandModule>) {
  let pending: Promise<SearchCommandModule> | undefined;
  return function loadSearchCommandModule() {
    pending ??= Promise.resolve()
      .then(load)
      .then(
        (module) => module,
        (error: unknown) => {
          pending = undefined;
          throw error;
        },
      );
    return pending;
  };
}

async function importSearchCommandModule() {
  // Dev React refresh must load before the panel module evaluates. Production drops this branch.
  if (import.meta.env.DEV) await import('@vitejs/plugin-react/preamble');
  return import('../components/search/SearchCommand');
}

/** Evaluate the SearchCommand chunk. Callers mount the dialog and run queries themselves. */
export const loadSearchCommandModule = createSearchCommandLoader(importSearchCommandModule);
