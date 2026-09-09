import {lazy, Suspense, useEffect, useState} from 'react';
import {useAuth} from '@clerk/react';
import {CloseButton, Tooltip} from '@heroui/react';
import {Segment} from '@heroui-pro/react/segment';
import AccountButton from '../auth/AccountButton';
import {AuthLoading} from '../auth/SignInPanel';
import ConvexSession from '../auth/ConvexSession';
import {ChatSession} from './ChatSession';
import type {AssistantView} from '../../scripts/assistant-ui-state.mjs';
import surface from '../demos/DemoSurface.module.css';
import '../../styles/chat.css';

const ReaderRoot = lazy(() => import('../reader/ReaderRoot'));
const AgentChat = lazy(() => import('./AgentChat'));
const ConsultationsPanel = lazy(() => import('../consultations/ConsultationsPanel'));
const MembershipPanel = lazy(() => import('../membership/MembershipPanel'));
const views = [
  {id: 'chat', label: 'AI 对话'},
  {id: 'consult', label: '咨询'},
  {id: 'reading', label: '阅读'},
  {id: 'membership', label: '会员'},
] as const;
function Workspace({onClose, onReady, pathname, title, reading = false, initialView, onViewChange}: {
  onClose: () => void; onReady: () => void; pathname?: string; title?: string; reading?: boolean;
  initialView?: AssistantView; onViewChange?: (view: AssistantView) => void;
}) {
  const {isLoaded} = useAuth();
  const [tooltipContainer, setTooltipContainer] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<AssistantView>(initialView ?? (reading ? 'reading' : 'chat'));
  const [readerOpened, setReaderOpened] = useState(initialView === 'reading' || reading);
  useEffect(() => { if (isLoaded) onReady(); }, [isLoaded, onReady]);

  return <div ref={setTooltipContainer} className={`${surface.surface} assistant-workspace`}>
    <nav className="assistant-workspace__switcher">
      <Segment aria-label="助手功能" size="sm" className="w-auto" selectedKey={view} onSelectionChange={(key) => {
        const next = String(key) as AssistantView;
        if (next === 'reading') setReaderOpened(true);
        setView(next);
        onViewChange?.(next);
      }}>
        {views.map((item) => <Segment.Item key={item.id} id={item.id} className="w-auto">{item.label}</Segment.Item>)}
      </Segment>
      <div className="assistant-workspace__actions">
        <AccountButton />
        <Tooltip delay={400}>
          <CloseButton className="assistant-workspace__close" aria-label="关闭博客助手" onPress={onClose} />
          {/* Keep the overlay inside the dialog and its scoped theme tokens. */}
          <Tooltip.Content className="blog-chat__tooltip" placement="bottom end" offset={8} UNSTABLE_portalContainer={tooltipContainer ?? undefined}>关闭博客助手</Tooltip.Content>
        </Tooltip>
      </div>
    </nav>
    <div className="assistant-workspace__view">
      <ConvexSession requireAuth>
        <Suspense fallback={<AuthLoading label="正在加载…" />}>
          <div className="assistant-workspace__service" hidden={view !== 'chat'}><AgentChat /></div>
          {view === 'consult' && <ConsultationsPanel />}
          {view === 'membership' && <MembershipPanel />}
          <div className="assistant-workspace__reading" hidden={view !== 'reading'}>
            {readerOpened && <div className="assistant-workspace__reader"><ReaderRoot library pathname={pathname} title={title} /></div>}
          </div>
        </Suspense>
      </ConvexSession>
    </div>
  </div>;
}

export default function AssistantWorkspace(props: {
  onClose: () => void; onReady: () => void; pathname?: string; title?: string; reading?: boolean;
  initialView?: AssistantView; onViewChange?: (view: AssistantView) => void;
}) {
  return <ChatSession onReady={props.onReady} onClose={props.onClose}>
    <Workspace {...props} />
  </ChatSession>;
}
