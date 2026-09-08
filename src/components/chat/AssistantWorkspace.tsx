import {lazy, Suspense, useEffect, useState} from 'react';
import {useAuth} from '@clerk/react';
import {Button} from '@heroui/react';
import SignInPanel from '../auth/SignInPanel';
import BlogChat from './BlogChat';
import {ChatSession} from './ChatSession';
import surface from '../demos/DemoSurface.module.css';

const ReaderRoot = lazy(() => import('../reader/ReaderRoot'));

function Workspace({onClose, onReady, pathname, title, reading = false}: {
  onClose: () => void; onReady: () => void; pathname?: string; title?: string; reading?: boolean;
}) {
  const {isLoaded, userId} = useAuth();
  const [view, setView] = useState(reading ? 'reading' : 'chat');
  const [readerOpened, setReaderOpened] = useState(reading);
  useEffect(() => { if (isLoaded) onReady(); }, [isLoaded, onReady]);

  return <div className={`${surface.surface} assistant-workspace`}>
    <nav className="assistant-workspace__switcher" aria-label="助手功能">
      <Button size="sm" variant={view === 'chat' ? 'secondary' : 'ghost'} aria-pressed={view === 'chat'} onPress={() => setView('chat')}>对话</Button>
      <Button size="sm" variant={view === 'reading' ? 'secondary' : 'ghost'} aria-pressed={view === 'reading'} onPress={() => {setReaderOpened(true); setView('reading');}}>我的阅读</Button>
    </nav>
    {view === 'chat' ? <div className="assistant-workspace__view">
      {!isLoaded
        ? <p className="blog-chat__notice" role="status">正在加载登录状态…</p>
        : userId
          ? <BlogChat onClose={onClose} onReady={onReady} />
          : <>
            <div className="blog-chat__header">
              <div className="blog-chat__identity">博客助手</div>
              <Button size="sm" variant="ghost" onPress={onClose} aria-label="关闭博客助手">关闭</Button>
            </div>
            <SignInPanel description="登录后可以向博客助手提问。回答仍然只依据已公开的文章。" />
          </>}
    </div> : <div className="assistant-workspace__view assistant-workspace__reading">
      <div className="blog-chat__header">
        <strong>我的阅读</strong>
        <Button size="sm" variant="ghost" onPress={onClose} aria-label="关闭博客助手">关闭</Button>
      </div>
      <div className="assistant-workspace__reader">
        {!isLoaded
          ? <p role="status">正在加载登录状态…</p>
          : userId
            ? readerOpened && <Suspense fallback={<p role="status">正在加载阅读账户…</p>}>
              <ReaderRoot library pathname={pathname} title={title} />
            </Suspense>
            : <SignInPanel description="登录后收藏文章、继续上次阅读，并保存仅自己可见的笔记。" />}
      </div>
    </div>}
  </div>;
}

export default function AssistantWorkspace(props: {
  onClose: () => void; onReady: () => void; pathname?: string; title?: string; reading?: boolean;
}) {
  return <ChatSession onReady={props.onReady} onClose={props.onClose}>
    <Workspace {...props} />
  </ChatSession>;
}
