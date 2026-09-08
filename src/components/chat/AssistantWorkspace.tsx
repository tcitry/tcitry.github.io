import {lazy, Suspense, useState} from 'react';
import {Button} from '@heroui/react';
import BlogChat from './BlogChat';
import surface from '../demos/DemoSurface.module.css';

const ReaderRoot = lazy(() => import('../reader/ReaderRoot'));

export default function AssistantWorkspace({onClose, onReady, pathname, title, reading = false}: {
  onClose: () => void; onReady: () => void; pathname?: string; title?: string; reading?: boolean;
}) {
  const [view, setView] = useState(reading ? 'reading' : 'chat');
  const [readerOpened, setReaderOpened] = useState(reading);
  return <div className={`${surface.surface} assistant-workspace`}>
    <nav className="assistant-workspace__switcher" aria-label="助手功能">
      <Button size="sm" variant={view === 'chat' ? 'secondary' : 'ghost'} aria-pressed={view === 'chat'} onPress={() => setView('chat')}>对话</Button>
      <Button size="sm" variant={view === 'reading' ? 'secondary' : 'ghost'} aria-pressed={view === 'reading'} onPress={() => {setReaderOpened(true); setView('reading');}}>我的阅读</Button>
    </nav>
    <div className="assistant-workspace__view" hidden={view !== 'chat'}>
      <BlogChat onClose={onClose} onReady={onReady} />
    </div>
    <div className="assistant-workspace__view assistant-workspace__reading" hidden={view !== 'reading'}>
      <div className="blog-chat__header">
        <strong>我的阅读</strong>
        <Button size="sm" variant="ghost" onPress={onClose} aria-label="关闭博客助手">关闭</Button>
      </div>
      <div className="assistant-workspace__reader">
        {readerOpened && <Suspense fallback={<p role="status">正在加载阅读账户…</p>}>
          <ReaderRoot library pathname={pathname} title={title} />
        </Suspense>}
      </div>
    </div>
  </div>;
}
