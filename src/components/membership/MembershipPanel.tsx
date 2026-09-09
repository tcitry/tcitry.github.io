import { PricingTable, useClerk } from '@clerk/react';
import { Button } from '@heroui/react';
import { useMembership } from './useMembership';
import styles from './MembershipPanel.module.css';

export default function MembershipPanel() {
  const { membership, pending, error, refresh } = useMembership();
  const { openUserProfile } = useClerk();
  const ready = membership?.configured && membership.consultationsReady;
  return <section className={styles.panel} aria-label="会员服务" data-membership-panel data-sentry-mask data-pagefind-ignore>
    <header className={styles.header}>
      <span className={styles.eyebrow}>MEMBERSHIP</span>
      <h2>Pro 会员</h2>
      <p>向博主发起私人咨询，在专属对话中交流你的问题。</p>
    </header>
    <div className={styles.status} aria-live="polite">
      {pending ? '正在核验会员状态…' : error || !membership ? '会员状态暂时不可用。' : membership.isPro ? '你已拥有 Pro 会员。' : ready ? '你还没有开通 Pro 会员。' : '会员服务尚未开放。'}
      {membership?.isPro && membership.validUntil && <p>当前有效期至 {new Date(membership.validUntil).toLocaleDateString('zh-CN')}。</p>}
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.actions}>
      <Button size="sm" variant="secondary" onPress={() => openUserProfile()}>账户与订阅</Button>
      <Button size="sm" variant="ghost" isPending={pending} onPress={() => { void refresh(); }}>刷新会员状态</Button>
    </div>
    {ready && <div className={styles.pricing}>
      <PricingTable for="user" newSubscriptionRedirectUrl={window.location.href} />
    </div>}
    <p className={styles.note}>咨询采用异步文字交流。购买价格和计费周期以订阅页面为准。会员到期后，仍可查看已有咨询记录。</p>
  </section>;
}
