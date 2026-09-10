import {lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode} from 'react';
import {useAuth} from '@clerk/react';
import {useConvexAuth, useQuery} from 'convex/react';
import {api} from '../../../convex/_generated/api';
import type {Id} from '../../../convex/_generated/dataModel';
import {Button, Tooltip} from '@heroui/react';
import {Bell} from '@gravity-ui/icons';
import {Segment} from '@heroui-pro/react/segment';
import AccountButton from '../auth/AccountButton';
import {AuthLoading} from '../auth/SignInPanel';
import ConvexSession, {ConvexAuthGate, ServiceBoundary} from '../auth/ConvexSession';
import {ChatSession} from './ChatSession';
import type {AssistantView} from '../../scripts/assistant-ui-state.mjs';
import type {ChatPromptRequest} from './AgentChat';
import surface from '../demos/DemoSurface.module.css';
import '../../styles/chat.css';

const MyPanel = lazy(() => import('../reader/MyPanel'));
const AgentChat = lazy(() => import('./AgentChat'));
const ConsultationsPanel = lazy(() => import('../consultations/ConsultationsPanel'));
const ConsultationInbox = lazy(() => import('../consultations/ConsultationsPanel').then(module => ({default: module.ConsultationInbox})));
const NotificationsPanel = lazy(() => import('./NotificationsPanel'));
const views = [
  {id: 'my', label: '我的'},
  {id: 'chat', label: 'AI 对话'},
  {id: 'consult', label: '咨询'},
] as const;
interface WorkspaceProps {
  onClose: () => void; onReady: () => void; pathname?: string; title?: string;
  initialView?: AssistantView; onViewChange?: (view: AssistantView) => void;
  requestedPrompt?: ChatPromptRequest; onPromptConsumed?: (id: string) => void;
}
function ServiceView({children}: {children: ReactNode}) {
  return <ServiceBoundary><Suspense fallback={<AuthLoading label="正在加载…" />}>{children}</Suspense></ServiceBoundary>;
}
function WorkspaceContent({onClose, onReady, view, myOpened, selectView, requestedPrompt, onPromptConsumed}: WorkspaceProps & {
  view: AssistantView; myOpened: boolean; selectView: (view: AssistantView) => void;
}) {
  const {isLoaded} = useAuth();
  const {isAuthenticated, isLoading} = useConvexAuth();
  const role = useQuery(api.membership.getConsultationRole, isAuthenticated ? {} : 'skip');
  const hasUnread = useQuery(api.notifications.hasUnread, isAuthenticated ? {} : 'skip');
  const isAuthor = isAuthenticated && role?.isAdmin === true;
  const activeView = view === 'admin' && !isAuthor ? 'consult' : view;
  const [notificationThread, setNotificationThread] = useState<Id<'consultationThreads'> | null>(null);
  const tabRail = useRef<HTMLDivElement | null>(null);
  const [tooltipContainer, setTooltipContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => { if (isLoaded) onReady(); }, [isLoaded, onReady]);
  useEffect(() => {
    if (view === 'admin' && !isLoading && (!isAuthenticated || role?.isAdmin === false)) selectView('consult');
  }, [view, isLoading, isAuthenticated, role?.isAdmin, selectView]);
  useEffect(() => {tabRail.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({block: 'nearest', inline: 'nearest'});}, [activeView]);

  return <div ref={setTooltipContainer} className={`${surface.surface} assistant-workspace`} data-book-island>
    <div className="assistant-workspace__edge-actions" role="group" aria-label="侧栏操作">
    <Tooltip delay={400}>
      <Button isIconOnly variant="secondary" className="assistant-workspace__close" aria-label="关闭博客助手" onPress={onClose}>
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7.5 5 5 5-5 5" /></svg>
      </Button>
      <Tooltip.Content className="blog-chat__tooltip" placement="right" offset={8} UNSTABLE_portalContainer={tooltipContainer ?? undefined}>收起侧栏</Tooltip.Content>
    </Tooltip>
    </div>
    <nav className="assistant-workspace__switcher">
      <div className="assistant-workspace__tabs" ref={tabRail}>
      <Segment aria-label="助手功能" size="sm" className="w-auto" selectedKey={activeView} onSelectionChange={(key) => {
        const next = String(key) as AssistantView;
        if (next === 'consult') setNotificationThread(null);
        selectView(next);
      }}>
        {views.map((item) => <Segment.Item key={item.id} id={item.id} className="w-auto">{item.label}</Segment.Item>)}
        {isAuthor && <Segment.Item id="admin" className="w-auto">管理</Segment.Item>}
      </Segment>
      </div>
      <div className="assistant-workspace__actions">
        <Tooltip delay={400}>
          <Button isIconOnly size="sm" variant="ghost" className="assistant-workspace__notifications"
            aria-label={hasUnread ? '消息（有未读）' : '消息'} aria-pressed={activeView === 'messages'}
            data-workspace-notifications onPress={() => selectView('messages')}>
            <Bell width={20} height={20} aria-hidden="true" />
            {hasUnread && <span className="assistant-workspace__unread" data-notification-unread aria-hidden="true" />}
          </Button>
          <Tooltip.Content className="blog-chat__tooltip" placement="bottom end" offset={8} UNSTABLE_portalContainer={tooltipContainer ?? undefined}>{hasUnread ? '消息（有未读）' : '消息'}</Tooltip.Content>
        </Tooltip>
        <AccountButton />
      </div>
    </nav>
    <div className="assistant-workspace__view">
      <ConvexAuthGate>
          <div className="assistant-workspace__service" hidden={activeView !== 'chat'}><ServiceView><AgentChat requestedPrompt={activeView === 'chat' ? requestedPrompt : undefined} onPromptConsumed={onPromptConsumed} /></ServiceView></div>
          {activeView === 'consult' && <ServiceView><ConsultationsPanel key={notificationThread ?? 'consultations'} initialThreadId={notificationThread ?? undefined} /></ServiceView>}
          {activeView === 'admin' && isAuthor && <ServiceView><ConsultationInbox /></ServiceView>}
          {activeView === 'messages' && <div className="assistant-workspace__reader"><ServiceView><NotificationsPanel onOpenConsultation={threadId => {
            setNotificationThread(threadId);
            selectView('consult');
          }} /></ServiceView></div>}
          <div className="assistant-workspace__personal" hidden={activeView !== 'my'}>
            {myOpened && <div className="assistant-workspace__reader"><ServiceView><MyPanel /></ServiceView></div>}
          </div>
      </ConvexAuthGate>
    </div>
  </div>;
}

function Workspace(props: WorkspaceProps) {
  const {isLoaded, userId, sessionId} = useAuth();
  const promptOwner = useRef<{id: string; session: string | null; cancelled: boolean} | null>(null);
  const session = userId ? `${userId}:${sessionId ?? ''}` : null;
  if (props.requestedPrompt && isLoaded) {
    if (promptOwner.current?.id !== props.requestedPrompt.id) {
      promptOwner.current = {id: props.requestedPrompt.id, session, cancelled: false};
    } else if (promptOwner.current.session === null && !promptOwner.current.cancelled) {
      // An anonymous search may wait for the first login on this page.
      promptOwner.current.session = session;
    } else if (promptOwner.current.session !== session) {
      promptOwner.current.cancelled = true;
    }
  }
  const requestedPrompt = isLoaded && !promptOwner.current?.cancelled ? props.requestedPrompt : undefined;
  const [view, setView] = useState<AssistantView>(props.initialView ?? 'my');
  const [myOpened, setMyOpened] = useState(!props.initialView || props.initialView === 'my');
  const selectView = useCallback((next: AssistantView) => {
    if (next === 'my') setMyOpened(true);
    setView(next);
    props.onViewChange?.(next);
  }, [props.onViewChange]);
  useEffect(() => {
    if (requestedPrompt) selectView('chat');
    else if (props.requestedPrompt && promptOwner.current?.cancelled) props.onPromptConsumed?.(props.requestedPrompt.id);
  }, [requestedPrompt?.id, props.requestedPrompt?.id, props.onPromptConsumed, selectView]);
  return <ConvexSession onErrorClose={props.onClose}>
    <WorkspaceContent {...props} requestedPrompt={requestedPrompt} view={view} myOpened={myOpened} selectView={selectView} />
  </ConvexSession>;
}

export default function AssistantWorkspace(props: WorkspaceProps) {
  return <ChatSession onReady={props.onReady} onClose={props.onClose}>
    <Workspace {...props} />
  </ChatSession>;
}
