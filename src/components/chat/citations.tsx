import {useMemo, useState} from 'react';
import type {Components} from 'react-markdown';
import {ChatSource, ChatSources} from '@heroui-pro/react/chat-source';
import {CITE_PREFIX, citationHost, type ChatCitationSource, injectCitationLinks, sourcePreviewDescription} from './citation-links';

export type {ChatCitationSource} from './citation-links';
export {injectCitationLinks} from './citation-links';

function CiteMark({title}: {title: string}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="blog-chat__cite-fallback" aria-hidden="true">{title.trim().charAt(0) || '文'}</span>;
  return <img className="blog-chat__cite-icon" src="/favicon.png" alt="" width={20} height={20} decoding="async" onError={() => setFailed(true)} />;
}

function CitationPreview({source}: {source: ChatCitationSource}) {
  const kind = sourcePreviewDescription(source);
  return <ChatSource.Preview className="blog-chat__cite-preview" aria-label={source.title}>
    <a className="blog-chat__cite-card" href={source.url} target="_blank" rel="noopener noreferrer">
      <span className="blog-chat__cite-meta">
        <CiteMark title={source.title} />
        <span className="blog-chat__cite-host">{citationHost(source.url)}</span>
        {kind && <span className="blog-chat__cite-kind">{kind}</span>}
      </span>
      <span className="blog-chat__cite-title">{source.title}</span>
    </a>
  </ChatSource.Preview>;
}

export function citationMarkdownComponents(sources: readonly ChatCitationSource[]): Components {
  const byId = new Map(sources.map(source => [source.id, source]));
  const allowedUrls = new Set(sources.map(source => source.url));
  return {
    a: ({href, children}) => {
      if (href?.startsWith(CITE_PREFIX)) {
        const source = byId.get(href.slice(CITE_PREFIX.length));
        if (!source) return <span>{children}</span>;
        return <ChatSource href={source.url} title={source.title} enablePreview className="blog-chat__inline-cite">
          <ChatSource.Trigger target="_blank" rel="noopener noreferrer">[{source.id}]</ChatSource.Trigger>
          <CitationPreview source={source} />
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
        {sources.map(source => <ChatSource key={source.id} href={source.url} title={source.title} enablePreview>
          <ChatSource.Trigger />
          <CitationPreview source={source} />
        </ChatSource>)}
      </ChatSources.List>
    </ChatSources.Content>
  </ChatSources>;
}
