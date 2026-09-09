import {Show, SignInButton, UserButton} from '@clerk/react';
import {Button} from '@heroui/react';
import {panelClerkRedirect} from './SignInPanel';

export default function AccountButton() {
  const redirect = panelClerkRedirect();
  return <>
    <Show when="signed-out">
      <SignInButton mode="modal" withSignUp {...redirect}>
        <Button size="sm" variant="secondary">登录 / 注册</Button>
      </SignInButton>
    </Show>
    <Show when="signed-in">
      <UserButton
        userProfileMode="modal"
        fallback={<span className="assistant-workspace__account" aria-hidden="true" />}
        appearance={{elements: {avatarBox: 'assistant-workspace__account'}}}
      />
    </Show>
  </>;
}
