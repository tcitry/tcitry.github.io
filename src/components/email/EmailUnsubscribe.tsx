import {useEffect, useState} from 'react';
import {Button, Description, Label, Switch} from '@heroui/react';
import {useMutation, useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import BlogClerkProvider from '../auth/BlogClerkProvider';
import ConvexSession from '../auth/ConvexSession';
import surface from '../demos/DemoSurface.module.css';

const categories = [
  {key: 'commentReply' as const, label: '评论回复'},
  {key: 'likes' as const, label: '点赞'},
  {key: 'newComment' as const, label: '新评论'},
  {key: 'newsletter' as const, label: 'Newsletter'},
] as const;

function UnsubscribeView({token}: {token: string}) {
  const preferences = useQuery(api.emailPreferences.getByToken, {token});
  const update = useMutation(api.emailPreferences.updateByToken);
  const unsubscribe = useMutation(api.emailPreferences.unsubscribeByToken);
  type PreferencePatch = Omit<Parameters<typeof update>[0], 'token'>;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  useEffect(() => {
    setCategory(new URLSearchParams(window.location.search).get('category'));
  }, []);
  useEffect(() => {
    if (!category || preferences === undefined || preferences === null || pending) return;
    if (category === 'commentReply' || category === 'likes' || category === 'newComment' || category === 'newsletter') {
      void (async () => {
        setPending(true);
        try {
          await unsubscribe({token, category});
          setMessage(`已退订「${categories.find(item => item.key === category)?.label ?? category}」邮件。`);
        } catch {
          setError('退订失败，请稍后重试。');
        } finally {
          setPending(false);
        }
      })();
    }
  }, [category, preferences, pending, token, unsubscribe]);
  if (preferences === undefined) return <p>正在加载…</p>;
  if (preferences === null) return <p role="alert">退订链接无效或已过期。</p>;
  async function save(patch: PreferencePatch) {
    setPending(true); setError(''); setMessage('');
    try {
      await update({...patch, token});
      setMessage('已更新邮件通知偏好。');
    } catch {
      setError('暂时无法保存，请稍后重试。');
    } finally {
      setPending(false);
    }
  }
  const masterDisabled = !preferences.enabled || preferences.emailDisabled;
  return <div className={surface.surface} data-book-island>
    <h1 className="text-xl font-semibold">邮件通知</h1>
    <p className="mt-2 text-sm text-muted">无需登录即可管理与此链接关联的邮件通知偏好。</p>
    {preferences.emailDisabled && <p className="mt-2 text-sm text-danger" role="alert">该邮箱此前退信或被标记为投诉，邮件通知已暂停。</p>}
    {message && <p className="mt-2 text-sm text-success" role="status">{message}</p>}
    {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
    <div className="mt-4 flex flex-col gap-4">
      <Switch size="sm" isSelected={preferences.enabled && !preferences.emailDisabled} isDisabled={pending || preferences.emailDisabled}
        onChange={value => {void save({enabled: value});}}>
        <Switch.Content>
          <Label>启用邮件通知</Label>
          <Description>关闭后不会发送任何邮件。</Description>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch.Content>
      </Switch>
      {categories.map(item => <Switch key={item.key} size="sm" isSelected={preferences[item.key]} isDisabled={pending || masterDisabled}
        onChange={value => {void save({[item.key]: value} as PreferencePatch);}}>
        <Switch.Content>
          <Label>{item.label}</Label>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch.Content>
      </Switch>)}
    </div>
    <div className="mt-6 flex flex-wrap gap-2">
      <Button size="sm" variant="danger" isDisabled={pending} onPress={() => {void (async () => {
        setPending(true); setError(''); setMessage('');
        try {
          await unsubscribe({token, all: true});
          setMessage('已退订全部邮件通知。');
        } catch {
          setError('退订失败，请稍后重试。');
        } finally {
          setPending(false);
        }
      })();}}>退订全部</Button>
      <Button size="sm" variant="outline" isDisabled={pending} onPress={() => {void save({commentReply: false});}}>仅退订评论回复</Button>
    </div>
    <p className="mt-6 text-xs text-muted">登录后也可在右侧助手「我的 → 邮件通知」中管理设置。</p>
  </div>;
}

export default function EmailUnsubscribe() {
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token')?.trim() ?? '');
    setReady(true);
  }, []);
  if (!ready) return <p>正在加载…</p>;
  if (!token) return <p role="alert">缺少退订令牌。</p>;
  return <BlogClerkProvider>
    <ConvexSession>
      <UnsubscribeView token={token} />
    </ConvexSession>
  </BlogClerkProvider>;
}
