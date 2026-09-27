import {useMemo} from 'react';
import type {Components} from 'react-markdown';
import {Markdown} from '@heroui-pro/react/markdown';

export const COMMENT_BODY_MAX_LENGTH = 4_000;

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function isSafeCommentHref(href: string | undefined) {
  if (!href) return false;
  const value = href.trim();
  if (!value || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  if (value.startsWith('#')) return true;
  try {
    const url = new URL(value);
    return SAFE_PROTOCOLS.has(url.protocol);
  } catch {
    return false;
  }
}

export function isExternalCommentHref(href: string) {
  return /^https?:/i.test(href);
}

export function commentMarkdownComponents(): Components {
  return {
    a: ({href, children}) => {
      if (!isSafeCommentHref(href)) return <span>{children}</span>;
      const external = isExternalCommentHref(href!);
      return <a href={href} {...(external ? {target: '_blank', rel: 'nofollow noopener noreferrer ugc'} : {})}>{children}</a>;
    },
    img: ({alt}) => (alt ? <span className="blog-comments__markdown-image-alt">{alt}</span> : null),
    p: ({children}) => <div className="markdown__paragraph">{children}</div>,
  };
}

export function useCommentMarkdownComponents() {
  return useMemo(() => commentMarkdownComponents(), []);
}

export function CommentBodyMarkdown({body, id}: {body: string; id: string}) {
  const components = useCommentMarkdownComponents();
  return <Markdown id={id} className="blog-comments__markdown" components={components}>{body}</Markdown>;
}

export function commentBodyExcerpt(body: string, maxLength = 200) {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  return plain.length > maxLength ? `${plain.slice(0, maxLength)}…` : plain;
}

export function isCommentBodyOverLimit(body: string) {
  return body.length > COMMENT_BODY_MAX_LENGTH;
}
