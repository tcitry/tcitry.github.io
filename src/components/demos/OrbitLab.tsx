import {useEffect, useRef, useState} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {OrbitEngine} from './orbit-engine';
import {MASS_PRESETS} from './orbit-types';
import {SCENARIOS} from './orbit-scenarios';
import {useOrbit} from './orbit-store';
import '../../styles/demos.css';
import surface from './DemoSurface.module.css';
import styles from './OrbitLab.module.css';

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

export default function OrbitLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const state = useOrbit(s => s);
  useEffect(() => {
    if (!canvasRef.current) return;
    let engine: OrbitEngine | undefined;
    try {
      engine = new OrbitEngine(canvasRef.current);
      engine.start();
      setReady(true);
    } catch {
      setError('无法启动画布，请检查浏览器是否支持 Canvas 2D，然后刷新重试。');
    }
    return () => engine?.destroy();
  }, []);

  return <main className={`${surface.surface} ${styles.lab}`} data-demo="orbit" data-orbit-ready={ready}>
    <h1 className="sr-only">Orbit 轨道重力实验室</h1>
    <canvas ref={canvasRef} className={styles.canvas} aria-label="重力模拟画布" tabIndex={0} />
    {error ? <div className={styles.intro}><p role="alert">{error}</p><a href="/labs/">返回 Labs</a></div> : state.intro ?
      <div className={styles.intro} onClick={() => ready && state.dismissIntro()}>
        <p className="m-0 text-xs tracking-[0.3em] text-white/50">N-BODY LAB</p>
        <p className="my-4 text-6xl font-medium tracking-tight">Orbit</p>
        <p className="m-0 max-w-xs text-sm leading-6 text-white/65">向后拉，再松手。抛出一颗行星，观察引力、轨道与碰撞。</p>
        <Button className="mt-8" variant="secondary" isDisabled={!ready} onPress={() => state.dismissIntro()}>开始探索</Button>
      </div> : <>
        <header className={styles.header}>
          <div className={styles.identity}><p className="m-0 text-sm font-medium">Orbit</p><p className="m-0 mt-1 text-xs text-white/55">轨道重力实验室</p><div className="mt-2 flex gap-3 text-xs"><a href="/labs/">Labs</a><a href="/docs/Frontend/Tooling/orbit-gravity-lab/">玩法</a></div></div>
          <div className={styles.stats}><div><span data-orbit-count>{state.bodyCount}</span> 天体</div><div className="mt-1 text-white/50" data-orbit-time>{formatTime(state.simTime)}</div></div>
        </header>
        <section className={styles.controls} aria-label="轨道实验控件">
          <div><p className={styles.label}>质量</p><div className="grid grid-cols-5 gap-1" role="group" aria-label="天体质量">
            {MASS_PRESETS.map((p, i) => <Button key={p.kind} className={styles.mass} variant="tertiary" aria-pressed={state.massKind === p.kind} onPress={() => state.setMassKind(p.kind)}><span aria-hidden="true" style={{width: 5 + i * 2, height: 5 + i * 2, background: 'currentColor'}} className="rounded-full" />{p.label}</Button>)}
          </div></div>
          <Slider className={styles.time} minValue={0.1} maxValue={3} step={0.05} value={state.timeScale} onChange={v => state.setTimeScale(Array.isArray(v) ? v[0] : v)}>
            <Label>时间尺度</Label><Slider.Output>{({state: slider}) => `${slider.getThumbValue(0).toFixed(2)}×`}</Slider.Output><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
          </Slider>
          <div className="grid grid-cols-4 gap-1">
            <Button size="sm" variant="tertiary" onPress={state.togglePaused}>{state.paused ? '继续' : '暂停'}</Button>
            <Button size="sm" variant="tertiary" onPress={() => state.setTrails(!state.trails)} aria-pressed={state.trails}>轨迹</Button>
            <Button size="sm" variant="tertiary" onPress={() => state.setFollow(!state.follow)} aria-pressed={state.follow}>跟随</Button>
            <Button size="sm" variant="tertiary" onPress={() => state.api.clear()}>清除</Button>
          </div>
          <div className="grid grid-cols-3 gap-1" role="group" aria-label="碰撞与视图">
            <Button size="sm" variant="tertiary" aria-pressed={state.collide === 'merge'} onPress={() => state.setCollide('merge')}>合并</Button>
            <Button size="sm" variant="tertiary" aria-pressed={state.collide === 'bounce'} onPress={() => state.setCollide('bounce')}>弹开</Button>
            <Button size="sm" variant="tertiary" onPress={() => state.api.recenter()}>复位</Button>
          </div>
          <div><p className={styles.label}>场景</p><div className="grid grid-cols-5 gap-1" role="group" aria-label="预设场景">
            {SCENARIOS.map(s => <Button key={s.id} size="sm" variant="tertiary" aria-pressed={state.scenario === s.id} onPress={() => state.api.loadScenario(s.id)}>{s.label}</Button>)}
          </div><p className={styles.hint}>{SCENARIOS.find(s => s.id === state.scenario)?.hint}</p></div>
          {state.selectedId != null && <div className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2 py-1"><p className="m-0 font-mono text-xs text-white/65">m {state.selectedMass.toFixed(1)} · v <span data-orbit-speed>{state.selectedSpeed.toFixed(1)}</span></p><Button size="sm" variant="ghost" onPress={() => state.api.deleteSelected()}>删除选中</Button></div>}
          <p className={`${styles.hint} ${styles.instructions}`}>轻点放置，向后拉再松手抛出。滚轮缩放，右键拖动平移；触屏双指平移或捏合。</p>
        </section>
      </>}
  </main>;
}
