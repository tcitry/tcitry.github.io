import {createRoot} from 'react-dom/client';
import TextAnnotationsPanel from '../../src/components/reader/TextAnnotationsPanel';
import '../../src/styles/tailwind.css';
import '../../src/styles/reader-annotations.css';

createRoot(document.getElementById('root')!).render(
  <main className="annotation-fixture"><TextAnnotationsPanel pathname="/docs/fixture/" /></main>,
);
