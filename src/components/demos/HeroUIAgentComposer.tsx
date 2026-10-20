import {useEffect, useId, useMemo, useState} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {
  composerState, compileTeachingStream, CONTRACT_SUMMARY, DAYS, MAX_QUANTITY, PRESETS, PRESENTATIONS,
  PRESENTATION_LABELS, type DatasetPreset, type Presentation,
} from './heroui-agent-composer-model';
import demoSurface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './HeroUIAgentComposer.module.css';

/** A local experiment: the received JSONL prefix drives the visible spec and result. */
export default function HeroUIAgentComposer() {
  const id = useId();
  const [quantities, setQuantities] = useState<number[]>(() => [...PRESETS.steady.quantities]);
  const [presentation, setPresentation] = useState<Presentation>('bar-chart');
  const [missing, setMissing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [received, setReceived] = useState(4);
  const [selectedRow, setSelectedRow] = useState(0);
  const [descending, setDescending] = useState(false);
  const [metricSources, setMetricSources] = useState(false);
  const state = useMemo(() => composerState(quantities, presentation, missing), [quantities, presentation, missing]);
  const lines = useMemo(() => state.specStream.split('\n'), [state.specStream]);
  const partial = useMemo(() => received >= 2
    ? compileTeachingStream(lines.slice(0, received).join('\n'))
    : undefined, [lines, received]);
  const layout = partial?.elements[partial.root];
  const view = layout?.children.includes('sales-view') ? partial?.elements['sales-view'] : undefined;
  const ready = received === lines.length;
  const accepted = ready && state.accepted;
  // The visible component consumes the compiled props, not a second copy of the input.
  const viewRows = useMemo(() => {
    if (!view || view.type === 'metric-grid') return [];
    return view.type === 'bar-chart'
      ? (view.props.data as Array<{label: string; value?: number}>).map(row => ({day: row.label, quantity: row.value}))
      : view.props.rows as Array<{day: string; quantity?: number}>;
  }, [view]);
  const viewTotal = view?.type === 'metric-grid'
    ? (view.props.metrics as Array<{value?: number}>)[0]?.value
    : state.data.total;
  const rows = useMemo(() => viewRows.map((row, index) => ({...row, index})).sort((a, b) => descending ? (b.quantity ?? 0) - (a.quantity ?? 0) : a.index - b.index), [viewRows, descending]);
  useEffect(() => setHydrated(true), []);
  const manual = () => setReceived(lines.length);
  function preset(name: DatasetPreset) {manual();setQuantities([...PRESETS[name].quantities]);}
  function reset() {manual();setQuantities([...PRESETS.steady.quantities]);setPresentation('bar-chart');setMissing(false);setSelectedRow(0);setDescending(false);setMetricSources(false);}
  const readout = !ready ? `已接收 ${received} / ${lines.length} 行，等待组件引用完整`
    : accepted ? `${PRESENTATION_LABELS[presentation]} · ${state.data.total} 件 · 教学 Schema 通过` : '缺失必需字段 · 教学校验拒绝';
  const selected = viewRows[selectedRow];
  const partialSummary = received === 0 ? {} : partial ?? {root: state.spec.root};
  const streamStatus = received === 0 ? '尚未收到 root。'
    : received < 3 ? 'root 已指定 sales-layout，等待对应 element。'
    : received < 4 ? '容器已到达，children 引用的 sales-view 仍未到达。'
    : accepted ? 'sales-layout 与 sales-view 均已到达，props 通过教学 Schema。'
    : '引用已经完整，但 sales-view 的必需数值未通过教学 Schema。';

  return <section className={`${demoSurface.surface} ${frame.surface} ${styles.demo}`} data-demo="heroui-agent-composer" data-book-island
    data-hydrated={hydrated} data-accepted={accepted} data-presentation={presentation} data-received={received} aria-labelledby={`${id}-heading`}>
    <p className={frame.eyebrow}>HeroUI Agents / 数据到界面实验</p>
    <h3 className={frame.heading} id={`${id}-heading`}>一份销量数据，如何成为三种界面？</h3>
    <p className={frame.note}>改变销量，核对工具结果怎样映射到组件 props；也可以从第一行重放 JSONL，观察 root、容器和组件引用逐个到达，何时才有足够的数据呈现界面。</p>

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
        <p className={styles.validation} data-valid={accepted} data-pending={!ready}>{!ready ? '等待完整组件，再校验已接收的 spec' : accepted ? '✓ 必需字段与 children 通过校验' : '× 必需数值缺失，拒绝呈现'}</p>
        {ready && !accepted && <p className={styles.errorPath}><code>{state.issues[0]?.path}</code></p>}
      </article>
    </div>

    <div className={styles.stream} aria-labelledby={`${id}-stream`}>
      <div className={styles.streamHeading}><h4 id={`${id}-stream`}>逐行接收 JSONL</h4><span data-stream-count>{received} / {lines.length} 行</span></div>
      <p className={styles.small}>先添加 root 与 elements，再添加布局容器，最后添加完整的数据组件。下面的累积对象与呈现结果都由已接收的行编译得到。</p>
      <div className={styles.streamControls}>
        <Button size="sm" variant="secondary" isDisabled={!hydrated} onPress={() => setReceived(0)}>从第一行重放</Button>
        <Button size="sm" variant="outline" isDisabled={!hydrated || ready} onPress={() => setReceived(current => Math.min(lines.length, current + 1))}>接收下一行</Button>
        <Button size="sm" variant="ghost" isDisabled={!hydrated || ready} onPress={() => setReceived(lines.length)}>接收剩余行</Button>
      </div>
      <ol className={styles.patches} aria-label="JSONL patches">{lines.map((line, index) => <li key={index} data-received={index < received} data-current={index === received - 1}><span>{index < received ? '已接收' : '待接收'} · {index + 1}</span><code>{line}</code></li>)}</ol>
      <div className={styles.references} data-stream-references>
        <span data-present={received > 0}>root <code>{received > 0 ? state.spec.root : '未到达'}</code></span>
        <span data-present={Boolean(layout)}>容器 <code>{layout?.type ?? '未到达'}</code>{layout && <small>children: {JSON.stringify(layout.children)}</small>}</span>
        <span data-present={Boolean(view)}>数据组件 <code>{view?.type ?? '未到达'}</code></span>
      </div>
      <p className={styles.validation} data-valid={accepted} data-pending={!ready} data-stream-status>{streamStatus}</p>
      <details className={styles.snapshot}><summary>核对当前累积的 spec</summary><pre data-partial-spec><code>{JSON.stringify(partialSummary, null, 2)}</code></pre></details>
    </div>

    <div className={styles.result} data-composer-result>
      <p className={styles.panelLabel}>03 / Validated UI · {PRESENTATION_LABELS[presentation]}</p>
      {!ready ? <div className={styles.waiting} data-composer-waiting><strong>等待组件描述</strong><p>{streamStatus} 收到完整引用前，此处保留空位。</p></div> : accepted ? <>
        {presentation === 'bar-chart' ? <div className={styles.chart} aria-label="四日销量柱状图，固定0至100件刻度">
          <div className={styles.chartScale}><span>0</span><span>50</span><span>100 件</span></div>
          {viewRows.map((row, index) => <button key={row.day} className={styles.chartRow} data-bar={index} data-selected={selectedRow === index} aria-pressed={selectedRow === index} onClick={() => {manual();setSelectedRow(index);}}>
            <span>{row.day}</span><span className={styles.barTrack}><span className={styles.barFill} style={{width: `${row.quantity}%`}} /></span><strong>{row.quantity}</strong>
          </button>)}
          <p className={styles.small} data-selected-value>已选择{selected?.day}：{selected?.quantity} 件。点击柱条或用 Tab、Enter 核对对应输入。</p>
        </div> : presentation === 'metric-grid' ? <div className={styles.metric}>
          <span>四日销量合计</span><strong data-metric-total>{viewTotal}<small> 件</small></strong>
          <p className={styles.small}>{state.values.join(' + ')} = {viewTotal}</p>
          <Button size="sm" variant="ghost" aria-expanded={metricSources} onPress={() => {manual();setMetricSources(value => !value);}}>{metricSources ? '收起来源' : '核对计算来源'}</Button>
          {metricSources && <ul className={styles.metricSources}>{state.data.rows.map(row => <li key={row.day}>{row.day}：{row.quantity} 件</li>)}</ul>}
        </div> : <div className={styles.tableWrap}><table><caption>同一份工具数据，支持本地排序</caption><thead><tr><th scope="col">日期</th><th scope="col" aria-sort={descending ? 'descending' : 'none'}><button onClick={() => {manual();setDescending(value => !value);}} aria-label={descending ? '恢复日期顺序' : '按销量从高到低排序'}>销量 / 件 <span aria-hidden="true">{descending ? '↓' : '↕'}</span></button></th></tr></thead>
          <tbody>{rows.map(row => <tr key={row.day} data-selected={selectedRow === row.index}><th scope="row"><button onClick={() => {manual();setSelectedRow(row.index);}} aria-pressed={selectedRow === row.index}>{row.day}</button></th><td>{row.quantity}</td></tr>)}</tbody><tfoot><tr><th scope="row">合计</th><td>{viewTotal}</td></tr></tfoot></table></div>}
      </> : <div className={styles.rejection}><strong>没有渲染数据组件</strong><p>第一行缺少 <code>quantity</code>；{presentation === 'metric-grid' ? '工具无法计算 total，指标 payload 缺少 value。' : presentation === 'bar-chart' ? '映射后的第一根柱缺少 value。' : '表格的第一行缺少 quantity。'}本示例的 Schema 要求该数值存在。</p><Button size="sm" variant="secondary" onPress={() => {manual();setMissing(false);}}>恢复必需字段</Button></div>}
    </div>

    <details className={styles.spec}><summary>查看当前 composeUI JSONL 与教学 Schema 边界</summary>
      <p className={styles.small}>下面的字符串按行添加 <code>root</code>、<code>elements</code> 与组件。<code>children</code> 保存子节点 ID，决定顺序。容器 <code>teaching-stack</code> 与各 props 是此演示自写的简化 Schema，不是可直接提交给 HeroUI 的官方 schema。</p>
      <pre data-spec-stream><code>{state.specStream}</code></pre>
    </details>
    <p className={styles.status} role="status" aria-live="polite">{readout}。{!ready ? streamStatus : accepted ? '切换组件保留同一份数据，只改变表达方式。' : '恢复必需字段后，同一组件可以重新呈现。'}</p>
    <p className={frame.note}>这个教学模型不调用 AI 或 HeroUI 服务。它示范官方公开的“结构化工具数据 → 选择组件 Schema → JSONL spec → 校验 → 呈现”链路；这里的四条 add patches、编译器、组件选型、合计计算、字段规则和拒绝策略由本示例实现。真实服务还可以在后续 patches 到达时先显示已经就绪的组件，本例仅含一个数据组件。真实 Agent 遇到缺数据时可能换组件或再次调用工具；不能从本演示推断其一定拒绝整条回复。</p>
    <p className={frame.note}><a href="https://heroui.pro/docs/agents/configure/tools" target="_blank" rel="noopener noreferrer">官方 Tools 与 Dataset interfaces</a> · <a href="https://heroui.pro/docs/agents/components" target="_blank" rel="noopener noreferrer">官方 Agent UI 组件 Schema 与选择过程</a></p>
    <noscript><p className={frame.note}>当前静态结果：24、42、30、54 件，合计 150 件，呈现柱状图。启用 JavaScript 后可改数据、换组件并测试缺字段的教学分支。</p></noscript>
  </section>;
}
