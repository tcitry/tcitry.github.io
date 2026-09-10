import {useEffect} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {MandelbrotCanvas} from './MandelbrotCanvas';
import {formatCoord, formatZoom, MIN_ITER, MAX_ITER} from './mandelbrot-math';
import {PALETTES, paletteGradient} from './mandelbrot-palettes';
import {PRESETS, presetIter} from './mandelbrot-presets';
import {hydrateExplorer, persistExplorer, useExplorer} from './mandelbrot-store';
import '../../styles/demos.css';
import surface from './DemoSurface.module.css';
import styles from './InfiniteCoast.module.css';

export default function InfiniteCoast() {
  const state = useExplorer(s => s);
  useEffect(() => {
    hydrateExplorer();
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || target.isContentEditable || ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT'].includes(target.tagName)) return;
      if (!/^[1-8]$/.test(e.key)) return;
      e.preventDefault();
      const preset = PRESETS[Number(e.key) - 1];
      const s = useExplorer.getState();
      s.beginFlight(preset, presetIter(preset, s.autoIter));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const zoom = (factor: number) => state.beginFlight({re: state.re, im: state.im, scale: state.scale / factor});
  return <main className={`${surface.surface} ${styles.coast}`} data-demo="infinite-coast">
    <MandelbrotCanvas />
    <div className={styles.hud}>
      <header className="flex items-start justify-between gap-3">
        <div><h1 className="m-0 text-xl font-medium tracking-tight">无穷海岸</h1><p className="m-0 mt-1 text-xs text-white/65">曼德勃罗集合 · <a className="text-inherit underline underline-offset-4" href="/labs/">Labs</a> · <a className="text-inherit underline underline-offset-4" href="/docs/Frontend/Tooling/infinite-coast/">玩法</a></p></div>
        <div className="text-right font-mono text-xs text-white/75" data-coast-coordinates>
          <div>Re {formatCoord(state.re)}</div><div>Im {formatCoord(state.im)}</div><div data-coast-zoom>缩放 {formatZoom(state.scale)}</div>
        </div>
      </header>
      <div className="flex flex-col gap-2">
        {state.scale < 2.5e-6 && <p className={styles.notice}>已接近浮点精度极限，细节可能出现块状</p>}
        {state.helpOpen && <aside className={styles.help} id="coast-help"><h2 className="m-0 text-sm">怎么玩</h2><ul className="my-2 pl-4 text-xs leading-6"><li>点击放大；拖动平移；滚轮或双指缩放</li><li>右键或 Shift+点击缩小</li><li>数字 1–8 跳转位置；0 重置；P 切换配色</li><li>方向键平移；+ / − 缩放</li><li>手动调节迭代会关闭自适应</li></ul></aside>}
        <section className={styles.controls} aria-label="分形探索控件">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="tertiary" onPress={() => state.reset()}>重置</Button>
            <Button size="sm" variant="tertiary" isIconOnly aria-label="缩小" onPress={() => zoom(1 / 2.2)}>−</Button>
            <Button size="sm" variant="tertiary" isIconOnly aria-label="放大" onPress={() => zoom(2.2)}>+</Button>
            <Slider className={styles.iterations} minValue={MIN_ITER} maxValue={MAX_ITER} step={1} value={state.maxIter} onChange={v => {state.setMaxIter(Array.isArray(v) ? v[0] : v); persistExplorer();}}>
              <Label className="text-xs">迭代</Label><Slider.Output className="text-xs tabular-nums" />
              <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
            </Slider>
            <Button size="sm" variant="tertiary" aria-pressed={state.autoIter} onPress={() => {state.setAutoIter(!state.autoIter); persistExplorer();}}>自适应</Button>
            <Button size="sm" variant="tertiary" aria-expanded={state.helpOpen} aria-controls="coast-help" onPress={() => state.setHelpOpen(!state.helpOpen)}>{state.helpOpen ? '关闭说明' : '操作说明'}</Button>
          </div>
          <div className="mt-2 flex gap-2" role="group" aria-label="配色">
            {PALETTES.map(p => <Button key={p.id} size="sm" className={styles.palette} style={{backgroundImage: paletteGradient(p)}} aria-label={`配色 ${p.name}`} aria-pressed={p.id === state.paletteId} onPress={() => {state.setPalette(p.id); persistExplorer();}}><span>{p.name}</span></Button>)}
          </div>
          <div className={styles.presets} role="group" aria-label="预设位置">
            {PRESETS.map(p => <Button key={p.id} size="sm" variant="tertiary" onPress={() => state.beginFlight(p, presetIter(p, state.autoIter))}>{p.name}</Button>)}
          </div>
        </section>
      </div>
    </div>
  </main>;
}
