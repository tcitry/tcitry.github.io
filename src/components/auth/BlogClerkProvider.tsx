import {Component, createContext, useContext, type ReactNode} from 'react';
import {ClerkProvider} from '@clerk/react';
import type {BrowserClerk, ClerkProp} from '@clerk/react';
import {clerkRouterPush, clerkRouterReplace} from './clerk-navigation';
import {isQuietClerkError, quietClerkRejections} from '../../scripts/module-load-error.mjs';

const BlogClerkTreeContext = createContext(false);

class ClerkLoadBoundary extends Component<{children: ReactNode}, {error: unknown}> {
  state: {error: unknown} = {error: null};
  private stopRejections?: () => void;
  componentDidMount() { this.stopRejections = quietClerkRejections(window); }
  componentWillUnmount() { this.stopRejections?.(); }
  static getDerivedStateFromError(error: unknown) { return {error}; }
  render() {
    if (!this.state.error) return this.props.children;
    if (!isQuietClerkError(this.state.error)) throw this.state.error;
    return <p role="status">登录服务暂时无法连接，请稍后重试。</p>;
  }
}

export function clerkPublishableKey() {
  return import.meta.env.PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
}

// @clerk/react skips the UI chunk when ClerkProvider gets a Clerk prop.
// window.Clerk often exists as a {load} stub before UI attaches, so .load is
// not enough — passing that instance makes Google One Tap / SignIn throw
// "Clerk was not loaded with Ui components".
function isUiClerk(value: unknown): value is BrowserClerk {
  if (!value || typeof value !== 'object') return false;
  const clerk = value as BrowserClerk;
  return typeof clerk.load === 'function'
    && clerk.onComponentsReady != null
    && clerk.components != null;
}

function loadedClerkInstance(): ClerkProp {
  const clerk = (window as Window & {Clerk?: unknown}).Clerk;
  return isUiClerk(clerk) ? clerk : undefined;
}

export default function BlogClerkProvider({children}: {children: ReactNode}) {
  const key = clerkPublishableKey();
  const nested = useContext(BlogClerkTreeContext);
  if (!key || nested) return children;
  const currentPage = window.location.href;
  const loadedClerk = loadedClerkInstance();
  return <ClerkLoadBoundary><ClerkProvider publishableKey={key} {...(loadedClerk ? {Clerk: loadedClerk} : {})} routerPush={clerkRouterPush} routerReplace={clerkRouterReplace} signInFallbackRedirectUrl={currentPage} signUpFallbackRedirectUrl={currentPage} afterSignOutUrl={currentPage} appearance={{elements: {modalBackdrop: 'blog-clerk-modal'}}}>
    <BlogClerkTreeContext.Provider value={true}>
      {children}
    </BlogClerkTreeContext.Provider>
  </ClerkProvider></ClerkLoadBoundary>;
}
