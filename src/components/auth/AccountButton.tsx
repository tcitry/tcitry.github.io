import {useState} from 'react';
import {useClerk, useUser} from '@clerk/react';
import {Avatar, Button, Dropdown, Tooltip} from '@heroui/react';
import {panelClerkOptions} from './SignInPanel';

function initials(user: {firstName?: string | null; lastName?: string | null; fullName?: string | null; username?: string | null}) {
  const fromName = [user.firstName?.[0], user.lastName?.[0]].filter(Boolean).join('');
  if (fromName) return fromName;
  return (user.fullName || user.username || '?').slice(0, 1);
}

export default function AccountButton() {
  const {isLoaded, user} = useUser();
  const clerk = useClerk();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pending, setPending] = useState(false);
  if (!isLoaded) return null;
  if (!user) {
    return <Button size="sm" variant="ghost" className="assistant-workspace__signin" onPress={() => {
      clerk.openSignIn({withSignUp: true, ...panelClerkOptions()});
    }}>登录 / 注册</Button>;
  }

  async function signOut() {
    if (!window.dispatchEvent(new CustomEvent('reader:before-signout', {cancelable: true}))) return;
    setPending(true);
    try { await clerk.signOut({redirectUrl: window.location.href}); }
    finally { setPending(false); }
  }

  return <Dropdown isOpen={menuOpen} onOpenChange={setMenuOpen}>
    <Tooltip delay={400} isDisabled={menuOpen}>
      <Button isIconOnly variant="ghost" className="assistant-workspace__account" aria-label="账户" isDisabled={pending}>
        <Avatar size="sm" data-sentry-mask>
          {user.imageUrl ? <Avatar.Image alt="" src={user.imageUrl} /> : null}
          <Avatar.Fallback>{initials(user)}</Avatar.Fallback>
        </Avatar>
      </Button>
      <Tooltip.Content className="blog-chat__tooltip" placement="bottom">账户</Tooltip.Content>
    </Tooltip>
    <Dropdown.Popover placement="bottom end" className="assistant-workspace__account-menu"
      UNSTABLE_portalContainer={document.getElementById('blog-chat-panel') ?? undefined}>
      <Dropdown.Menu aria-label="账户" onAction={(key) => {
        if (key === 'profile') clerk.openUserProfile(panelClerkOptions());
        if (key === 'signout') void signOut();
        setMenuOpen(false);
      }}>
        <Dropdown.Item id="profile" textValue="管理账户">管理账户</Dropdown.Item>
        <Dropdown.Item id="signout" textValue="退出登录" variant="danger">退出登录</Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown.Popover>
  </Dropdown>;
}
