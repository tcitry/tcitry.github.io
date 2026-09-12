import '../../src/styles/tailwind.css';
import {useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import {ClerkProvider, useAuth} from '@clerk/react';
import {ConvexProviderWithClerk, ConvexReactClient} from 'convex/react-clerk';
import ConsultationsPanel from '../../src/components/consultations/ConsultationsPanel';

const params = new URLSearchParams(location.search);
const auth = (window as unknown as {__readerAuth: {switchSession: (userId: string, sessionId: string) => void}}).__readerAuth;
const services = (window as unknown as {__services: {
  failNextMembership: () => void;
  getState: () => {threads: { _id: string; owner: string; title: string; status: string; createdAt: number; updatedAt: number }[]};
}}).__services;
if (params.get('user') === 'fixture-b') auth.switchSession('fixture-b', 'session-b');
if (params.get('failMembership') === 'true') services.failNextMembership();
const threads = services.getState().threads;
if (!threads.some(thread => thread._id === 'fixture-b-history')) threads.push({
  _id: 'fixture-b-history', owner: 'fixture-b', status: 'waiting',
  title: '过期后仍可查看的咨询', createdAt: Date.UTC(2026, 8, 1, 8), updatedAt: Date.UTC(2026, 8, 1, 8),
});

function App() {
  const {userId, sessionId} = useAuth();
  const client = useMemo(() => new ConvexReactClient('https://fixture.convex.cloud'), [userId, sessionId]);
  return <ConvexProviderWithClerk key={`${userId}:${sessionId}`} client={client}>
    <ConsultationsPanel />
  </ConvexProviderWithClerk>;
}

createRoot(document.getElementById('root')!).render(
  <ClerkProvider appearance={{elements: {modalBackdrop: 'blog-clerk-modal'}}}>
    <main className="consultations-membership-fixture" style={{
      margin: 24, width: 400, minHeight: 520, padding: 0, border: '1px solid #dededb', background: '#fff',
      color: '#303338', fontFamily: 'system-ui, sans-serif',
      ['--foreground' as string]: '#303338', ['--muted' as string]: '#5c5c59', ['--border' as string]: '#e0e0dc',
      ['--accent' as string]: '#315585', ['--danger' as string]: '#b42318', ['--surface-secondary' as string]: '#f7f7f6',
    }}>
      <App />
    </main>
  </ClerkProvider>,
);
