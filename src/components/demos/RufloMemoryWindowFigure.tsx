import {useEffect, useId, useMemo, useState} from 'react';
import {Button, Label, Slider, Switch} from '@heroui/react';
import {DEFAULT_MEMORY_INPUT, evaluateMemoryWindow, type MemoryFixtureRecord, type MemoryWindowInput} from './ruflo-memory-window-model';
import demoSurface from './DemoSurface.module.css';
import styles from './RufloMemoryWindowFigure.module.css';

const SOURCE = 'https://github.com/ruvnet/ruflo/blob/070349a6949aee7d5cb798a354f0712121285324/v3/@claude-flow/cli/src/memory/memory-bridge.ts#L1432-L1510';
const PRESETS: Array<{id: string; label: string; input: MemoryWindowInput}> = [
  {id: 'outside', label: 'C 在第 1001 条', input: DEFAULT_MEMORY_INPUT},
  {id: 'inside', label: '只更新 C 到第 1000 条', input: {...DEFAULT_MEMORY_INPUT, position: 1000}},
  {id: 'threshold', label: '阈值提高到 0.50', input: {...DEFAULT_MEMORY_INPUT, threshold: 0.5}},
  {id: 'no-embedding', label: '不提供查询向量', input: {...DEFAULT_MEMORY_INPUT, hasEmbedding: false}},
];
const fmt = (value: number | null) => value === null ? '未评分' : value.toFixed(3);
const percent = (value: number) => `${value * 100}%`;
const explanation = (reason: string) => reason === 'namespace' ? 'C 的 namespace 为 sessions，在选择最近记录前已被过滤。'
  : reason === 'window' ? 'C 没有进入最近 1000 条，未计算相关性；提高它的预设 cosine 也不会改变本次结果。'
    : reason === 'threshold' ? 'C 已得到分数，但低于 threshold，没有进入结果。'
      : reason === 'limit' ? 'C 达到 threshold，但在相关性排序中排在第 10 位之后。' : 'C 已进入窗口并通过 threshold，按相关性参与结果排序。';

function ScoreCard({record, threshold, relevance, inNamespace}: {record: MemoryFixtureRecord; threshold: number; relevance: number; inNamespace: boolean}) {
  const s = record.semantic;
  const blended = record.blendedScore;
  const final = record.score;
  return <article className={styles.scoreCard} data-record={record.id} data-scored={final !== null} data-passed={record.passed}>
    <header><strong>{record.id}</strong><span>{record.inWindow ? `窗口内 · 第 ${record.rank} 条` : inNamespace ? `窗口外 · 第 ${record.rank} 条` : 'namespace 不匹配'}</span></header>
    <p className={styles.recordText}><code>{record.text}</code></p>
    {s === null || blended === null || final === null ? <div className={styles.unscored} data-record-score={record.id}>
      <strong>未执行评分</strong><p>{inNamespace ? '先被 LIMIT 1000 截断。' : '先被 namespace 过滤。'}预设 cosine {relevance.toFixed(2)} 尚未用于计算。</p>
    </div> : <>
      <p className={styles.lexical}><code>l = max({fmt(record.bm25Normalized)}, {fmt(record.coverage)}) = {fmt(record.lexical)}</code><span>BM25 封顶值与 coverage 取较大者</span></p>
      <div className={styles.scoreRows}>
        <div><span>语义 s</span><strong>{fmt(s)}</strong></div>
        <div className={styles.bar} aria-hidden="true"><span className={styles.semantic} style={{width: percent(s)}} /></div>
        <div><span>0.6s + 0.4l</span><strong>{fmt(blended)}</strong></div>
        <div className={styles.bar} aria-hidden="true"><span className={styles.semantic} style={{width: percent(0.6 * Math.max(0, s))}} /><span className={styles.lexicalFill} style={{width: percent(0.4 * (record.lexical ?? 0))}} /></div>
        <div><span>max(混合, s)</span><strong data-record-score={record.id}>{fmt(final)}</strong></div>
        <div className={`${styles.bar} ${styles.finalBar}`} aria-hidden="true"><span className={styles.finalFill} style={{width: percent(final)}} /><i className={styles.threshold} style={{left: percent(threshold)}} /></div>
      </div>
      <p className={styles.decision} data-record-rank={record.id}>{!record.passed ? `${fmt(final)} < ${threshold.toFixed(2)}，过滤` : !record.recalled ? `通过阈值，排第 ${record.resultRank}，超出 Top 10` : `通过阈值，返回第 ${record.resultRank} 位`}</p>
    </>}
  </article>;
}

/** Direct view of the pre-rank window and each computed signal; no upstream runtime. */
export default function RufloMemoryWindowFigure() {
  const id = useId();
  const [input, setInput] = useState<MemoryWindowInput>(DEFAULT_MEMORY_INPUT);
  const [hydrated, setHydrated] = useState(false);
  const state = useMemo(() => evaluateMemoryWindow(input), [input]);
  useEffect(() => setHydrated(true), []);
  const boundaryRanks = [998, 999, 1000, 1001, 1002];
  const axis = (rank: number) => 36 + (rank - 1) / (state.namespaceSize - 1) * 648;
  const limitX = axis(1000);
  const markerX = axis(state.position);
  const update = (key: keyof MemoryWindowInput, value: number | boolean) => setInput(current => ({...current, [key]: value}));

  return <section className={`${demoSurface.surface} ${styles.demo}`} data-demo="ruflo-memory-window" data-book-island
    data-hydrated={hydrated} data-reason={state.reason} data-in-window={state.inWindow} data-recalled={state.recalled}
    data-current-position={state.position} aria-labelledby={`${id}-heading`}>
    <p className={styles.eyebrow}>Ruflo / 候选窗口与评分实验</p>
    <h3 id={`${id}-heading`}>相关性很高，为什么仍找不到？</h3>
    <p className={styles.note}>查询固定为 <code>token login</code>。先看 C 是否进入最近 1000 条，再看实际计算出的分数。更新时间顺位与相关性是两个独立输入。</p>

    <div className={styles.presets} aria-label="四种条件对照">{PRESETS.map(preset => <Button key={preset.id} size="sm" variant="outline"
      isDisabled={!hydrated} data-preset={preset.id} onPress={() => setInput({...preset.input})}>{preset.label}</Button>)}</div>
    <fieldset className={styles.controls} disabled={!hydrated}>
      <legend>调整输入</legend>
      <Slider minValue={3} maxValue={1100} step={1} value={input.position} isDisabled={!hydrated} data-control="position" aria-label="C 的更新时间顺位"
        onChange={value => update('position', Array.isArray(value) ? value[0] ?? 1001 : value)}>
        <Label>C 的更新时间顺位</Label><Slider.Output>第 {input.position} 条</Slider.Output><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
      </Slider>
      <Slider minValue={0} maxValue={1} step={0.01} value={input.relevance} isDisabled={!hydrated} data-control="relevance" aria-label="C 的预设余弦相关性"
        onChange={value => update('relevance', Array.isArray(value) ? value[0] ?? 0.95 : value)}>
        <Label>C 的预设 cosine</Label><Slider.Output>{input.relevance.toFixed(2)}</Slider.Output><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
      </Slider>
      <Slider minValue={0} maxValue={1} step={0.01} value={input.threshold ?? 0.2} isDisabled={!hydrated} data-control="threshold" aria-label="搜索阈值"
        onChange={value => update('threshold', Array.isArray(value) ? value[0] ?? 0.2 : value)}>
        <Label>搜索 threshold</Label><Slider.Output>{(input.threshold ?? 0.2).toFixed(2)}</Slider.Output><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
      </Slider>
      <div className={styles.switches}>
        <Switch size="sm" isSelected={input.hasEmbedding !== false} isDisabled={!hydrated} data-control="embedding" onChange={value => update('hasEmbedding', value)}>
          <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>提供查询向量</Switch.Content>
        </Switch>
        <Switch size="sm" isSelected={input.namespaceMatch !== false} isDisabled={!hydrated} data-control="namespace" onChange={value => update('namespaceMatch', value)}>
          <Switch.Content><Switch.Control><Switch.Thumb /></Switch.Control>C 属于 patterns</Switch.Content>
        </Switch>
      </div>
    </fieldset>

    <div className={styles.stage}>
      <h4>1 · namespace 过滤后，按更新时间取最近 1000 条</h4>
      <p className={styles.note}><code>patterns</code> 中有 {state.namespaceSize} 条，评分窗口取 {state.windowSize} 条。
        {!state.inNamespace && ' C 属于 sessions，已在窗口选择前移出。'}</p>
      <div className={styles.windowViewport} role="region" tabIndex={0} aria-label="候选窗口图，窄屏可横向滚动">
      <svg className={styles.window} viewBox="0 0 720 210" role="img" aria-labelledby={`${id}-window-title ${id}-window-desc`}>
        <title id={`${id}-window-title`}>最近 1000 条的截断位置与边界放大图</title>
        <desc id={`${id}-window-desc`}>{state.inNamespace ? `C 位于第 ${state.position} 条，${state.inWindow ? '进入窗口并参与评分' : '在窗口外，未评分'}。` : 'C 的 namespace 不匹配，不参与选择窗口。'}下方放大第 998 到 1002 条；前三条在窗口内，后两条在窗口外。它们等宽显示，不按全量比例。</desc>
        <text x="36" y="17">最近</text><text x="684" y="17" textAnchor="end">较旧</text>
        <rect className={styles.windowOutside} x="36" y="32" width="648" height="24" rx="3" />
        <rect className={styles.windowInside} x="36" y="32" width={limitX - 36} height="24" rx="3" />
        <line className={styles.cutoff} x1={limitX} y1="27" x2={limitX} y2="67" />
        <text x="36" y="83">1</text><text x={limitX - 5} y="83" textAnchor="end">1000</text><text x="684" y="83" textAnchor="end">{state.namespaceSize}</text>
        {state.inNamespace && <g data-window-marker="C" data-rank={state.position}><circle className={styles.target} cx={markerX} cy="44" r="8" /><text className={styles.targetLabel} x={markerX} y="47" textAnchor="middle">C</text></g>}
        <text x="36" y="115">边界放大 · 等宽记录</text>
        {boundaryRanks.map((rank, index) => {
          const isC = state.inNamespace && state.position === rank;
          return <g key={rank} data-boundary-rank={rank} data-record={isC ? 'C' : 'background'}>
            <rect className={isC ? styles.boundaryTarget : rank <= 1000 ? styles.boundaryInside : styles.boundaryOutside} x={36 + index * 130} y="128" width="124" height="49" rx="4" />
            <text x={98 + index * 130} y="147" textAnchor="middle">{rank}</text><text x={98 + index * 130} y="166" textAnchor="middle">{isC ? 'C' : '其他记录'}</text>
          </g>;
        })}
        <line className={styles.cutoff} x1="423" y1="123" x2="423" y2="183" />
        <text x="423" y="202" textAnchor="middle">← 参与评分 ｜ 不参与评分 →</text>
      </svg>
      </div>
      <p className={styles.windowStatus} data-value="window">{!state.inNamespace ? 'C 在 namespace 过滤时退出。' : state.inWindow ? `C 第 ${state.position} 条 → 已进入窗口，下方计算分数。` : `C 第 ${state.position} 条 → 在窗口外，下方保留“未评分”。`}</p>
    </div>

    <div className={styles.stage}>
      <h4>2 · 只对窗口内的记录计算分数，再与 threshold 比较</h4>
      <p className={styles.legend}><span><i className={styles.semanticKey} />语义分量</span><span><i className={styles.lexicalKey} />词法分量</span><span><i className={styles.thresholdKey} />threshold {state.threshold.toFixed(2)}</span></p>
      <div className={styles.scoreCards}>{state.candidateRecords.map(record => <ScoreCard key={record.id} record={record} threshold={state.threshold} relevance={state.relevance} inNamespace={record.id !== 'C' || state.inNamespace} />)}</div>
      <p className={styles.note}>条形长度均使用 0～1 的同一刻度。最终分数取混合值与原始语义值的较大者；有查询向量时，A 的 0.432 被保底到 0.720。关闭查询向量后语义项为 0，B 仍由词法项得到 0.400。</p>
    </div>

    <div className={styles.stage}>
      <h4>3 · 按实际 score 降序，返回前 10 条</h4>
      <p className={styles.note}>{state.eligibleCount} 条通过 threshold，本次返回 {state.results.length} 条。</p>
      {state.results.length ? <ol className={styles.results} data-value="results">{state.results.map(record => <li key={record.id} data-result={record.id}>
        <span>{record.id.startsWith('background-') ? `其他记录 #${record.rank}` : record.id}</span><strong>{fmt(record.score)}</strong>
      </li>)}</ol> : <p className={styles.empty} data-value="results">没有记录通过 threshold。</p>}
      <p className={styles.result} role="status" aria-live="polite" aria-atomic="true" data-value="result">{explanation(state.reason)}</p>
    </div>

    <p className={styles.note}>教学边界：1100 条合成记录，A、B 始终较新，其余记录无匹配；三个 cosine 均为假设输入，未运行 Embedding 模型。这里复现候选与评分规则，没有运行 Ruflo 或 SQLite，也不测量生产性能。threshold 为 0 时零分记录也会通过，最后仍只返回 Top 10；同分顺序遵循本例固定的输入顺序，上游相同更新时间的先后并无额外保证。</p>
    <p className={styles.note}><a href={SOURCE} target="_blank" rel="noopener noreferrer">核对固定提交 070349a 的 SQLite 候选分支</a>。此窗口上限不能概括所有向量后端。</p>
    <noscript><p className={styles.note}>当前为初始静态结果：C 第 1001，未执行评分；A 为 0.72、B 为 0.46，按 A、B 返回。启用 JavaScript 后可改变输入。</p></noscript>
  </section>;
}
