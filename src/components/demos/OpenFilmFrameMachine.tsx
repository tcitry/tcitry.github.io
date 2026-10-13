import demoSurface from './DemoSurface.module.css';
import {useEffect, useId, useRef, useState} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {AnatomySolid, AnatomyLine} from './AnatomyArt';
import {
  FILM_HEIGHT, FILM_MARKER, FILM_MOVING_PARTS, FILM_PART_COUNT, FILM_PLATE_TEXT,
  FILM_POINTER, FILM_SCREEN, FILM_SCREEN_BASELINE, FILM_SHADOW, FILM_STATIC_PARTS, FILM_WIDTH, filmTranslate,
} from './openfilm-frame-geometry';
import {FILM_DURATION, FRAME_SEQUENCES, LAST_TIME, REFERENCE_TIME, followTime, frameAt, initialFrameState, requestFrame, type FrameSequence} from './openfilm-frame-model';
import frameStyles from './AnatomyFrame.module.css';
import styles from './OpenFilmFrameMachine.module.css';

const REST = frameAt(REFERENCE_TIME);
const source = 'https://github.com/openfilm/openfilm/blob/e0a80d515fa13457ece08925575d5453c0b0fc6d/packages/openfilm/SPEC.md#3-the-one-rule-a-frame-is-a-function-of-t';
const labels: Record<FrameSequence, string> = {ordered: '顺序绘制', shuffled: '乱序定位', repeated: '重复 1.50 s'};

/** Anatomy Figure: a film inspection bench for a time-addressed picture. */
export default function OpenFilmFrameMachine({id: rootId}: {id?: string}) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const moving = useRef<SVGGElement>(null);
  const marker = useRef<SVGGElement>(null);
  const pointer = useRef<SVGGElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const timeMetric = useRef<HTMLElement>(null);
  const xMetric = useRef<HTMLElement>(null);
  const signature = useRef<HTMLSpanElement>(null);
  const motion = useRef({time: REFERENCE_TIME, target: REFERENCE_TIME, visible: false, hover: false, focused: false, clock: 0, lastInput: 0, queue: [] as number[], deadline: 0, tour: 0});
  const kick = useRef<() => void>(() => {});
  const model = useRef(initialFrameState());
  const [state, setState] = useState(initialFrameState);
  const [hydrated, setHydrated] = useState(false);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState('拖动时间刻度，或选择一种绘制顺序。');

  useEffect(() => {
    setHydrated(true);
    const element = root.current;
    if (!element) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0, last = 0;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let destroyed = false;
    const paint = () => {
      const frame = frameAt(motion.current.time);
      moving.current?.setAttribute('transform', filmTranslate(frame.carriageTravel));
      pointer.current?.setAttribute('transform', filmTranslate(frame.carriageTravel));
      marker.current?.setAttribute('transform', filmTranslate(frame.previewTravel));
      if (readout.current) readout.current.textContent = `${frame.t.toFixed(2)} s · x=${frame.x.toFixed(2)} px`;
      if (timeMetric.current) timeMetric.current.textContent = `${frame.t.toFixed(2)} s`;
      if (xMetric.current) xMetric.current.textContent = `${frame.x.toFixed(2)} px`;
      if (signature.current) signature.current.textContent = frame.signature;
      element.dataset.currentTime = frame.t.toFixed(4);
      element.dataset.frameX = frame.x.toFixed(4);
      element.dataset.frameSignature = frame.signature;
    };
    const apply = (time: number, record = true) => {
      motion.current.target = time;
      if (record) {model.current = requestFrame(model.current, time); setState(model.current);}
    };
    const tick = (now: number) => {
      raf = 0;
      if (!motion.current.visible || destroyed || document.hidden) {last = 0; return;}
      const dt = last ? Math.max(0, Math.min((now - last) / 1000, 1 / 30)) : 1 / 60;
      last = now;
      const s = motion.current;
      s.clock += dt;
      if (s.queue.length && s.clock >= s.deadline) {
        apply(s.queue.shift()!);
        s.deadline = s.clock + 0.85;
        if (!s.queue.length) {setRunning(false); s.lastInput = s.clock;}
      }
      if (!still.matches && !s.hover && !s.focused && !s.queue.length && s.clock - s.lastInput > 7) {
        // A quiet idle tour only previews time; it does not add fabricated user requests.
        s.target = [0.5, 2.5, 1.5][s.tour % 3]!;
        s.tour += 1;
        s.lastInput = s.clock - 4;
      }
      s.time = followTime(s.time, s.target, dt, still.matches);
      paint();
      if (s.queue.length || s.time !== s.target) raf = requestAnimationFrame(tick);
      else if (!still.matches && !s.hover && !s.focused) {
        // A settled device sleeps until the next tour step; it does not run a 60 fps idle clock.
        idleTimer = setTimeout(() => {
          s.lastInput = s.clock - 7.01;
          start();
        }, Math.max(50, (7 - (s.clock - s.lastInput)) * 1000));
      }
    };
    const start = () => {
      clearTimeout(idleTimer);
      if (!destroyed && !raf && motion.current.visible && !document.hidden) {last = 0; raf = requestAnimationFrame(tick);}
    };
    kick.current = start;
    const observer = new IntersectionObserver(entries => {
      motion.current.visible = entries[entries.length - 1]?.isIntersecting ?? false;
      if (motion.current.visible) start();
      else {clearTimeout(idleTimer); cancelAnimationFrame(raf); raf = 0; last = 0;}
    }, {rootMargin: '0px'});
    observer.observe(element);
    const visibility = () => {if (document.hidden) {clearTimeout(idleTimer); cancelAnimationFrame(raf); raf = 0; last = 0;} else start();};
    const preference = () => {
      if (still.matches) {
        // Finish queued requests without motion when the preference changes mid-sequence.
        for (const time of motion.current.queue) apply(time);
        motion.current.queue = []; motion.current.time = motion.current.target; setRunning(false); paint();
      }
      start();
    };
    document.addEventListener('visibilitychange', visibility);
    still.addEventListener('change', preference);
    paint();
    return () => {destroyed = true; clearTimeout(idleTimer); cancelAnimationFrame(raf); observer.disconnect(); document.removeEventListener('visibilitychange', visibility); still.removeEventListener('change', preference); kick.current = () => {};};
  }, []);

  const interact = () => {motion.current.lastInput = motion.current.clock;};
  const seek = (time: number) => {
    interact(); motion.current.queue = []; motion.current.target = frameAt(time).t;
    model.current = requestFrame(model.current, time); setState(model.current); setRunning(false);
    setMode(`已请求 ${model.current.frame.t.toFixed(2)} s；画面只按这个 t 计算。`);
    kick.current();
  };
  const sequence = (kind: FrameSequence) => {
    interact();
    const times = FRAME_SEQUENCES[kind];
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const time of times) model.current = requestFrame(model.current, time);
      motion.current.target = model.current.frame.t;
      motion.current.queue = []; setState(model.current); setRunning(false);
    } else {
      motion.current.queue = [...times]; motion.current.deadline = motion.current.clock; setRunning(true);
    }
    setMode(`${labels[kind]}：${times.map(t => t.toFixed(2)).join(' → ')} s。最终都回到 1.50 s。`);
    kick.current();
  };
  return <section ref={root} id={rootId ?? 'openfilm-frame-machine'} className={`${demoSurface.surface} ${frameStyles.surface}`} data-book-island data-demo="openfilm-frame-machine" data-hydrated={hydrated} data-part-count={FILM_PART_COUNT} aria-labelledby={`${id}-title`}
    onPointerEnter={() => {motion.current.hover = true; interact(); kick.current();}} onPointerLeave={() => {motion.current.hover = false; interact(); kick.current();}}
    onFocusCapture={() => {motion.current.focused = true; interact(); kick.current();}} onBlurCapture={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {motion.current.focused = false; interact(); kick.current();}}}>
    <p className={frameStyles.eyebrow}>ANATOMY · FIGURE · FRAME(T)</p>
    <h3 id={`${id}-title`} className={frameStyles.heading}>同一时刻，同一画面</h3>
    <p>把片段当成一条可定位的刻度尺。滑架选择 <code>t</code>，屏幕重新计算这一帧；跳过哪些时刻、上一次停在哪里，都不参与画面计算。</p>
    <div className={`${frameStyles.card} iso-plate`}>
      <div className={frameStyles.corners}><span>Fig. 1 · 电影逐帧检验台</span><span>frame(t) = picture</span></div>
      <div className={styles.stage}>
        <svg className={frameStyles.figure} viewBox={`0 0 ${FILM_WIDTH} ${FILM_HEIGHT}`} role="img" aria-labelledby={`${id}-svg-title ${id}-svg-desc`}>
          <title id={`${id}-svg-title`}>时间定位检验台</title>
          <desc id={`${id}-svg-desc`}>带屏幕、胶片孔、双导轨和时间标尺的检验台。滑架按 t 定位，屏幕方块按 x=40+500t/3 定位。两者共享当前显示时间。</desc>
          <path d={FILM_SHADOW} className={styles.shadow} />
          {FILM_STATIC_PARTS.map(part => <g key={part.name}><AnatomySolid paths={part.paths} tone={part.tone} lit={part.lit} name={part.name} />{part.line && <AnatomyLine d={part.line} />}</g>)}
          <path className={styles.screen} d={FILM_SCREEN} />
          <path className={styles.baseline} d={FILM_SCREEN_BASELINE} />
          <g ref={marker} transform={filmTranslate(REST.previewTravel)} data-frame-marker><path className={styles.marker} d={FILM_MARKER} /></g>
          <g ref={moving} transform={filmTranslate(REST.carriageTravel)} data-frame-carriage>
            {FILM_MOVING_PARTS.map(part => <g key={part.name}><AnatomySolid paths={part.paths} tone={part.tone} lit={part.lit} name={part.name} />{part.line && <AnatomyLine d={part.line} />}</g>)}
          </g>
          <g ref={pointer} transform={filmTranslate(REST.carriageTravel)}><path d={FILM_POINTER} className={styles.pointer} /></g>
          <AnatomyLine d={FILM_PLATE_TEXT} free />
        </svg>
      </div>
      <div className={frameStyles.corners}><span>拖动刻度，比较三种请求顺序</span><span ref={readout} data-readout>1.50 s · x=290.00 px</span></div>
    </div>
    <div className={styles.fields}>
      <Slider value={state.frame.t} minValue={0} maxValue={LAST_TIME} step={0.01} isDisabled={!hydrated}
        formatOptions={{minimumFractionDigits: 2, maximumFractionDigits: 2}} onChange={value => seek(Array.isArray(value) ? value[0] : value)}>
        <Label>请求时间 t（秒）</Label><Slider.Output />
        <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
      </Slider>
      <span className={frameStyles.note}>0–{LAST_TIME} s · 每次 0.01 s</span>
    </div>
    <div className={`${frameStyles.controls} ${styles.controls}`}>
      {(Object.keys(FRAME_SEQUENCES) as FrameSequence[]).map(kind => <Button key={kind} size="sm" variant="outline" onPress={() => sequence(kind)} isDisabled={!hydrated}>{labels[kind]}</Button>)}
      <Button size="sm" variant="outline" onPress={() => seek(REFERENCE_TIME)} isDisabled={!hydrated}>定位 1.50 s</Button>
    </div>
    <p className={styles.status} role="status" aria-live="polite" aria-atomic="true">{running ? '检验中。' : ''}{mode} {state.referenceChecks > 0 && <strong>已核对 1.50 s {state.referenceChecks} 次，几何结果一致。</strong>}</p>
    <ol className={styles.history} aria-label="最近八次请求">{state.history.map((request, i) => <li key={`${state.requests - state.history.length + i}`} data-reference={request.t === REFERENCE_TIME || undefined}>{request.t.toFixed(2)} s</li>)}</ol>
    <div className={frameStyles.readout}>
      <div className={frameStyles.metric}><strong ref={timeMetric}>1.50 s</strong><span>当前显示时间</span></div>
      <div className={frameStyles.metric}><strong ref={xMetric}>290.00 px</strong><span>示例方块的 x 坐标</span></div>
      <div className={frameStyles.metric}><strong>{state.requests}</strong><span>实际请求次数</span></div>
    </div>
    <p className={styles.signature}>几何签名：<span ref={signature} data-frame-signature>{REST.signature}</span></p>
    <p className={frameStyles.note}>教学模型：<code>x = 40 + 500 × t / {FILM_DURATION}</code>。刻度范围为 0–{LAST_TIME} s，保持在三秒片段的结束时刻之前。签名记录方块几何；真实 <code>look</code> 比较浏览器截图并允许像素差异。此处没有运行 OpenFilm、Chromium 导出或 FFmpeg。</p>
    <p className={frameStyles.note}><a href={source}>固定版本 SPEC：a frame is a function of t</a> · <a href="https://github.com/openfilm/openfilm/blob/e0a80d515fa13457ece08925575d5453c0b0fc6d/packages/openfilm/src/look.mjs#L88-L101">look 的乱序检查</a>。装置外形是 Anatomy 教学比喻。</p>
  </section>;
}
