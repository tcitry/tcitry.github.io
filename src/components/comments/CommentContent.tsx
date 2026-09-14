import {Avatar} from '@heroui/react';
import type {Id} from '../../../convex/_generated/dataModel';
import CommentImages, {type CommentImage} from './CommentImages';

export interface CommentItem {
  id: Id<'comments'>;
  authorName: string;
  authorImageUrl?: string;
  body: string;
  createdAt: number;
  canDelete: boolean;
  deleted: boolean;
  likeCount: number;
  likedByMe: boolean;
  images: CommentImage[];
  replyTo?: {id: Id<'comments'>; authorName: string; deleted: boolean};
}

function formatCommentTime(createdAt: number) {
  const deltaSec = Math.round((createdAt - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat('zh-CN', {numeric: 'auto'});
  if (abs < 45) return rtf.format(deltaSec, 'second');
  if (abs < 90 * 60) return rtf.format(Math.round(deltaSec / 60), 'minute');
  if (abs < 36 * 3600) return rtf.format(Math.round(deltaSec / 3600), 'hour');
  if (abs < 30 * 86400) return rtf.format(Math.round(deltaSec / 86400), 'day');
  return new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: 'short', day: 'numeric'}).format(createdAt);
}

export default function CommentContent({comment, parentLoaded}: {comment: CommentItem; parentLoaded: boolean}) {
  const reply = comment.replyTo ? `回复 ${comment.replyTo.deleted ? '已删除的评论' : comment.replyTo.authorName}` : '';
  return <>
    <div className="blog-comments__header">
      <Avatar size="sm" className="blog-comments__avatar">
        {comment.authorImageUrl && !comment.deleted && <Avatar.Image src={comment.authorImageUrl} alt="" loading="lazy" />}
        <Avatar.Fallback>{comment.deleted ? '—' : comment.authorName.slice(0, 1)}</Avatar.Fallback>
      </Avatar>
      <div className="blog-comments__meta">
        <strong>{comment.deleted ? '已删除的评论' : comment.authorName}</strong>
        <time dateTime={new Date(comment.createdAt).toISOString()}>{formatCommentTime(comment.createdAt)}</time>
      </div>
    </div>
    {comment.replyTo && <p className="blog-comments__reply">{parentLoaded ? <a href={`#comment-${comment.replyTo.id}`}>{reply}</a> : reply}</p>}
    {comment.deleted ? <p className="blog-comments__body blog-comments__deleted">这条评论已删除，回复仍保留。</p> : <>
      {comment.body && <p className="blog-comments__body">{comment.body}</p>}
      <CommentImages images={comment.images} />
    </>}
  </>;
}
