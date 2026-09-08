import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from 'react';
import {Button, Disclosure, Label, Radio, RadioGroup, Slider, Switch} from '@heroui/react';
import {CodeBlock} from '@heroui-pro/react/code-block';
import {createThreeBasicsScene, initialSceneState, type SceneController, type SceneState} from './three-basics';
import '../../styles/demos.css';
import surfaceStyles from './DemoSurface.module.css';
import styles from './ThreeBasics.module.css';

const shapes = [
  {value: 'cube', label: '立方体'},
  {value: 'sphere', label: '球体'},
  {value: 'torus', label: '圆环'},
] as const;
const colors = [
  {value: '#257f81', label: '湖蓝'},
  {value: '#c66a48', label: '陶土'},
  {value: '#728352', label: '苔绿'},
];

/** React owns the controls; the scene owns only the canvas inside its empty host. */
export default function ThreeBasicsView() {
  const canvasHost = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneController | null>(null);
  const [state, setState] = useState<SceneState>({...initialSceneState});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusMessage, setStatusMessage] = useState('正在准备 3D 场景…');
  const [embedded, setEmbedded] = useState(false);
  const [codeExpanded, setCodeExpanded] = useState(false);
  const disabled = status !== 'ready';

  useLayoutEffect(() => {
    const host = canvasHost.current;
    if (!host) return;
    setEmbedded(window.self !== window.top);
    const controller = createThreeBasicsScene(host, (nextStatus, message) => {
      setStatus(nextStatus);
      if (message) setStatusMessage(message);
    });
    scene.current = controller;
    return () => {
      scene.current = null;
      controller.dispose();
    };
  }, []);

  useEffect(() => {
    scene.current?.update(state);
  }, [state]);

  function update<K extends keyof SceneState>(key: K, value: SceneState[K]) {
    setState(current => ({...current, [key]: value}));
  }

  function reset() {
    scene.current?.reset();
    setState({...initialSceneState});
  }

  const code = `mesh.geometry = geometries.${state.geometry};
material.color.set('${state.material}'); material.wireframe = ${state.wireframe};
ambient.intensity = ${state.light.toFixed(1)} * 0.625; key.intensity = ${state.light.toFixed(1)} * 1.4;
// 每帧旋转物体：${state.rotation ? '开启' : '关闭'}`;

  return (
    <div className={`${surfaceStyles.surface} ${styles.demo}`} data-demo="threejs-basics" data-state={status} data-embedded={embedded} data-book-island>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Three.js / 交互观察台</p>
            <h1 className={styles.title}>亲手改变一个 3D 场景</h1>
            <p className={styles.intro}>从形状、颜色和光开始。每一次操作，都能在画面中找到对应的变化。</p>
          </div>
          <nav className={styles.demoLinks} aria-label="演示导航">
            <a className={styles.backLink} href="/labs/" target="_top">全部演示</a>
            <a className={styles.backLink} href="/docs/Frontend/Tooling/threejs-and-blender-guide/" target="_top">返回入门文章</a>
          </nav>
        </header>

        <div className={styles.workspace}>
          <section className={styles.stage} aria-label="3D 观察区域">
            <div className={styles.stageLabel} aria-hidden="true">Scene / 场景</div>
            <div className={styles.viewport} data-viewport>
              <div ref={canvasHost} className={styles.canvasHost} data-canvas-host />
              <div className={styles.fallback} data-status role="status" hidden={status === 'ready'}>
                <p>{statusMessage}</p>
                <noscript><p>启用 JavaScript 后即可操作。你仍可以阅读下方的概念说明，或返回入门文章。</p></noscript>
              </div>
            </div>
            <div className={styles.cameraHelp} id="three-camera-help">
              <strong>Camera</strong>
              <span>拖动查看 · 滚轮 / 双指缩放<br />键盘：聚焦画面后用方向键观察，＋ / － 缩放</span>
            </div>
          </section>

          <form className={styles.panel} aria-label="场景控制" onSubmit={event => event.preventDefault()}>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle} id="three-geometry-heading">Geometry</h2>
              <p className={styles.explanation} id="three-geometry-help">改变形状，其他设置保持不变。</p>
              <RadioGroup className={styles.choiceGroup} name="geometry" aria-labelledby="three-geometry-heading" aria-describedby="three-geometry-help" orientation="horizontal" value={state.geometry} isDisabled={disabled} onChange={value => {
                if (value === 'cube' || value === 'sphere' || value === 'torus') update('geometry', value);
              }}>
                {shapes.map(({value, label}) => (
                  <Radio key={value} className={styles.choice} value={value}>
                    <Radio.Content className={styles.choiceContent}>
                      <Radio.Control><Radio.Indicator /></Radio.Control>
                      <Label className={styles.choiceLabel}>{label}</Label>
                    </Radio.Content>
                  </Radio>
                ))}
              </RadioGroup>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle} id="three-material-heading">Material</h2>
              <p className={styles.explanation} id="three-material-help">改变表面颜色，物体形状不变。</p>
              <RadioGroup className={styles.choiceGroup} name="material" aria-labelledby="three-material-heading" aria-describedby="three-material-help" orientation="horizontal" value={state.material} isDisabled={disabled} onChange={value => update('material', value)}>
                {colors.map(({value, label}) => (
                  <Radio key={value} className={styles.choice} value={value}>
                    <Radio.Content className={styles.choiceContent}>
                      <Radio.Control><Radio.Indicator /></Radio.Control>
                      <Label className={styles.choiceLabel}>{label}<span className={styles.swatch} style={{'--swatch': value} as CSSProperties} aria-hidden="true" /></Label>
                    </Radio.Content>
                  </Radio>
                ))}
              </RadioGroup>
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Light</h2>
              <p className={styles.explanation}>调暗光线，观察表面的明暗变化。</p>
              <Slider className={styles.lightSlider} value={state.light} onChange={value => update('light', Array.isArray(value) ? value[0] : value)} minValue={0} maxValue={5} step={0.1} isDisabled={disabled} formatOptions={{minimumFractionDigits: 1, maximumFractionDigits: 1}}>
                <Label className="text-xs">Light 强度</Label>
                <Slider.Output className="text-xs tabular-nums" data-light-value />
                <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
              </Slider>
              <div className={styles.lightEndpoints} aria-hidden="true"><span>暗</span><span>亮</span></div>
            </section>

            <div className={styles.toggles} role="group" aria-label="观察方式">
              <Switch className={styles.toggle} name="wireframe" isSelected={state.wireframe} onChange={value => update('wireframe', value)} isDisabled={disabled} aria-describedby="three-wireframe-help">
                <Switch.Content className={styles.toggleContent}>
                  <Label elementType="span">显示线框</Label>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                </Switch.Content>
                <p className={styles.toggleHelp} id="three-wireframe-help">沿着三角形边线，看看 Geometry 的结构。</p>
              </Switch>
              <Switch className={styles.toggle} name="rotation" isSelected={state.rotation} onChange={value => update('rotation', value)} isDisabled={disabled} aria-describedby="three-rotation-help">
                <Switch.Content className={styles.toggleContent}>
                  <Label elementType="span">自动旋转</Label>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                </Switch.Content>
                <p className={styles.toggleHelp} id="three-rotation-help">让物体随时间转动，观察 Animation。</p>
              </Switch>
            </div>
            <Button className="w-full" variant="outline" type="button" onPress={reset} data-reset isDisabled={disabled}>重置场景</Button>
          </form>
        </div>

        <Disclosure className={styles.codeDisclosure} isExpanded={codeExpanded} onExpandedChange={setCodeExpanded}>
          <Disclosure.Heading className={styles.codeHeading}>
            <Disclosure.Trigger className={styles.codeTrigger}><span>查看对应代码</span><Disclosure.Indicator /></Disclosure.Trigger>
          </Disclosure.Heading>
          <Disclosure.Content>
            <Disclosure.Body className="min-w-0 px-0 pb-0">
              <p className={styles.codeHelp}>这段示意代码随当前设置更新；最后一行标记自动旋转的状态。完整场景还需要 Camera 和 Rendering。</p>
              {codeExpanded && <CodeBlock className="min-w-0 max-w-full rounded-xl">
                <CodeBlock.Header><span className="text-xs text-muted">JavaScript · 当前场景</span><CodeBlock.CopyButton code={code} aria-label="复制场景代码" /></CodeBlock.Header>
                <CodeBlock.Code code={code} language="javascript" theme="github-light" darkTheme="github-dark" />
              </CodeBlock>}
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>

        <footer className={styles.footer}>
          <p><strong>试着只改一项。</strong> 拖动时移动的是 Camera；开启自动旋转时，转动的是物体本身。</p>
          <p className={styles.credit}>AI 辅助制作 · Agent：Codex</p>
        </footer>
      </main>
    </div>
  );
}
