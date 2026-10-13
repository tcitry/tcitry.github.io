import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {AnatomyDots, AnatomyLine, AnatomySolid} from './AnatomyArt';
import {depthOf, translateAlong} from './anatomy-iso-kit';
import {
  COMPOSER_PARTS, COMPOSER_PART_COUNT, COMPOSER_PROJECTION, COMPOSER_WIDTH, COMPOSER_HEIGHT,
  COMPOSER_HALO, INPUT_PRINTS, DIE_PRINTS, OUTPUT_PRINT, SELECTOR_OFFSET,
} from './heroui-agent-composer-geometry';
import {
  composerState, CONTRACT_SUMMARY, DAYS, MAX_QUANTITY, PRESETS, PRESENTATIONS,
  PRESENTATION_LABELS, quantityWidth, type DatasetPreset, type Presentation,
} from './heroui-agent-composer-model';
import demoSurface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './HeroUIAgentComposer.module.css';

const STEP_LABELS = ['Client Tool 数据', '选择组件 Schema', 'JSONL 与校验', '呈现结果'] as const;
const typeIndex = (presentation: Presentation) => PRESENTATIONS.indexOf(presentation);

/** Browser-only effects move the carriage; all numbers and first-render UI are SSR-safe. */
export default function HeroUIAgentComposer() {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const layer = useRef<SVGGElement>(null);
  const target = useRef(0);
  const wake = useRef<(() => void) | null>(null);
  const [quantities, setQuantities] = useState<number[]>(() => [...PRESETS.steady.quantities]);
  const [presentation, setPresentation] = useState<Presentation>('bar-chart');
  const [missing, setMissing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  const [reduced, setReduced] = useState(true);
  const [tour, setTour] = useState(false);
  const [stage, setStage] = useState(3);
  const [selectedRow, setSelectedRow] = useState(0);
  const [descending, setDescending] = useState(false);
  const [metricSources, setMetricSources] = useState(false);
  const state = useMemo(() => composerState(quantities, presentation, missing), [quantities, presentation, missing]);
  const rows = useMemo(() => state.data.rows.map((row, index) => ({...row, index})).sort((a, b) => descending ? (b.quantity ?? 0) - (a.quantity ?? 0) : a.index - b.index), [state.data.rows, descending]);

  useEffect(() => {
    setHydrated(true);
    const host = root.current;const parts = layer.current;
    if (!host || !parts) return;
    const nodes = Array.from(parts.querySelectorAll<SVGGElement>(':scope > g[data-part]'));
    const moving = nodes.filter(node => node.dataset.family === 'selector');
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    let inView = false;let handle = 0;let last = 0;let position = 0;
    const place = () => {
      const offset = SELECTOR_OFFSET(position);const lift = depthOf(offset, COMPOSER_PROJECTION);
      moving.forEach(node => node.setAttribute('transform', translateAlong(COMPOSER_PROJECTION, offset)));
      const ordered = nodes.slice().sort((a, b) => Number(a.dataset.depth) + (a.dataset.family === 'selector' ? lift : 0)
        - Number(b.dataset.depth) - (b.dataset.family === 'selector' ? lift : 0));
      ordered.forEach(node => parts.appendChild(node));
    };
    const tick = (now: number) => {
      handle = 0;
      if (!inView || document.hidden) {last = 0;return;}
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;last = now;
      position = calm.matches ? target.current : position + (target.current - position) * (1 - Math.exp(-dt / 0.17));
      if (Math.abs(position - target.current) < 0.001) position = target.current;
      place();if (position !== target.current) handle = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (calm.matches) {position = target.current;place();return;}
      if (!handle && inView && !document.hidden) {last = 0;handle = requestAnimationFrame(tick);}
    };
    wake.current = kick;
    const observer = new IntersectionObserver(entries => {
      inView = entries.at(-1)?.isIntersecting ?? false;setVisible(inView);
      if (inView) kick();else if (handle) {cancelAnimationFrame(handle);handle = 0;last = 0;}
    });observer.observe(host);
    const onVisibility = () => {setForeground(!document.hidden);if (document.hidden && handle) {cancelAnimationFrame(handle);handle = 0;}else kick();};
    const onPreference = () => {setReduced(calm.matches);if (calm.matches) {setTour(false);setStage(3);}kick();};
    onVisibility();onPreference();
    document.addEventListener('visibilitychange', onVisibility);calm.addEventListener('change', onPreference);
    return () => {observer.disconnect();if (handle) cancelAnimationFrame(handle);
      document.removeEventListener('visibilitychange', onVisibility);calm.removeEventListener('change', onPreference);wake.current = null;};
  }, []);
  useEffect(() => {target.current = typeIndex(presentation);wake.current?.();}, [presentation]);
  useEffect(() => {
    if (!tour || !visible || !foreground || reduced) return;
    const timer = setInterval(() => setStage(current => (current + 1) % 4), 1600);
    return () => clearInterval(timer);
  }, [tour, visible, foreground, reduced]);
  const manual = () => {setTour(false);setStage(3);};
  function preset(name: DatasetPreset) {manual();setQuantities([...PRESETS[name].quantities]);}
  function reset() {manual();setQuantities([...PRESETS.steady.quantities]);setPresentation('bar-chart');setMissing(false);setSelectedRow(0);setDescending(false);setMetricSources(false);}
  const readout = state.accepted ? `${PRESENTATION_LABELS[presentation]} · ${state.data.total} 件 · Schema 通过` : '缺失必需字段 · 教学校验拒绝';
  const selected = state.data.rows[selectedRow]!;

  return <section ref={root} className={`${demoSurface.surface} ${frame.surface} ${styles.demo}`} data-demo="heroui-agent-composer" data-book-island
    data-hydrated={hydrated} data-accepted={state.accepted} data-presentation={presentation} data-stage={stage} aria-labelledby={`${id}-heading`}>
    <p className={frame.eyebrow}>Anatomy / 数据与界面</p>
    <h3 className={frame.heading} id={`${id}-heading`}>一份销量数据，如何成为三种界面？</h3>
    <p className={frame.note}>改变左侧数量或切换组件，观察数据字段、JSONL 与结果一起变化。工作台的三副模具表示组件 Schema，滑台表示选择；真实输出始终来自下方可核对的数据。</p>
    <ol className={styles.steps} aria-label="生成界面的四个步骤">{STEP_LABELS.map((label, index) => <li key={label} data-current={stage === index}><span>{index + 1}</span><strong>{label}</strong></li>)}</ol>
    <div className={frame.card}>
      <div className={frame.corners}><span>Fig 01 · 数据制版工作台</span><span>教学模型 · 本地预设数据</span></div>
      <svg className={`${frame.figure} ${styles.figure}`} viewBox={`0 0 ${COMPOSER_WIDTH} ${COMPOSER_HEIGHT}`} role="img" aria-labelledby={`${id}-title ${id}-description`} data-anatomy-parts={COMPOSER_PART_COUNT}>
        <title id={`${id}-title`}>销量数据通过组件 Schema 成为界面</title>
        <desc id={`${id}-description`}>左侧四张数据条分别显示 {state.values.map(value => value ?? '缺失').join('、')} 件；中间滑台选择{PRESENTATION_LABELS[presentation]}的 Schema；右侧{state.accepted ? `显示相同数据，合计 ${state.data.total} 件` : '因为必需数值缺失，不呈现数据界面'}。</desc>
        <defs><clipPath id={`${id}-screen`}><rect width={OUTPUT_PRINT.width} height={OUTPUT_PRINT.height} rx="1" /></clipPath></defs>
        <path d={COMPOSER_HALO} className={styles.halo} />
        <g ref={layer}>{COMPOSER_PARTS.map(part => <g key={part.name} data-part={part.name} data-family={part.family} data-depth={part.key}>
          <AnatomySolid paths={part.paths} tone={part.tone} lit={part.family === 'selector'} name={part.name} />
          {part.lines.map((line, index) => <AnatomyLine key={index} {...line} />)}
          <AnatomyDots points={part.screws} size={0.6} />
          {INPUT_PRINTS.map((print, index) => part.name === print.name ? <g key={print.name} transform={print.transform} className={styles.print}>
            <text x="2" y="7" fontSize="6">{DAYS[index]}</text><text x="81" y="7" textAnchor="end" fontSize="8">{state.values[index] ?? '?'}</text>
            <rect x="2" y="9" width="78" height="3" className={styles.screenTrack} />
            <rect x="2" y="9" width={quantityWidth(state.values[index], 78)} height="3" className={styles.screenBar} />
          </g> : null)}
          {DIE_PRINTS.map((print, index) => part.name === print.name ? <g key={print.name} transform={print.transform} className={styles.print} data-picked={typeIndex(presentation) === index}>
            <rect x="0.5" y="0.5" width="18" height="27" className={styles.dieBorder} style={{fill: 'none'}} />
            {index === 0 ? <path d="M3 22V16H6V22ZM8 22V9H11V22ZM13 22V13H16V22Z" className={styles.dieIcon} />
              : index === 1 ? <><text x="9.5" y="17" fontSize="10" textAnchor="middle">Σ</text><path d="M3 23H16" className={styles.printRule} style={{fill: 'none'}} data-free="both" /></>
                : <path d="M3 8H16V22H3ZM3 12H16M3 17H16M8 8V22" className={styles.printRule} style={{fill: 'none'}} />}
          </g> : null)}
          {part.name === OUTPUT_PRINT.name && <g transform={OUTPUT_PRINT.transform} clipPath={`url(#${id}-screen)`} className={styles.print}>
            {state.accepted ? <>
              <text x="3" y="10" fontSize="6.8">{PRESENTATION_LABELS[presentation]}</text><text x="102" y="10" fontSize="5.3" textAnchor="end">件</text>
              {presentation === 'bar-chart' ? state.values.map((value, index) => <g key={DAYS[index]}>
                <text x="3" y={25 + index * 17} fontSize="5.2">{DAYS[index]}</text>
                <rect x="20" y={19 + index * 17} width="64" height="8" className={styles.screenTrack} />
                <rect x="20" y={19 + index * 17} width={quantityWidth(value, 64)} height="8" className={styles.screenBar} />
                <text x="102" y={25 + index * 17} fontSize="5.8" textAnchor="end">{value}</text>
              </g>) : presentation === 'metric-grid' ? <>
                <text x="53" y="48" textAnchor="middle" fontSize="23" className={styles.screenNumber}>{state.data.total}</text>
                <text x="53" y="62" textAnchor="middle" fontSize="6">四日合计 / 件</text>
                <text x="53" y="78" textAnchor="middle" fontSize="4.5">数据工具已计算 total</text>
              </> : <>
                <path d="M3 19H102V84H3ZM3 32H102M3 45H102M3 58H102M3 71H102M52 19V84" className={styles.printRule} style={{fill: 'none'}} />
                <text x="9" y="28" fontSize="5.2">日期</text><text x="88" y="28" fontSize="5.2" textAnchor="end">销量</text>
                {state.data.rows.map((row, index) => <g key={row.day}><text x="9" y={41 + index * 13} fontSize="5.5">{row.day}</text><text x="88" y={41 + index * 13} fontSize="5.8" textAnchor="end">{row.quantity}</text></g>)}
              </>}
            </> : <g className={styles.rejectedInk}><path d="M43 29L63 49M63 29L43 49" className={styles.rejectIcon} data-free="both" /><text x="53" y="65" textAnchor="middle" fontSize="7">必需数值缺失</text><text x="53" y="77" textAnchor="middle" fontSize="5">本教学模型拒绝呈现</text></g>}
          </g>}
        </g>)}</g>
      </svg>
      <div className={frame.corners}><span>条带宽度与柱长共用固定 0–100 件刻度</span><span data-composer-readout>{readout}</span></div>
    </div>
    <div className={frame.legend}><span>左：工具数据条</span><span>中：三副组件 Schema 模具</span><span>亮滑台：选中的组件</span><span>右：通过校验后的结果</span></div>

    <fieldset className={styles.controls} disabled={!hydrated}>
      <legend>改变输入与呈现方式</legend>
      <div className={styles.presets}>{(Object.keys(PRESETS) as DatasetPreset[]).map(name => <Button key={name} size="sm" variant="secondary" onPress={() => preset(name)}>{PRESETS[name].label}</Button>)}<Button size="sm" variant="ghost" onPress={reset}>恢复示例</Button></div>
      <div className={styles.sliders}>{quantities.map((quantity, index) => <Slider key={DAYS[index]} className={styles.slider} minValue={0} maxValue={MAX_QUANTITY} step={1} value={quantity} isDisabled={!hydrated} aria-label={`${DAYS[index]}销量`}
        onChange={next => {manual();const quantity = Array.isArray(next) ? next[0] ?? 0 : next;setQuantities(current => current.map((value, at) => at === index ? quantity : value));}}>
        <Label>{DAYS[index]}</Label><Slider.Output>{quantity} 件</Slider.Output>
        <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
      </Slider>)}</div>
      <div className={styles.presentationOptions} role="radiogroup" aria-label="选择呈现组件">{PRESENTATIONS.map(type => <label key={type}><input type="radio" name={`${id}-presentation`} value={type} checked={type === presentation} onChange={() => {manual();setPresentation(type);}} /><span>{PRESENTATION_LABELS[type]}</span><code>{type}</code></label>)}</div>
      <label className={styles.missing}><input type="checkbox" checked={missing} onChange={event => {manual();setMissing(event.target.checked);}} />删除第一行的必需字段 <code>quantity</code>，测试本示例的拒绝分支</label>
    </fieldset>

    <div className={styles.trace}>
      <article><p className={styles.panelLabel}>01 / Client Tool Result</p><div className={styles.dataset}>
        {state.data.rows.map((row, index) => <div key={row.day} data-selected={selectedRow === index}><span>{row.day}</span><code>quantity: {row.quantity === undefined ? <em>缺失</em> : row.quantity}</code></div>)}
        <div className={styles.total}><span>data tool 计算</span><code>total: {state.data.total ?? '不可计算'}</code></div>
      </div><p className={styles.small}>固定教学数据；数据工具先算合计，再交给界面。零值是实际值，缺失值有不同含义。</p></article>
      <article><p className={styles.panelLabel}>02 / Component Contract</p><strong className={styles.componentName}>{presentation}</strong><p className={styles.contract}>{CONTRACT_SUMMARY[presentation]}</p>
        <p className={styles.small}><code>sales-layout.children</code><br />→ <code>["sales-view"]</code></p>
        <p className={styles.validation} data-valid={state.accepted}>{state.accepted ? '✓ 必需字段与 children 通过校验' : '× 必需数值缺失，拒绝呈现'}</p>
        {!state.accepted && <p className={styles.errorPath}><code>{state.issues[0]?.path}</code></p>}
      </article>
    </div>

    <div className={styles.result} data-composer-result>
      <p className={styles.panelLabel}>03 / Validated UI · {PRESENTATION_LABELS[presentation]}</p>
      {state.accepted ? <>
        {presentation === 'bar-chart' ? <div className={styles.chart} aria-label="四日销量柱状图，固定0至100件刻度">
          <div className={styles.chartScale}><span>0</span><span>50</span><span>100 件</span></div>
          {state.data.rows.map((row, index) => <button key={row.day} className={styles.chartRow} data-bar={index} data-selected={selectedRow === index} aria-pressed={selectedRow === index} onClick={() => {manual();setSelectedRow(index);}}>
            <span>{row.day}</span><span className={styles.barTrack}><span className={styles.barFill} style={{width: `${row.quantity}%`}} /></span><strong>{row.quantity}</strong>
          </button>)}
          <p className={styles.small} data-selected-value>已选择{selected.day}：{selected.quantity} 件。点击柱条或用 Tab、Enter 核对对应输入。</p>
        </div> : presentation === 'metric-grid' ? <div className={styles.metric}>
          <span>四日销量合计</span><strong data-metric-total>{state.data.total}<small> 件</small></strong>
          <p className={styles.small}>{state.values.join(' + ')} = {state.data.total}</p>
          <Button size="sm" variant="ghost" aria-expanded={metricSources} onPress={() => {manual();setMetricSources(value => !value);}}>{metricSources ? '收起来源' : '核对计算来源'}</Button>
          {metricSources && <ul className={styles.metricSources}>{state.data.rows.map(row => <li key={row.day}>{row.day}：{row.quantity} 件</li>)}</ul>}
        </div> : <div className={styles.tableWrap}><table><caption>同一份工具数据，支持本地排序</caption><thead><tr><th scope="col">日期</th><th scope="col" aria-sort={descending ? 'descending' : 'none'}><button onClick={() => {manual();setDescending(value => !value);}} aria-label={descending ? '恢复日期顺序' : '按销量从高到低排序'}>销量 / 件 <span aria-hidden="true">{descending ? '↓' : '↕'}</span></button></th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.day} data-selected={selectedRow === row.index}><th scope="row"><button onClick={() => {manual();setSelectedRow(row.index);}} aria-pressed={selectedRow === row.index}>{row.day}</button></th><td>{row.quantity}</td></tr>)}</tbody><tfoot><tr><th scope="row">合计</th><td>{state.data.total}</td></tr></tfoot></table></div>}
      </> : <div className={styles.rejection}><strong>没有渲染数据组件</strong><p>第一行缺少 <code>quantity</code>；{presentation === 'metric-grid' ? '工具无法计算 total，指标 payload 缺少 value。' : presentation === 'bar-chart' ? '映射后的第一根柱缺少 value。' : '表格的第一行缺少 quantity。'}本示例的 Schema 要求该数值存在。</p><Button size="sm" variant="secondary" onPress={() => {manual();setMissing(false);}}>恢复必需字段</Button></div>}
    </div>

    <details className={styles.spec}><summary>查看当前 composeUI JSONL 与教学 Schema 边界</summary>
      <p className={styles.small}>下面的字符串按行添加 <code>root</code>、<code>elements</code> 与组件。<code>children</code> 保存子节点 ID，决定顺序。容器 <code>teaching-stack</code> 与各 props 是此演示自写的简化 Schema，不是可直接提交给 HeroUI 的官方 schema。</p>
      <pre data-spec-stream><code>{state.specStream}</code></pre>
    </details>
    <div className={styles.playback}><Button size="sm" variant="ghost" isDisabled={!hydrated || reduced} aria-pressed={tour} onPress={() => {setStage(0);setTour(value => !value);}}>{tour ? '暂停步骤导览' : '播放步骤导览'}</Button><span>{reduced ? '减少动画已开启，可手动操作所有输入。' : '每 1.6 秒标记一个步骤；数据与输出保持可核对，手动改变输入会停止导览。'}</span></div>
    <p className={styles.status} role="status" aria-live={tour ? 'off' : 'polite'}>{readout}。{state.accepted ? '切换组件保留同一份数据，只改变表达方式。' : '恢复必需字段后，同一组件可以重新呈现。'}</p>
    <p className={frame.note}>这个教学模型不调用 AI 或 HeroUI 服务。它示范官方公开的“结构化工具数据 → 选择组件 Schema → JSONL spec → 校验 → 呈现”链路；这里的选型、合计计算、字段规则和拒绝策略由本示例实现。真实 Agent 遇到缺数据时可能换组件或再次调用工具；不能从本演示推断其一定拒绝整条回复。</p>
    <p className={frame.note}><a href="https://heroui.pro/docs/agents/configure/tools" target="_blank" rel="noopener noreferrer">官方 Tools 与 Dataset interfaces</a> · <a href="https://heroui.pro/docs/agents/components" target="_blank" rel="noopener noreferrer">官方 Agent UI 组件 Schema 与选择过程</a></p>
    <noscript><p className={frame.note}>当前静态结果：24、42、30、54 件，合计 150 件，呈现柱状图。启用 JavaScript 后可改数据、换组件并测试缺字段的教学分支。</p></noscript>
  </section>;
}
