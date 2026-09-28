import {useState} from 'react';
import {Button, Description, Label, Switch} from '@heroui/react';
import {useMutation, useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import {AuthLoading} from '../auth/SignInPanel';
import styles from './MyPanel.module.css';

const categories = [
  {key: 'commentReply' as const, label: '评论回复', description: '有人回复你的评论时发送邮件。'},
  {key: 'likes' as const, label: '点赞', description: '你的评论或文章收到点赞时发送邮件（即将推出）。'},
  {key: 'newComment' as const, label: '新评论', description: '文章收到新评论时发送邮件（仅站点管理员）。'},
  {key: 'newsletter' as const, label: 'Newsletter', description: '不定期发送站点更新（需主动开启）。'},
];

export default function EmailSettingsPanel() {
  const preferences = useQuery(api.emailPreferences.getMine, {});
  const update = useMutation(api.emailPreferences.updateMine);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (preferences === undefined) return <AuthLoading label="正在加载邮件通知…" />;
  async function save(patch: Parameters<typeof update>[0]) {
    setPending(true); setError(''); setNotice('');
    try {
      await update(patch);
      setNotice('已保存邮件通知设置。');
    } catch {
      setError('设置暂时无法保存，请稍后重试。');
    } finally {
      setPending(false);
    }
  }
  const masterDisabled = !preferences.enabled || preferences.emailDisabled;
  return <section className={styles.panel} aria-label="邮件通知设置">
    <p className="text-sm text-muted">管理发送到 {preferences.cachedEmail ?? '已验证邮箱'} 的邮件通知。未验证邮箱时不会发送邮件。</p>
    {preferences.emailDisabled && <p className="text-sm text-danger" role="alert">该邮箱此前退信或被标记为投诉，邮件通知已暂停。如需恢复，请联系站长或重新验证邮箱后开启总开关。</p>}
    {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    {notice && <p className="text-sm text-success" role="status">{notice}</p>}
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
        onChange={value => {void save({[item.key]: value});}}>
        <Switch.Content>
          <Label>{item.label}</Label>
          <Description>{item.description}</Description>
          <Switch.Control><Switch.Thumb /></Switch.Control>
        </Switch.Content>
      </Switch>)}
    </div>
    <div className="mt-4">
      <Button size="sm" variant="outline" isDisabled={pending} onPress={() => {void save({
        enabled: true, commentReply: true, likes: true, newComment: preferences.newComment, newsletter: false,
      });}}>恢复默认</Button>
    </div>
  </section>;
}
