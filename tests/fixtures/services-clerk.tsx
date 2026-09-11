import {createContext, useContext, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {currentFixtureAuth, useAuth, useClerk as useFixtureClerk, useUser as useFixtureUser} from './reader-clerk';
export * from './reader-clerk';

const AppearanceContext = createContext('');
const PortalContext = createContext<() => Element | null>(() => null);
const CloseMenuContext = createContext<() => void>(() => {});
const profileRequests: {userId: string | null; options?: Record<string, unknown>}[] = [];
const profileEscapes: {defaultPrevented: boolean; inNativeDialog: boolean}[] = [];
let closeProfile: (() => void) | undefined;
const usernameByUser = new Map<string, string | null>();
const usernameListeners = new Set<() => void>();
function clerkError(code: string, message: string) {
  return Object.assign(new Error(message), {clerkError: true, errors: [{code, message}]});
}
export const fixtureUsername = (userId: string | null) => {
  if (!userId) return null;
  if (usernameByUser.has(userId)) return usernameByUser.get(userId) ?? null;
  return userId === 'fixture-no-username' ? null : `${userId}-username`;
};
function takenUsernames(exceptUserId: string) {
  const taken = new Set(['fixture-a-username', 'fixture-b-username']);
  for (const [userId, username] of usernameByUser) {
    if (userId !== exceptUserId && username) taken.add(username);
  }
  return taken;
}
export function useUser() {
  const result = useFixtureUser();
  useSyncExternalStore((listener) => {usernameListeners.add(listener); return () => usernameListeners.delete(listener);}, () => fixtureUsername(currentFixtureAuth().userId));
  const userId = result.user?.id ?? null;
  const username = fixtureUsername(userId);
  return {...result, user: result.user ? {...result.user, username, async update(params: {username?: string}) {
    const next = params.username?.trim() ?? '';
    if (next.length < 4 || next.length > 64) throw clerkError('form_username_invalid_length', 'Username must be between 4 and 64 characters.');
    if (!/^[a-zA-Z0-9_-]+$/.test(next)) throw clerkError('form_username_invalid_character', 'Username can only contain letters, numbers, underscores and hyphens.');
    if (takenUsernames(userId!).has(next)) throw clerkError('form_identifier_exists', 'That username is taken. Please try another.');
    usernameByUser.set(userId!, next);
    usernameListeners.forEach(listener => listener());
  }} : null};
}

export function ClerkProvider({children, appearance}: {children: ReactNode; appearance?: {elements?: {modalBackdrop?: string}}}) {
  return <AppearanceContext.Provider value={appearance?.elements?.modalBackdrop ?? ''}>{children}</AppearanceContext.Provider>;
}
export function UNSAFE_PortalProvider({children, getContainer}: {children?: ReactNode; getContainer: () => Element | null}) {
  return <PortalContext.Provider value={getContainer}>{children}</PortalContext.Provider>;
}
export function useClerk() {
  const clerk = useFixtureClerk();
  const modalBackdrop = useContext(AppearanceContext);
  const getContainer = useContext(PortalContext);
  return {...clerk, openUserProfile(options?: Record<string, unknown>) {
    profileRequests.push({userId: currentFixtureAuth().userId, options});
    closeProfile?.();
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = document.createElement('div');
    backdrop.className = `cl-modalBackdrop ${modalBackdrop}`;
    backdrop.dataset.fixtureClerkProfile = '';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:rgba(0,0,0,.2)';
    const card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Clerk 账户与订阅（测试）');
    card.style.cssText = 'padding:24px;max-width:calc(100vw - 32px);background:white;color:black;border-radius:12px';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '关闭账户弹窗';
    const close = () => {
      backdrop.remove();
      if (closeProfile === close) closeProfile = undefined;
      if (opener?.isConnected) opener.focus({preventScroll: true});
    };
    closeProfile = close;
    closeButton.addEventListener('click', close);
    // Clerk/Floating UI still consumes Escape after the host prevents its native
    // default action. Remove the modal synchronously before document bubbling.
    backdrop.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      profileEscapes.push({defaultPrevented: event.defaultPrevented, inNativeDialog: Boolean(backdrop.closest('dialog:modal'))});
      close();
    });
    card.append(closeButton); backdrop.append(card);
    (getContainer() ?? document.body).append(backdrop);
    closeButton.focus();
  }};
}
Object.assign(window, {__servicesClerk: {getState: () => ({profileRequests, profileEscapes})}});

function FixtureUserButton({children, fallback, appearance}: {children?: ReactNode; fallback?: ReactNode; appearance?: {elements?: {avatarBox?: string}}}) {
  const {userId} = useAuth();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (!userId) return fallback ?? null;
  return <span style={{display: 'inline-flex', position: 'relative'}}>
    <button ref={trigger} type="button" className="cl-userButtonTrigger" aria-label="账户菜单" aria-haspopup="menu" aria-expanded={open}
      style={{padding: 0, border: 0, background: 'transparent', display: 'inline-flex'}} onClick={() => setOpen(current => !current)}>
      <span className={appearance?.elements?.avatarBox} style={{display: 'grid', placeItems: 'center', background: '#ddd', fontSize: 12}}>账户</span>
    </button>
    {open && <div role="menu" aria-label="账户菜单" style={{position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 1500, width: 260, maxWidth: 'calc(100vw - 24px)', padding: 8, background: 'white', color: 'black', border: '1px solid #ddd', borderRadius: 8}}>
      <CloseMenuContext.Provider value={() => {setOpen(false); trigger.current?.focus();}}>{children}</CloseMenuContext.Provider>
    </div>}
  </span>;
}
function MenuItems({children}: {children?: ReactNode}) {return children;}
function Action({label, labelIcon, onClick}: {label: string; labelIcon?: ReactNode; onClick?: () => void}) {
  const closeMenu = useContext(CloseMenuContext);
  return <button type="button" role="menuitem" onClick={() => {closeMenu(); onClick?.();}}
    style={{display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: 8, textAlign: 'left'}}>{labelIcon}{label}</button>;
}
export const UserButton = Object.assign(FixtureUserButton, {MenuItems, Action});

// Payment UI is deliberately a local placeholder: this test cannot checkout.
export function PricingTable({for: payer}: {for?: string}) {
  return <div data-fixture-pricing data-payer={payer}>Clerk 订阅方案（本地测试）</div>;
}
