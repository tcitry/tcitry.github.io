import {createRoot} from 'react-dom/client';
import LieflatTickRows from '../../src/components/demos/LieflatTickRows';
import LieflatTrendExamples from '../../src/components/demos/LieflatTrendExamples';
import LieflatPartExamples from '../../src/components/demos/LieflatPartExamples';
import '../../src/styles/tailwind.css';
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:760,margin:'24px auto',padding:16}}>
  <h1>Lieflat 交互组件检查</h1>
  <LieflatTickRows />
  <LieflatTrendExamples kind="line" />
  <LieflatPartExamples />
  <LieflatTrendExamples kind="dumbbell" />
</main>);
