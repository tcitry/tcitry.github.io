import {useEffect, useId, useRef, useState} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {AnatomySolid} from './AnatomyArt';
import {boardAt, HEIGHT, SHADOW, WIDTH} from './cal-diy-availability-geometry';
import {CAL_DIY_REVISION, DEFAULT_INPUT, PRESETS, formatRange, formatTime, type AvailabilityInput} from './cal-diy-availability-model';
import surface from './DemoSurface.module.css';
import anatomy from './AnatomyFrame.module.css';
import styles from './CalDiyAvailabilityFigure.module.css';

const SOURCE = `https://github.com/calcom/cal.diy/blob/${CAL_DIY_REVISION}/packages/features/schedules/lib/date-ranges.ts#L423-L452`;

export default function CalDiyAvailabilityFigure({id = 'cal-diy-availability'}: {id?: string}) {
  const uid = useId();
  const root = useRef<HTMLElement>(null);
  const [input, setInput] = useState<AvailabilityInput>(DEFAULT_INPUT);
  const [ready, setReady] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  const [tour, setTour] = useState(false);
  const [touched, setTouched] = useState(false);
  const {frame, parts} = boardAt(input);
  useEffect(() => {
    setReady(true);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const preference = () => {setReduced(media.matches); if (media.matches) setTour(false);};
    preference(); media.addEventListener('change', preference);
    const observer = new IntersectionObserver(entries => setVisible(entries[entries.length - 1]?.isIntersecting ?? false));
    if (root.current) observer.observe(root.current);
    const visibility = () => setForeground(!document.hidden);
    visibility(); document.addEventListener('visibilitychange', visibility);
    return () => {observer.disconnect(); media.removeEventListener('change', preference); document.removeEventListener('visibilitychange', visibility);};
  }, []);
  useEffect(() => {
    if (!ready || !visible || !foreground || reduced || touched || tour) return;
    const timer = setTimeout(() => setTour(true), 9000);
    return () => clearTimeout(timer);
  }, [ready, visible, foreground, reduced, touched, tour]);
  useEffect(() => {
    if (!tour || reduced || !visible || !foreground) return;
    // Discrete algorithm steps are exact snapshots, not interpolated bookings.
    let step = 0;
    setInput(value => ({...value, step}));
    const timer = setInterval(() => {step = (step + 1) % 3; setInput(value => ({...value, step}));}, 2400);
    return () => clearInterval(timer);
  }, [tour, reduced, visible, foreground]);
  const stop = () => {setTouched(true); setTour(false);};
  const update = (patch: Partial<AvailabilityInput>) => {stop(); setInput(value => ({...value, ...patch}));};
  const result = frame.remaining.length ? frame.remaining.map(formatRange).join('、') : '无剩余区间';
  const busyA = frame.busy[0]!;
  const busyB = frame.busy[1]!;

  return <section ref={root} id={id} className={`${surface.surface} ${anatomy.surface} ${styles.root}`} data-book-island data-demo="cal-diy-availability" data-hydrated={ready} data-step={frame.step} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <span className={styles.eyebrow}>ANATOMY · FIG. 01</span>
      <h3 id={`${uid}-title`}>Busy 怎样把一段开放时间切开</h3>
      <p>四条时间槽使用同一把尺。空隙就是被 Busy 排除的部分，亮色片段是差集。</p>
    </header>
    <figure className={styles.figure}>
      <div className={styles.card}>
        <div className={styles.corner}><span>区间排版尺 · 固定 UTC 单日</span><span>08:00 → 18:00</span></div>
        <svg className={styles.drawing} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`${uid}-art-title ${uid}-art-desc`}>
          <title id={`${uid}-art-title`}>四槽时间区间比较尺</title>
          <desc id={`${uid}-art-desc`}>从后向前：开放时间 {formatRange(frame.source)}；Busy A {formatRange(busyA)}；Busy B {formatRange(busyB)}；处理前 {frame.step} 段 Busy 后的剩余区间为 {result}。所有区间按相同时间比例切出实物条片，结果不是最终可预约 Slots。</desc>
          <path className={styles.shadow} d={SHADOW} />
          {parts.map(part => <g key={part.name} className={part.inactive ? styles.inactive : undefined}>
            <AnatomySolid name={part.name} paths={part.paths} tone={part.tone} lit={part.lit} />
            {part.line && <path className={`${anatomy.line} iso-line`} d={part.line} />}
          </g>)}
        </svg>
        <div className={styles.corner}><span>后 → 前：开放 · A · B · 剩余</span><strong data-readout>{frame.remaining.length} 段 · {frame.minutes} 分钟</strong></div>
      </div>
      <figcaption className={styles.caption}>每格 15 分钟，长刻度为 1 小时。结果槽中保留的条片与原始区间严格对齐；Busy 的重叠部分只扣除一次。</figcaption>
    </figure>

    <dl className={styles.ranges}>
      <div><dt><i className={styles.openKey} />原始开放</dt><dd>{formatRange(frame.source)}</dd></div>
      <div data-busy="A"><dt><i />Busy A{!frame.applied.some(range => range.id === 'A') && <small>未应用</small>}</dt><dd>{formatRange(busyA)}</dd></div>
      <div data-busy="B"><dt><i />Busy B{!frame.applied.some(range => range.id === 'B') && <small>未应用</small>}</dt><dd>{formatRange(busyB)}</dd></div>
      <div className={styles.result}><dt><i />剩余区间</dt><dd data-result>{result}</dd></div>
    </dl>

    <div className={styles.controls} onPointerDown={stop} onFocusCapture={stop}>
      <div className={styles.sliders}>
        <Slider minValue={480} maxValue={1020} step={15} value={input.secondStart} onChange={value => update({secondStart: Array.isArray(value) ? value[0]! : value, step: 2})} isDisabled={!ready}>
          <Label>Busy B 开始（UTC）</Label><Slider.Output>{formatTime(busyB.start)}</Slider.Output><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
        </Slider>
        <Slider minValue={0} maxValue={Math.min(240, 1080 - input.secondStart)} step={15} value={busyB.end - busyB.start} onChange={value => update({secondDuration: Array.isArray(value) ? value[0]! : value, step: 2})} isDisabled={!ready}>
          <Label>Busy B 时长（分钟）</Label><Slider.Output /><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
        </Slider>
      </div>
      <div className={styles.presets} aria-label="区间边界预设">
        {PRESETS.map(preset => <Button key={preset.id} size="sm" variant="outline" onPress={() => {stop(); setInput({...preset.input});}} isDisabled={!ready}>{preset.label}</Button>)}
      </div>
      <p className={styles.stepLabel}>按开始时间排序，取前 N 段 Busy 重新计算：</p>
      <div className={styles.steps} role="group" aria-label="查看区间切分步骤">
        {[0, 1, 2].map(step => <Button key={step} size="sm" variant={frame.step === step ? 'secondary' : 'outline'} aria-pressed={frame.step === step} onPress={() => update({step})} isDisabled={!ready}>{step === 0 ? '① 原始区间' : `减去 ${frame.sorted[step - 1]!.id}${step === 2 ? ' · 完成' : ''}`}</Button>)}
      </div>
    </div>
    {!reduced && <div className={styles.tour}><Button size="sm" variant="ghost" data-action="tour" onPress={() => {setTouched(true); setTour(value => !value);}} isDisabled={!ready}>{tour ? '暂停步骤演示' : '自动演示步骤'}</Button></div>}
    <p className={styles.status} role="status" aria-live={tour ? 'off' : 'polite'}>取前 {frame.step} 段 Busy 为输入，扣除 {frame.removedMinutes} 分钟；剩余 {frame.minutes} 分钟，分为 {frame.remaining.length} 段。</p>
    <details className={styles.source}><summary>与源码核对</summary><p>复现固定提交中 <a href={SOURCE}><code>subtract()</code></a> 的排序、游标推进和左右段输出。相接端点不会删去时间；相互重叠或跨出开放范围的 Busy 按同一规则处理。UI 的零时长 Busy 不传入差集函数。</p></details>
    <p className={styles.boundary}>这里只计算同一天的区间差集。剩余区间还须经过时长、间隔等约束才会成为 Slots；本图没有调用 Cal.diy，也没有处理时区、Buffer、外部日历同步或预约写入。</p>
  </section>;
}
