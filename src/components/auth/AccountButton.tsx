import {Show, SignInButton, UserButton, useClerk} from '@clerk/react';
import {ArrowRotateRight, CreditCard} from '@gravity-ui/icons';
import {Button} from '@heroui/react';
import {useConvexAuth} from 'convex/react';
import {useMembership} from '../membership/useMembership';
import {panelClerkRedirect} from './SignInPanel';

type MembershipStatus = 'pending' | 'unavailable' | 'pro' | 'free';
const membershipLabels: Record<MembershipStatus, string> = {
  pending: '正在核验会员状态 · 管理订阅',
  unavailable: '会员状态暂不可用 · 管理订阅',
  pro: 'Pro 会员 · 管理订阅',
  free: '未开通 Pro 会员 · 管理订阅',
};

function AccountMenu({status, onRetry}: {status: MembershipStatus; onRetry?: () => void}) {
  const {openUserProfile} = useClerk();
  return <UserButton
    userProfileMode="modal"
    fallback={<span className="assistant-workspace__account" aria-hidden="true" />}
    appearance={{elements: {avatarBox: 'assistant-workspace__account'}}}
  >
    <UserButton.MenuItems>
      <UserButton.Action
        label={membershipLabels[status]}
        labelIcon={<CreditCard width={16} height={16} aria-hidden="true" />}
        onClick={() => openUserProfile({__experimental_startPath: '/billing'})}
      />
      {status === 'unavailable' && onRetry && <UserButton.Action
        label="重试会员状态"
        labelIcon={<ArrowRotateRight width={16} height={16} aria-hidden="true" />}
        onClick={onRetry}
      />}
    </UserButton.MenuItems>
  </UserButton>;
}

function AuthenticatedAccountMenu() {
  const {membership, pending, error, refresh} = useMembership();
  const status: MembershipStatus = pending || (!membership && !error)
    ? 'pending'
    : error || !membership?.configured
      ? 'unavailable'
      : membership.isPro ? 'pro' : 'free';
  return <AccountMenu status={status} onRetry={() => { void refresh(); }} />;
}

function SignedInAccount() {
  const {isAuthenticated, isLoading} = useConvexAuth();
  // Mount the action-backed reader only after Convex has accepted this session.
  // ConvexSession remounts this subtree when the Clerk user or session changes.
  if (isAuthenticated) return <AuthenticatedAccountMenu />;
  return <AccountMenu status={isLoading ? 'pending' : 'unavailable'} onRetry={() => window.location.reload()} />;
}

export default function AccountButton() {
  const redirect = panelClerkRedirect();
  return <>
    <Show when="signed-out">
      <SignInButton mode="modal" {...redirect}>
        <Button size="sm" variant="secondary">登录 / 注册</Button>
      </SignInButton>
    </Show>
    <Show when="signed-in">
      <SignedInAccount />
    </Show>
  </>;
}
