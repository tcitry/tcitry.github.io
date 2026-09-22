export type ChatCitationSource = {
  id: string;
  title: string;
  url: string;
  sourceKind: 'author' | 'ai-assisted';
};

export const CITE_PREFIX = '#cite-';

export function sourcePreviewDescription(source: ChatCitationSource) {
  return source.sourceKind === 'ai-assisted' ? 'AI 整理' : undefined;
}

export function injectCitationLinks(text: string, sources: readonly ChatCitationSource[]) {
  const ids = new Set(sources.map(source => source.id));
  return text.replace(/\[(\d+)\](?!\()/g, (match, id: string) => (
    ids.has(id) ? `[${id}](${CITE_PREFIX}${id})` : match // hash links pass react-markdown url sanitization
  ));
}
