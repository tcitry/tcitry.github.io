import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {Button, Label, Slider, Switch} from '@heroui/react';
import {MechanismPlayer} from './MechanismPlayer';
import {RufloMemoryStage, paintRufloMemory} from './ruflo-memory-motion';
import {DEFAULT_MEMORY_INPUT, evaluateMemoryWindow, type MemoryFixtureRecord, type MemoryWindowInput} from './ruflo-memory-window-model';
import demoSurface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './RufloMemoryWindowFigure.module.css';

const SOURCE = 'https://github.com/ruvnet/ruflo/blob/070349a6949aee7d5cb798a354f0712121285324/v3/@claude-flow/cli/src/memory/memory-bridge.ts#L1432-L1510';
const PRESETS: Array<{id: string; label: string; input: MemoryWindowInput}> = [
  {id: 'outside', label: 'C 留在第 1001 条', input: DEFAULT_MEMORY_INPUT},
  {id: 'inside', label: '把 C 更新到第 1000 条', input: {...DEFAULT_MEMORY_INPUT, position: 1000}},
  {id: 'threshold', label: '阈值改为 0.50', input: {...DEFAULT_MEMORY_INPUT, position: 1000, threshold: .5}},
  {id: 'no-embedding', label: '关闭查询向量', input: {...DEFAULT_MEMORY_INPUT, position: 1000, hasEmbedding: false}},
];
const fmt = (value: number | null) => value === null ? '未评分' : value.toFixed(3);
const percent = (value: number) => `${value * 100}%`;
const explanation = (reason: string) => reason === 'namespace' ? 'C 的 namespace 为 sessions，在选择最近记录前已被过滤。'
  : reason === 'window' ? 'C 没有进入最近 1000 条，未计算相关性；提高它的预设 cosine 也不会改变本次结果。'
    : reason === 'threshold' ? 'C 已得到分数，但低于 threshold，没有进入结果。'
      : reason === 'limit' ? 'C 达到 threshold，但排在前 10 条之后。' : 'C 已进入窗口并通过 threshold，按相关性进入结果。';
const PHASES = [
  {at: 0, label: '1 / 索引位置：更新时间决定 C 所在的槽位'},
  {at: .12, label: '2 / 读取窗口：读头只接触最近 1000 条'},
  {at: .22, label: '3 / 取得候选：窗口内的卡片才能送去评分'},
  {at: .43, label: '4 / 合成分数：语义、混合值、max 保底依次形成'},
  {at: .68, label: '5 / 排序归档：同一张卡按实际 score 进入结果槽'},
  {at: .86, label: '6 / 保持结果：对照槽位顺序，再重播另一种条件'},
];

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

/** The animation and readouts use the same scored fixture, never a timed fake result. */
export default function RufloMemoryWindowFigure() {
  const id = useId();
  const [input, setInput] = useState<MemoryWindowInput>(DEFAULT_MEMORY_INPUT);
  const [hydrated, setHydrated] = useState(false);
  const [touring, setTouring] = useState(true);
  const tour = useRef(true);
  const fromPosition = useRef(DEFAULT_MEMORY_INPUT.position);
  const state = useMemo(() => evaluateMemoryWindow(input), [input]);
  useEffect(() => setHydrated(true), []);
  function stopTour() {tour.current = false;setTouring(false);}
  function change(next: MemoryWindowInput) {
    stopTour();fromPosition.current = input.position;setInput(next);
  }
  function update(key: keyof MemoryWindowInput, value: number | boolean) {change({...input, [key]: value});}
  function startTour() {
    tour.current = true;setTouring(true);fromPosition.current = input.position;
    setInput({...DEFAULT_MEMORY_INPUT, position: input.position === 1001 ? 1000 : 1001});
  }

  return <section className={`${demoSurface.surface} ${frame.surface} ${styles.demo}`} data-demo="ruflo-memory-window" data-book-island
    data-hydrated={hydrated} data-reason={state.reason} data-in-window={state.inWindow} data-recalled={state.recalled}
    data-current-position={state.position} aria-labelledby={`${id}-heading`}>
    <header className={styles.header}>
      <p className={styles.eyebrow}>ANATOMY / RUFLO MEMORY</p>
      <h3 id={`${id}-heading`}>读头为什么取不到这张高相关的卡？</h3>
      <p className={styles.note}>跟随 C 走过索引槽、比较量尺与结果槽。它必须先进入最近 1000 条，之后才有分数；分数形成后，同一张卡再按相关性归档。</p>
    </header>

    <MechanismPlayer label="Ruflo 索引读取与分选动画" duration={18} resetKey={JSON.stringify(input)} phases={PHASES}
      onUserControl={stopTour}
      onCycle={() => {
        if (!tour.current) return false;
        fromPosition.current = input.position;
        setInput({...DEFAULT_MEMORY_INPUT, position: input.position === 1001 ? 1000 : 1001});
        return true;
      }}
      onFrame={(stage,p,meta) => paintRufloMemory(stage,p,state,fromPosition.current,meta.reducedMotion)}>
      <RufloMemoryStage id={id} />
      <div className={styles.stageLegend} aria-hidden="true"><span>索引边界 · 998—1002 放大</span><span>语义 → 混合 → max 量尺</span><span>按分数排入 Top 10</span></div>
      <p className={styles.livePhase} data-memory-live-phase>读头先检查索引窗口</p>
      <div className={styles.liveReadout} aria-live="off">
        <span data-memory-live-window>C 第 1001 条 · 窗口外，不评分</span>
        <strong data-memory-live-score>C：未评分</strong>
        <span data-memory-live-order>结果槽尚未接收记录</span>
      </div>
      <p className={styles.liveEquation} data-memory-live-equation>窗口外没有 score，预设 cosine 不会进入计算。</p>
    </MechanismPlayer>

    <div className={styles.experiment}>
      <div className={styles.tourStatus}><span>{touring ? '自动对照：每轮在 1001 / 1000 之间切换真实输入' : '手动条件：重播当前输入，不自动改动'}</span>
        <Button size="sm" variant="ghost" isDisabled={!hydrated || touring} onPress={startTour}>恢复自动对照</Button>
      </div>
      <div className={styles.presets} aria-label="输入条件">{PRESETS.map(preset => <Button key={preset.id} size="sm" variant={JSON.stringify(preset.input) === JSON.stringify(input) ? 'secondary' : 'outline'}
        isDisabled={!hydrated} data-preset={preset.id} onPress={() => change({...preset.input})}>{preset.label}</Button>)}</div>
      <fieldset className={styles.controls} disabled={!hydrated}>
        <legend>改变输入，重看卡片经历的过程</legend>
        <Slider minValue={998} maxValue={1002} step={1} value={input.position} isDisabled={!hydrated} data-control="position" aria-label="C 的更新时间顺位"
          onChange={value => update('position', Array.isArray(value) ? value[0] ?? 1001 : value)}>
          <Label>C 的更新时间顺位 · 边界局部</Label><Slider.Output>第 {input.position} 条</Slider.Output><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
        </Slider>
        <Slider minValue={0} maxValue={1} step={.01} value={input.relevance} isDisabled={!hydrated} data-control="relevance" aria-label="C 的预设余弦相关性"
          onChange={value => update('relevance', Array.isArray(value) ? value[0] ?? .95 : value)}>
          <Label>C 的预设 cosine</Label><Slider.Output>{input.relevance.toFixed(2)}</Slider.Output><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
        </Slider>
        <Slider minValue={0} maxValue={1} step={.01} value={input.threshold ?? .2} isDisabled={!hydrated} data-control="threshold" aria-label="搜索阈值"
          onChange={value => update('threshold', Array.isArray(value) ? value[0] ?? .2 : value)}>
          <Label>threshold</Label><Slider.Output>{(input.threshold ?? .2).toFixed(2)}</Slider.Output><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
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
    </div>

    <details className={styles.details}>
      <summary>核对当前条件的精确分数与完整 Top 10</summary>
      <p className={styles.note}>下列是当前输入的最终计算；上方动画中的读数只在量尺到位、卡片入槽后才出现。输入查询固定为 <code>token login</code>。</p>
      <div className={styles.scoreCards}>{state.candidateRecords.map(record => <ScoreCard key={record.id} record={record} threshold={state.threshold} relevance={state.relevance} inNamespace={record.id !== 'C' || state.inNamespace} />)}</div>
      <p className={styles.note}>{state.eligibleCount} 条通过 threshold，返回 {state.results.length} 条。</p>
      {state.results.length ? <ol className={styles.results} data-value="results">{state.results.map(record => <li key={record.id} data-result={record.id}>
        <span>{record.id.startsWith('background-') ? `其他记录 #${record.rank}` : record.id}</span><strong>{fmt(record.score)}</strong>
      </li>)}</ol> : <p className={styles.empty} data-value="results">没有记录通过 threshold。</p>}
      <p className={styles.result} data-value="result">{explanation(state.reason)}</p>
    </details>
    <p className={styles.boundary}>1100 条合成记录；A、B 较新，cosine 分别预设为 0.72、0.10，C 的预设值可调。左侧只放大 998—1002 的索引边界；右侧显示真实 Top 10 顺序。动画时间是教学慢放，不代表 SQL、Embedding 或真实性能。窗口与评分规则依据固定版本源码，未运行 Ruflo 或 SQLite。</p>
    <p className={styles.source}><a href={SOURCE} target="_blank" rel="noopener noreferrer">固定提交 070349a · SQLite 候选与评分规则</a></p>
    <noscript><p className={styles.note}>初始静态结论：C 第1001，未评分；A为0.72、B为0.46，按A、B返回。启用JavaScript后可观看索引卡读取、量尺计算与排序。</p></noscript>
  </section>;
}
