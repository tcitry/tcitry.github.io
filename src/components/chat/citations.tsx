import {useMemo} from 'react';
import type {Components} from 'react-markdown';
import {ChatSource, ChatSources} from '@heroui-pro/react/chat-source';
import {CITE_PREFIX, type ChatCitationSource, injectCitationLinks, sourcePreviewDescription} from './citation-links';

export type {ChatCitationSource} from './citation-links';
export {injectCitationLinks} from './citation-links';

export function citationMarkdownComponents(sources: readonly ChatCitationSource[]): Components {
  const byId = new Map(sources.map(source => [source.id, source]));
  const allowedUrls = new Set(sources.map(source => source.url));
  return {
    a: ({href, children}) => {
      if (href?.startsWith(CITE_PREFIX)) {
        const source = byId.get(href.slice(CITE_PREFIX.length));
        if (!source) return <span>{children}</span>;
        return <ChatSource href={source.url} title={source.title} description={sourcePreviewDescription(source)} className="blog-chat__inline-cite">
          <ChatSource.Trigger target="_blank" rel="noopener noreferrer">[{source.id}]</ChatSource.Trigger>
          <ChatSource.Preview />
        </ChatSource>;
      }
      return allowedUrls.has(href ?? '')
        ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
        : <span>{children}</span>;
    },
    p: ({children}) => <div className="markdown__paragraph">{children}</div>,
    img: ({alt}) => alt ? <span>{alt}</span> : null,
    h1: ({children}) => <h3>{children}</h3>,
    h2: ({children}) => <h3>{children}</h3>,
    table: ({children}) => <div className="blog-chat__table"><table>{children}</table></div>,
  };
}

export function useCitationMarkdownComponents(sources: readonly ChatCitationSource[]) {
  return useMemo(() => citationMarkdownComponents(sources), [sources]);
}

export function CitationSourcesFooter({sources, className = 'blog-chat__sources'}: {sources: readonly ChatCitationSource[]; className?: string}) {
  if (!sources.length) return null;
  return <ChatSources className={className}>
    <ChatSources.Trigger>{sources.length} 篇来源</ChatSources.Trigger>
    <ChatSources.Content>
      <ChatSources.List>
        {sources.map(source => <ChatSource key={source.id} href={source.url} title={source.title} description={sourcePreviewDescription(source)} />)}
      </ChatSources.List>
    </ChatSources.Content>
  </ChatSources>;
}
