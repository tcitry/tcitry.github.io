import {createRoot} from 'react-dom/client';
import BlogChat from '../../src/components/chat/BlogChat';
import ChatLauncherFace from '../../src/components/chat/ChatLauncherFace';
import {ChatSession} from '../../src/components/chat/ChatSession';
import '../../src/styles/tailwind.css';
import '../../src/styles/chat.css';
import '../../src/styles/chat-widget.css';

const launcher = document.querySelector<HTMLElement>('[data-chat-launcher]');
const face = launcher?.querySelector<HTMLElement>('[data-chat-launcher-face]');
if (launcher && face) createRoot(face).render(<ChatLauncherFace launcher={launcher} />);

createRoot(document.getElementById('root')!).render(
  <ChatSession>
    <BlogChat onReady={() => {}} />
  </ChatSession>,
);
