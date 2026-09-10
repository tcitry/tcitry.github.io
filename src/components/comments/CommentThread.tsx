import {useEffect, useId, useRef, useState, type SubmitEvent} from 'react';
import {useAuth, useUser} from '@clerk/react';
import {Avatar, Button, Label, TextArea, TextField, Tooltip} from '@heroui/react';
import {DropZone} from '@heroui-pro/react';
import {useMutation, usePaginatedQuery} from 'convex/react';
import {ConvexError} from 'convex/values';
import {api} from '../../../convex/_generated/api';
import type {Id} from '../../../convex/_generated/dataModel';
import CommentContent, {type CommentItem} from './CommentContent';
import {HeartIcon, ImageIcon} from './CommentIcons';
import {commentImageLimit, commentImageTypes, uploadCommentImage} from './comment-image-upload';
import CommentQueryLoading, {useCommentQueryRetry} from './CommentQueryLoading';
import surface from '../demos/DemoSurface.module.css';

interface DraftImage {key: string; file: File; preview: string; imageId?: Id<'commentImages'>; status: 'ready' | 'uploading' | 'uploaded' | 'failed'}
const linkedComment = () => /^#comment-[a-zA-Z0-9_-]{1,80}$/.test(window.location.hash) ? window.location.hash.slice(1) : '';

function errorMessage(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === 'object' && error.data !== null) {
    if ('kind' in error.data && error.data.kind === 'RateLimited') return '评论操作过于频繁，请稍后再试。';
    if ('message' in error.data && typeof error.data.message === 'string') return error.data.message;
  }
  return '评论未能发布，你的文字和图片仍保留在这里，请稍后重试。';
}

function discussionRows(comments: CommentItem[]) {
  const byId = new Map(comments.map(comment => [comment.id, comment]));
  const children = new Map<string, CommentItem[]>();
  const roots: CommentItem[] = [];
  for (const comment of comments) {
    if (comment.replyTo && byId.has(comment.replyTo.id)) {
      const siblings = children.get(comment.replyTo.id) ?? [];
      siblings.push(comment); children.set(comment.replyTo.id, siblings);
    } else roots.push(comment);
  }
  const rows: {comment: CommentItem; depth: number}[] = [];
  const seen = new Set<string>();
  const visit = (comment: CommentItem, depth: number) => {
    if (seen.has(comment.id)) return;
    seen.add(comment.id); rows.push({comment, depth});
    for (const child of (children.get(comment.id) ?? []).sort((a, b) => a.createdAt - b.createdAt)) visit(child, depth + 1);
  };
  for (const comment of roots) visit(comment, comment.replyTo ? 1 : 0);
  for (const comment of comments) if (!seen.has(comment.id)) visit(comment, 0);
  return rows;
}

export default function CommentThread({pathname}: {pathname: string}) {
  const {getToken} = useAuth();
  const {user} = useUser();
  const listQuery = useCommentQueryRetry();
  const {results, status, loadMore} = usePaginatedQuery(api.comments.list, listQuery.skip ? 'skip' : {pathname}, {initialNumItems: 20});
  const firstPageLoading = listQuery.skip || status === 'LoadingFirstPage';
  const add = useMutation(api.comments.add);
  const remove = useMutation(api.comments.remove);
  const setLike = useMutation(api.comments.setCommentLike);
  const discard = useMutation(api.commentImages.discard);
  const [body, setBody] = useState('');
  const [images, setImages] = useState<DraftImage[]>([]);
  const imageCount = useRef(0);
  const [replyTo, setReplyTo] = useState<Pick<CommentItem, 'id' | 'authorName'> | null>(null);
  const [pending, setPending] = useState(false);
  const [busyLike, setBusyLike] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<Id<'comments'> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const imageDescriptionId = useId();
  const [tooltipContainer, setTooltipContainer] = useState<HTMLFormElement | null>(null);
  const [commentTarget, setCommentTarget] = useState(linkedComment);
  const active = useRef(true);
  const previews = useRef(new Set<string>());
  const upload = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {active.current = false; upload.current?.abort(); for (const url of previews.current) URL.revokeObjectURL(url); previews.current.clear();};
  }, []);
  useEffect(() => {
    const update = () => {setCommentTarget(linkedComment()); setNotice('');};
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    if (!commentTarget || firstPageLoading) return;
    const target = document.getElementById(commentTarget);
    if (target) {
      const frame = requestAnimationFrame(() => {
        target.focus({preventScroll: true});
        target.scrollIntoView({block: 'center'});
        setCommentTarget('');
      });
      return () => cancelAnimationFrame(frame);
    } else if (status === 'CanLoadMore' && results.length < 200) loadMore(20);
    else if (status === 'Exhausted') {setNotice('这条回复已无法查看。'); setCommentTarget('');}
    else if (status === 'CanLoadMore') setNotice('这条回复尚未加载，可以继续加载更早的评论。');
  }, [commentTarget, results, status, loadMore, firstPageLoading]);

  function selectImages(files: File[]) {
    if (pending) return;
    if (imageCount.current + files.length > 4) {setError('每条评论最多添加 4 张图片。'); return;}
    if (files.some(file => !commentImageTypes.includes(file.type) || file.size > commentImageLimit || file.size === 0)) {
      setError('请选择不超过 5 MB 的 JPEG、PNG、WebP 或 GIF 图片。'); return;
    }
    const selected = files.map(file => {
      const preview = URL.createObjectURL(file); previews.current.add(preview);
      return {key: crypto.randomUUID(), file, preview, status: 'ready' as const};
    });
    imageCount.current += selected.length;
    setImages(current => [...current, ...selected]); setError('');
  }

  async function removeImage(image: DraftImage) {
    if (pending) return;
    try {
      if (image.imageId) await discard({imageId: image.imageId});
      if (!active.current) return;
      URL.revokeObjectURL(image.preview); previews.current.delete(image.preview);
      imageCount.current -= 1;
      setImages(current => current.filter(item => item.key !== image.key));
    } catch {if (active.current) setError('图片暂未移除，请稍后重试。');}
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || (!body.trim() && images.length === 0)) return;
    setPending(true); setError(''); setNotice('');
    const controller = new AbortController(); upload.current = controller;
    try {
      const imageIds: Id<'commentImages'>[] = [];
      for (const image of images) {
        if (!active.current) return;
        if (image.imageId) {imageIds.push(image.imageId); continue;}
        setImages(current => current.map(item => item.key === image.key ? {...item, status: 'uploading'} : item));
        try {
          const imageId = await uploadCommentImage(image.file, getToken, {signal: controller.signal});
          if (!active.current) return;
          imageIds.push(imageId);
          setImages(current => current.map(item => item.key === image.key ? {...item, imageId, status: 'uploaded'} : item));
        } catch (failure) {
          if (active.current) setImages(current => current.map(item => item.key === image.key ? {...item, status: 'failed'} : item));
          throw failure;
        }
      }
      if (!active.current) return;
      await add({pathname, body, ...(replyTo ? {parentId: replyTo.id} : {}), ...(imageIds.length ? {imageIds} : {})});
      if (!active.current) return;
      setBody(''); setReplyTo(null); setImages([]); setNotice('评论已发布。');
      imageCount.current = 0;
      for (const url of previews.current) URL.revokeObjectURL(url); previews.current.clear();
    } catch (failure) {if (active.current) setError(errorMessage(failure));}
    finally {if (active.current) setPending(false); upload.current = null;}
  }

  async function deleteComment(id: Id<'comments'>) {
    if (pending) return;
    setPending(true); setError(''); setNotice('');
    try {
      await remove({id}); if (!active.current) return;
      setDeleteId(null); setNotice('评论已删除。'); if (replyTo?.id === id) setReplyTo(null);
    } catch (failure) {if (active.current) setError(errorMessage(failure));}
    finally {if (active.current) setPending(false);}
  }

  const loaded = new Set(results.map(comment => comment.id));
  return <div className="blog-comments__content">
    <form ref={setTooltipContainer} onSubmit={submit} className="blog-comments__composer">
      <div className="blog-comments__composer-author"><Avatar size="sm">
        {user?.imageUrl && <Avatar.Image src={user.imageUrl} alt="" />}<Avatar.Fallback>{user?.username?.slice(0, 1) || '我'}</Avatar.Fallback>
      </Avatar><strong>{user?.username || '当前账户'}</strong></div>
      {replyTo && <div className="blog-comments__reply-target"><span>回复 {replyTo.authorName}</span><Button size="sm" variant="ghost" onPress={() => setReplyTo(null)}>取消回复</Button></div>}
      <TextField value={body} onChange={setBody} isDisabled={pending}>
        <Label className="blog-comments__sr-only">你的评论</Label>
        <TextArea ref={input} id="comment-body" maxLength={4_000} rows={4} placeholder="分享你的想法，也可以添加图片…" />
      </TextField>
      {images.length > 0 && <div className="blog-comments__draft-images">
        {images.map((image, index) => <div className="blog-comments__draft-image" key={image.key}>
          <img src={image.preview} alt={`待发布图片 ${index + 1}`} />
          <Tooltip><Button isIconOnly size="sm" variant="secondary" className="blog-comments__remove-image" aria-label={`移除图片 ${index + 1}`} isDisabled={pending} onPress={() => {void removeImage(image);}}>×</Button>
            <Tooltip.Content className={surface.surface} placement="top">移除图片</Tooltip.Content></Tooltip>
          <span role="status">{image.status === 'uploading' ? '正在上传…' : image.status === 'failed' ? '上传失败，再次发布可重试。' : image.status === 'uploaded' ? '已上传' : ''}</span>
        </div>)}
      </div>}
      <DropZone className="blog-comments__uploads">
        <DropZone.Area className="blog-comments__drop-area" isDisabled={pending || images.length >= 4} onDrop={async event => {
          const files: File[] = [];
          for (const item of event.items) if (item.kind === 'file') files.push(await item.getFile());
          if (active.current) selectImages(files);
        }}>
          <Tooltip delay={400}>
            <DropZone.Trigger aria-label="添加图片" aria-describedby={imageDescriptionId} isDisabled={pending || images.length >= 4}><ImageIcon /></DropZone.Trigger>
            <Tooltip.Content className={`${surface.surface} blog-comments__upload-tooltip`} placement="top start" offset={8} UNSTABLE_portalContainer={tooltipContainer ?? undefined}>
              添加图片 · 最多 4 张，每张 5 MB
            </Tooltip.Content>
          </Tooltip>
          {images.length > 0 && <span className="blog-comments__image-count" role="status" aria-label={`已选择 ${images.length} 张图片，最多 4 张`}>{images.length}/4</span>}
          <DropZone.Description id={imageDescriptionId} className="blog-comments__sr-only">最多 4 张，每张 5 MB</DropZone.Description>
        </DropZone.Area>
        <DropZone.Input accept={commentImageTypes.join(',')} multiple onSelect={files => selectImages(Array.from(files))} />
      </DropZone>
      <div className="blog-comments__submit"><span>{body.length.toLocaleString()} / 4,000</span><Button type="submit" size="sm" isPending={pending} isDisabled={!body.trim() && !images.length}>发布评论</Button></div>
    </form>
    {error && <p className="blog-comments__error" role="alert">{error}</p>}
    <p className="blog-comments__notice" role="status" aria-live="polite">{notice}</p>
    {firstPageLoading ? <CommentQueryLoading key={listQuery.attempt} label="正在读取评论…"
      errorLabel="评论读取时间过长，你的草稿已保留，可以重试。" retryLabel="重新读取评论" onRetry={listQuery.retry} />
      : results.length === 0 ? <p className="blog-comments__empty">还没有评论，来聊聊你的看法吧。</p>
        : <ol className="blog-comments__list">
          {discussionRows(results).map(({comment, depth}) => <li key={comment.id} id={`comment-${comment.id}`} tabIndex={-1} className="blog-comments__item" data-reply={depth > 0 || undefined} style={{marginInlineStart: `${Math.min(depth, 3) * 16}px`}}>
            <CommentContent comment={comment} parentLoaded={Boolean(comment.replyTo && loaded.has(comment.replyTo.id))} />
            {!comment.deleted && <div className="blog-comments__actions">
              <Button size="sm" variant="ghost" aria-label={`喜欢 ${comment.authorName} 的评论`} aria-pressed={comment.likedByMe} isPending={busyLike === comment.id} className="blog-comments__like" onPress={async () => {
                if (busyLike) return; setBusyLike(comment.id); setError('');
                try {await setLike({pathname, commentId: comment.id, liked: !comment.likedByMe});}
                catch {if (active.current) setError('喜欢未能保存，请稍后重试。');}
                finally {if (active.current) setBusyLike(null);}
              }}><HeartIcon filled={comment.likedByMe} /><span>{comment.likeCount.toLocaleString()}</span></Button>
              <Button size="sm" variant="ghost" onPress={() => {setReplyTo({id: comment.id, authorName: comment.authorName}); input.current?.focus();}}>回复</Button>
              {comment.canDelete && (deleteId === comment.id ? <>
                <span>删除这条评论？</span><Button size="sm" variant="danger-soft" isPending={pending} onPress={() => {void deleteComment(comment.id);}}>确认删除</Button>
                <Button size="sm" variant="ghost" isDisabled={pending} onPress={() => setDeleteId(null)}>取消</Button>
              </> : <Button size="sm" variant="ghost" onPress={() => setDeleteId(comment.id)}>删除</Button>)}
            </div>}
          </li>)}
        </ol>}
    {status !== 'Exhausted' && !firstPageLoading && <Button size="sm" variant="outline" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更早的评论</Button>}
  </div>;
}
