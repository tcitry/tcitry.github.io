import {createRoot} from 'react-dom/client';
import BlogChat from '../../src/components/chat/BlogChat';
import {ChatSession} from '../../src/components/chat/ChatSession';
import '../../src/styles/tailwind.css';
import '../../src/styles/chat.css';

createRoot(document.getElementById('root')!).render(
  <ChatSession>
    <BlogChat onClose={() => {}} onReady={() => {}} />
  </ChatSession>,
);
