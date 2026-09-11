import {Button, Description, Input, Label, TextField} from '@heroui/react';
import {COMMENT_USERNAME_MAX} from './comment-username';

export default function CommentUsernameForm({
  username, onChange, error, pending, onSave,
}: {
  username: string;
  onChange: (value: string) => void;
  error: string;
  pending: boolean;
  onSave: () => void;
}) {
  return <div className="blog-comments__username">
    <p className="blog-comments__username-copy">发布评论需要公开用户名。设置后会显示在你的评论旁，也可以稍后在账户资料中修改。</p>
    <TextField value={username} onChange={onChange} isDisabled={pending} isInvalid={Boolean(error)}>
      <Label>用户名</Label>
      <Input maxLength={COMMENT_USERNAME_MAX} autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="例如 tcitry" />
      <Description>4–64 个字符，可使用字母、数字、下划线和连字符。</Description>
    </TextField>
    {error && <p className="blog-comments__error" role="alert">{error}</p>}
    <div className="blog-comments__username-actions">
      <Button size="sm" variant="secondary" isPending={pending} isDisabled={!username.trim()} onPress={onSave}>保存用户名</Button>
    </div>
  </div>;
}
