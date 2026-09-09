import type {Id} from '../../../convex/_generated/dataModel';

export interface CommentItem {
  id: Id<'comments'>;
  authorName: string;
  body: string;
  createdAt: number;
  canDelete: boolean;
  replyTo?: {id: Id<'comments'>; authorName: string};
}


// Author names and bodies stay plain text, with no executable HTML or links.
export default function CommentContent({comment}: {comment: CommentItem}) {
  return <>
    <div className="blog-comments__meta">
      <strong>{comment.authorName}</strong>
      <time dateTime={new Date(comment.createdAt).toISOString()}>{new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'}).format(comment.createdAt)}</time>
    </div>
    {comment.replyTo && <p className="blog-comments__reply">回复 {comment.replyTo.authorName}</p>}
    <p className="blog-comments__body">{comment.body}</p>
  </>;
}
