import {Component, useEffect, useId, useState, type ComponentType, type ReactNode} from 'react';
import {Button} from '@heroui/react';
import surface from './DemoSurface.module.css';
import styles from './AnatomyCollectionStudy.module.css';
import '../../styles/demos.css';

type FigureProps = {theme?: 'light' | 'dark'; fig?: string};
type ExampleId = 'lru-cache' | 'turbofan' | 'seasons' | 'separable-blur';
type Example = {
  id: ExampleId;
  label: string;
  title: string;
  action: string;
  observation: string;
  mechanism: string;
};

const examples: Example[] = [
  {
    id: 'lru-cache',
    label: 'SVG · LRU',
    title: '书的位置就是缓存的访问顺序',
    action: '点击书，或聚焦图形后按 A–J。依次访问 A、B、C、D，再访问 B、E；每次等书归位后继续。',
    observation: '刚访问的书移到上层左端；加入 E 时，最久没被访问的 A 回到下层。',
    mechanism: '上层四个书位表示容量，左右次序表示最近访问顺序，取回与送回分别表示加载和淘汰。SVG 的移动已经足够解释这条规则。',
  },
  {
    id: 'turbofan',
    label: 'WebGL · Turbofan',
    title: '气流和火焰沿发动机内部结构变化',
    action: '横向拖动图形，或聚焦后按方向键调整推力杆；Home 回到怠速，End 设为起飞推力。',
    observation: '同时观察风扇、三组转轴、旁通气流、燃烧室和尾流，再核对角落里的推力读数。',
    mechanism: '结构零件由 SVG 绘制，连续的气流与燃烧效果由 WebGL 表现。两者共用相机和状态，前方零件会遮住后方效果。',
  },
  {
    id: 'seasons',
    label: '3D · Seasons',
    title: '地轴姿态、照明和昼长可以一起观察',
    action: '聚焦图形后按 Home 看六月至日，按 End 看十二月至日；左右键改变日期，上下键或横向拖动改变观察角度。',
    observation: '观察地轴保持倾斜时，地球受光的部分怎样变化，并比较北纬 50° 的昼长。',
    mechanism: '部件在三维空间中转动，每帧重新投影为 SVG；灯光另由 WebGL 绘制。这里需要看到空间姿态，3D 才有解释价值。',
  },
  {
    id: 'separable-blur',
    label: 'Early · Separable blur',
    title: '一块二维针床与两把一维梳子的工作量',
    action: '横向拖动图形，或聚焦后用方向键调整 blur。观察两把梳子先沿 x、再沿 y 处理图像。',
    observation: '对照左侧的二维针床、右侧的中间图像与最终图像：可分离滤波把每像素 49 × 49 次读取改为 49 + 49 次。',
    mechanism: '针高与梳齿高度对应权重，运动方向对应两次计算。这是 early examples 中直接解释计算结构的作品；图中每四个采样点画一个，不能把可见针数当成实际读取次数。',
  },
];

// Separate entry points keep unselected figures out of the initial download.
const loadFigure = {
  'lru-cache': () => import('anatomy-figures/lru-cache'),
  turbofan: () => import('anatomy-figures/turbofan'),
  seasons: () => import('anatomy-figures/seasons'),
  'separable-blur': () => import('anatomy-figures/separable-blur'),
};

function useBookTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    const root = document.documentElement;
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const setting = root.dataset.bookTheme;
      setTheme(setting === 'dark' || (setting !== 'light' && system.matches) ? 'dark' : 'light');
    };
    const observer = new MutationObserver(update);
    observer.observe(root, {attributes: true, attributeFilter: ['data-book-theme']});
    system.addEventListener('change', update);
    update();
    return () => {
      observer.disconnect();
      system.removeEventListener('change', update);
    };
  }, []);
  return theme;
}

class FigureBoundary extends Component<{children: ReactNode; source: string}, {failed: boolean}> {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  render() {
    return this.state.failed
      ? <p role="alert" className={styles.placeholder}>此作品未能在当前浏览器中显示。可阅读下面的解释，或<a href={this.props.source}>打开官方作品</a>。</p>
      : this.props.children;
  }
}

export default function AnatomyCollectionStudy() {
  const [selected, setSelected] = useState<ExampleId>('lru-cache');
  const [loaded, setLoaded] = useState<{id: ExampleId; Figure: ComponentType<FigureProps>} | null>(null);
  const [failed, setFailed] = useState<ExampleId | null>(null);
  const [revision, setRevision] = useState(0);
  const theme = useBookTheme();
  const id = useId();
  const example = examples.find(item => item.id === selected)!;
  const source = `https://skills.wheresryan.sh/anatomy/collection/${selected}`;
  const Figure = loaded?.id === selected ? loaded.Figure : null;

  useEffect(() => {
    let cancelled = false;
    setFailed(null);
    loadFigure[selected]().then(module => {
      if (!cancelled) setLoaded({id: selected, Figure: module.default});
    }).catch(() => {
      if (!cancelled) setFailed(selected);
    });
    return () => { cancelled = true; };
  }, [selected, revision]);

  return <section id="anatomy-collection-study" className={`${surface.surface} ${styles.study}`} data-demo="anatomy-collection-study" aria-labelledby={`${id}-heading`}>
    <p className={styles.eyebrow}>Anatomy · 官方作品对照</p>
    <h3 id={`${id}-heading`}>同一种讲解方法，四种具体做法</h3>
    <div className={styles.choices} role="group" aria-label="选择 Anatomy 官方作品">
      {examples.map(item => <Button
        key={item.id}
        variant={selected === item.id ? 'secondary' : 'tertiary'}
        aria-pressed={selected === item.id}
        aria-controls={`${id}-figure`}
        onPress={() => setSelected(item.id)}
      >{item.label}</Button>)}
    </div>
    <div className={styles.explanation}>
      <h4>{example.title}</h4>
      <p><strong>操作：</strong>{example.action}</p>
      <p><strong>观察：</strong>{example.observation}</p>
    </div>
    <div id={`${id}-figure`} className={styles.figure} data-selected={selected} aria-busy={!Figure && failed !== selected}>
      {failed === selected
        ? <p role="alert" className={styles.placeholder}>作品加载失败。可以重新开始，或<a href={source}>打开官方作品</a>。</p>
        : Figure
          ? <FigureBoundary key={`${selected}-${revision}`} source={source}>
            <Figure theme={theme} />
          </FigureBoundary>
          : <p role="status" className={styles.placeholder}>正在加载 {example.label}。启用 JavaScript 后可在此操作，也可<a href={source}>打开官方作品</a>。</p>}
    </div>
    <p className={styles.mechanism}><strong>对应的规则：</strong>{example.mechanism}</p>
    <div className={styles.footer}>
      <Button size="sm" variant="tertiary" onPress={() => setRevision(value => value + 1)}>重新开始</Button>
      <a href={source}>官方作品与完整说明 ↗</a>
    </div>
    <p className={styles.credit}>原作 Ryan · anatomy-figures 0.1.0 · <a href="/anatomy-figures-LICENSE.txt">MIT 许可</a>。此处保留原作英文读数，中文提示用于对照阅读。</p>
  </section>;
}
