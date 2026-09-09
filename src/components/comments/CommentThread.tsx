import {useState, type SubmitEvent} from 'react';
import {SignInButton, useAuth} from '@clerk/react';
import {Button, Description, Input, Label, TextArea, TextField} from '@heroui/react';
import {useConvexAuth, useMutation, usePaginatedQuery} from 'convex/react';
import {ConvexError} from 'convex/values';
import {api} from '../../../convex/_generated/api';
import type {Id} from '../../../convex/_generated/dataModel';
import {panelClerkRedirect} from '../auth/SignInPanel';
import surface from '../demos/DemoSurface.module.css';
import CommentContent, {type CommentItem} from './CommentContent';


function errorMessage(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === 'object' && error.data !== null) {
    if ('kind' in error.data && error.data.kind === 'RateLimited') return '评论操作过于频繁，请稍后再试。';
    if ('code' in error.data && ['INVALID_ARGUMENT', 'UNAUTHENTICATED', 'FORBIDDEN'].includes(String(error.data.code)) && 'message' in error.data && typeof error.data.message === 'string') return error.data.message;
  }
  return '评论服务暂时无法连接，请稍后重试。';
}


export default function CommentThread({pathname}: {pathname: string}) {
  const {userId, isLoaded} = useAuth();
  const {isAuthenticated, isLoading} = useConvexAuth();
  const {results, status, loadMore} = usePaginatedQuery(api.comments.list, {pathname}, {initialNumItems: 20});
  const add = useMutation(api.comments.add);
  const remove = useMutation(api.comments.remove);
  const [authorName, setAuthorName] = useState('');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<Pick<CommentItem, 'id' | 'authorName'> | null>(null);
  const [pending, setPending] = useState(false);
  const [deleteId, setDeleteId] = useState<Id<'comments'> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !isAuthenticated || !body.trim() || !authorName.trim()) return;
    setPending(true); setError(''); setNotice('');
    try {
      await add({pathname, authorName, body, ...(replyTo ? {parentId: replyTo.id} : {})});
      setBody(''); setReplyTo(null); setNotice('评论已发布。');
    } catch (failure) {setError(errorMessage(failure));}
    finally {setPending(false);}
  }

  async function deleteComment(id: Id<'comments'>) {
    if (pending) return;
    setPending(true); setError(''); setNotice('');
    try {
      await remove({id}); setDeleteId(null); setNotice('评论已删除。');
      if (replyTo?.id === id) setReplyTo(null);
    } catch (failure) {setError(errorMessage(failure));}
    finally {setPending(false);}
  }

  return <div className={`${surface.surface} blog-comments__content`} data-book-island>
    {status === 'LoadingFirstPage' ? <p className="blog-comments__hint" role="status">正在读取评论…</p>
      : results.length === 0 ? <p className="blog-comments__hint">还没有评论，欢迎分享你的看法。</p>
        : <ol className="blog-comments__list">
          {results.map(comment => <li key={comment.id} id={`comment-${comment.id}`} className="blog-comments__item">
            <CommentContent comment={comment} />
            <div className="blog-comments__actions">
              {isAuthenticated && <Button size="sm" variant="ghost" onPress={() => {setReplyTo({id: comment.id, authorName: comment.authorName}); document.getElementById('comment-body')?.focus();}}>回复</Button>}
              {comment.canDelete && (deleteId === comment.id ? <>
                <span>删除这条评论？</span>
                <Button size="sm" variant="danger-soft" isPending={pending} onPress={() => {void deleteComment(comment.id);}}>确认删除</Button>
                <Button size="sm" variant="ghost" isDisabled={pending} onPress={() => setDeleteId(null)}>取消</Button>
              </> : <Button size="sm" variant="ghost" onPress={() => setDeleteId(comment.id)}>删除</Button>)}
            </div>
          </li>)}
        </ol>}
    {status !== 'Exhausted' && status !== 'LoadingFirstPage' && <Button size="sm" variant="outline" isPending={status === 'LoadingMore'} onPress={() => loadMore(20)}>加载更早的评论</Button>}
    <div className="blog-comments__composer">
      {!isLoaded || isLoading ? <p className="blog-comments__hint" role="status">正在连接登录状态…</p>
        : !userId ? <div className="blog-comments__signin"><p>登录后参与公开讨论。</p><SignInButton mode="modal" withSignUp {...panelClerkRedirect()}><Button size="sm">登录 / 注册</Button></SignInButton></div>
          : !isAuthenticated ? <p role="alert">登录状态暂时无法同步，请稍后刷新或重新登录。</p>
            : <form onSubmit={submit} className="blog-comments__form">
              {replyTo && <div className="blog-comments__reply-target"><span>回复 {replyTo.authorName}</span><Button size="sm" variant="ghost" onPress={() => setReplyTo(null)}>取消回复</Button></div>}
              <TextField value={authorName} onChange={setAuthorName} isRequired isDisabled={pending}>
                <Label>公开昵称</Label><Input maxLength={40} autoComplete="off" placeholder="自行填写展示给所有人的昵称" />
                <Description>昵称和评论对所有已登录读者可见。请勿填写邮箱或其他私密信息。</Description>
              </TextField>
              <TextField value={body} onChange={setBody} isRequired isDisabled={pending}>
                <Label>你的评论</Label><TextArea id="comment-body" maxLength={4_000} rows={4} placeholder="分享观点或补充文章内容…" />
              </TextField>
              <div className="blog-comments__submit"><span>{body.length.toLocaleString()} / 4,000</span><Button type="submit" size="sm" isPending={pending} isDisabled={!authorName.trim() || !body.trim()}>发布评论</Button></div>
            </form>}
    </div>
    {error && <p className="blog-comments__error" role="alert">{error}</p>}
    <p className="blog-comments__notice" role="status" aria-live="polite">{notice}</p>
  </div>;
}
