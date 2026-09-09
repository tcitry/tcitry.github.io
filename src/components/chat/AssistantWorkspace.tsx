import {lazy, Suspense, useEffect, useState} from 'react';
import {useAuth} from '@clerk/react';
import {CloseButton, Tooltip} from '@heroui/react';
import {Segment} from '@heroui-pro/react/segment';
import AccountButton from '../auth/AccountButton';
import SignInPanel, {AuthLoading} from '../auth/SignInPanel';
import BlogChat from './BlogChat';
import {ChatSession} from './ChatSession';
import surface from '../demos/DemoSurface.module.css';
import '../../styles/chat.css';

const ReaderRoot = lazy(() => import('../reader/ReaderRoot'));
const views = [
  {id: 'consult', label: '咨询'},
  {id: 'chat', label: '对话'},
  {id: 'reading', label: '阅读'},
] as const;
type View = (typeof views)[number]['id'];

function ChatHistory() {
  return <div className="blog-chat__auth" role="status">
    <p>跨页面的对话列表还没有接入。当前提问和草稿留在「咨询」。</p>
  </div>;
}

function Workspace({onClose, onReady, pathname, title, reading = false}: {
  onClose: () => void; onReady: () => void; pathname?: string; title?: string; reading?: boolean;
}) {
  const {isLoaded, userId} = useAuth();
  const [view, setView] = useState<View>(reading ? 'reading' : 'consult');
  const [readerOpened, setReaderOpened] = useState(reading);
  useEffect(() => { if (isLoaded) onReady(); }, [isLoaded, onReady]);

  return <div className={`${surface.surface} assistant-workspace`}>
    <nav className="assistant-workspace__switcher">
      <Segment aria-label="助手功能" size="sm" selectedKey={view} onSelectionChange={(key) => {
        const next = String(key) as View;
        if (next === 'reading') setReaderOpened(true);
        setView(next);
      }}>
        {views.map((item) => <Segment.Item key={item.id} id={item.id}>{item.label}</Segment.Item>)}
      </Segment>
      <div className="assistant-workspace__actions">
        <AccountButton />
        <Tooltip delay={400}>
          <CloseButton className="assistant-workspace__close" aria-label="关闭博客助手" onPress={onClose} />
          <Tooltip.Content className="blog-chat__tooltip" placement="bottom">关闭博客助手</Tooltip.Content>
        </Tooltip>
      </div>
    </nav>
    <div className="assistant-workspace__view" hidden={view !== 'consult'}>
      {!isLoaded
        ? view === 'consult' && <AuthLoading label="正在加载登录…" />
        : userId
          ? <BlogChat onReady={onReady} />
          : view === 'consult' && <SignInPanel description="登录后可以向博客助手提问。回答仍然只依据已公开的文章。" />}
    </div>
    <div className="assistant-workspace__view" hidden={view !== 'chat'}>
      {view === 'chat' && (!isLoaded
        ? <AuthLoading label="正在加载登录…" />
        : <ChatHistory />)}
    </div>
    <div className="assistant-workspace__view assistant-workspace__reading" hidden={view !== 'reading'}>
      {!isLoaded
        ? view === 'reading' && <AuthLoading label="正在加载登录…" />
        : userId
          ? readerOpened && <div className="assistant-workspace__reader">
            <Suspense fallback={<AuthLoading label="正在加载阅读账户…" />}>
              <ReaderRoot library pathname={pathname} title={title} />
            </Suspense>
          </div>
          : view === 'reading' && <SignInPanel description="登录后收藏文章、继续上次阅读，并保存仅自己可见的笔记。" />}
    </div>
  </div>;
}

export default function AssistantWorkspace(props: {
  onClose: () => void; onReady: () => void; pathname?: string; title?: string; reading?: boolean;
}) {
  return <ChatSession onReady={props.onReady} onClose={props.onClose}>
    <Workspace {...props} />
  </ChatSession>;
}
