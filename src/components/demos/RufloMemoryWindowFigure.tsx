import {useEffect, useId, useRef, useState} from 'react';
import {AnatomyLine, AnatomySolid} from './AnatomyArt';
import {depthOf, iso, lineOnTop, translateAlong} from './anatomy-iso-kit';
import {DEFAULT_MEMORY_INPUT, evaluateMemoryWindow, type MemoryWindowInput} from './ruflo-memory-window-model';
import {HEIGHT, LABELS, PART_COUNT, PARTS, PROJECTION, ROWS, SHADOW, TRACK_START, TRAVEL, WIDTH, type Motion} from './ruflo-memory-window-geometry';
import frame from './AnatomyFrame.module.css';
import styles from './RufloMemoryWindowFigure.module.css';

const INITIAL = evaluateMemoryWindow(DEFAULT_MEMORY_INPUT);
const SOURCE = 'https://github.com/ruvnet/ruflo/blob/070349a6949aee7d5cb798a354f0712121285324/v3/@claude-flow/cli/src/memory/memory-bridge.ts#L1432-L1510';
const fmt = (value: number | null) => value === null ? '未评分' : value.toFixed(3);
const PRESETS: Array<{label: string; input: MemoryWindowInput}> = [
  {label: '旧而相关：第 1001 条', input: DEFAULT_MEMORY_INPUT},
  {label: '刚进窗口：第 1000 条', input: {...DEFAULT_MEMORY_INPUT, position: 1000}},
  {label: '阈值提高到 0.50', input: {...DEFAULT_MEMORY_INPUT, threshold: 0.5}},
  {label: '不提供查询向量', input: {...DEFAULT_MEMORY_INPUT, hasEmbedding: false}},
];
const explanation = (reason: string) => reason === 'namespace' ? 'C 的命名空间不同，先被过滤；不会计算相关性。'
  : reason === 'window' ? 'C 排在最近 1000 条之外；相关性再高也不会进入这次评分。'
    : reason === 'threshold' ? 'C 已进入窗口并得到分数，但未达到当前阈值。'
      : reason === 'limit' ? 'C 达到阈值，但未进入排序后的前 10 个结果。' : 'C 通过窗口和阈值，进入本次搜索结果。';

/** Source-bound teaching model. No model/provider calls or upstream runtime. */
export default function RufloMemoryWindowFigure() {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const drawing = useRef<SVGGElement>(null);
  const targets = useRef<MemoryWindowInput>(DEFAULT_MEMORY_INPUT);
  const wake = useRef<(() => void) | null>(null);
  const [input, setInput] = useState<MemoryWindowInput>(DEFAULT_MEMORY_INPUT);
  const [hydrated, setHydrated] = useState(false);
  const [tour, setTour] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [foreground, setForeground] = useState(true);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    setHydrated(true);
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const current = {...DEFAULT_MEMORY_INPUT};
    let inView = false;let handle = 0;let last = 0;
    const draw = () => {
      const state = evaluateMemoryWindow(current);
      const records = state.candidateRecords;
      const motions: Record<Motion, number> = {
        position: (state.position - 1) / 1099 * TRAVEL,
        a: (records[0]!.score ?? 0) * TRAVEL,
        b: (records[1]!.score ?? 0) * TRAVEL,
        c: (records[2]!.score ?? 0) * TRAVEL,
        threshold: state.threshold * TRAVEL,
      };
      for (const node of host.querySelectorAll<SVGGElement>('[data-motion]')) {
        const motion = node.dataset.motion as Motion;
        node.setAttribute('transform', translateAlong(PROJECTION, [motions[motion], 0, 0]));
        if (motion === 'c') node.style.visibility = state.inWindow ? 'visible' : 'hidden';
        if (motion === 'position') node.style.opacity = state.inNamespace ? '1' : '0.2';
      }
      const layer = drawing.current;
      if (layer) {
        const ordered = Array.from(layer.children) as SVGGElement[];
        ordered.sort((a, b) => {
          const key = (node: SVGGElement) => Number(node.dataset.depth) + (node.dataset.motion ? depthOf([motions[node.dataset.motion as Motion], 0, 0], PROJECTION) : 0);
          return key(a) - key(b);
        });
        if (ordered.some((node, index) => node !== layer.children[index])) layer.append(...ordered);
      }
      for (const [index, record] of records.entries()) {
        const score = host.querySelector<HTMLElement>(`[data-record-score="${record.id}"]`);
        const rank = host.querySelector<HTMLElement>(`[data-record-rank="${record.id}"]`);
        const scoreText = fmt(record.score);
        const rankText = record.resultRank === null ? '—' : `第 ${record.resultRank} 位`;
        if (score && score.textContent !== scoreText) score.textContent = scoreText;
        if (rank && rank.textContent !== rankText) rank.textContent = rankText;
        const fill = host.querySelector<SVGPathElement>(`[data-score-fill="${record.id}"]`);
        if (fill) {
          fill.setAttribute('d', lineOnTop([TRACK_START, ROWS[index + 1]! + 3], [TRACK_START + (record.score ?? 0) * TRAVEL, ROWS[index + 1]! + 3], 3.04, PROJECTION));
          fill.style.visibility = record.score === null ? 'hidden' : 'visible';
        }
      }
      const values: Record<string, string> = {
        position: `第 ${state.position} 条`,
        'window': state.inNamespace ? (state.inWindow ? 'C 已进入 1000 条评分窗口' : 'C 在评分窗口之外') : 'C 被命名空间过滤',
        'threshold': state.threshold.toFixed(2),
        'score': fmt(state.score),
        'semantic': fmt(state.semantic),
        'result': explanation(state.reason),
        'rank': state.resultRank === null ? '未召回' : `第 ${state.resultRank} 位`,
        'results': state.results.map(record => record.id).join(' → ') || '空',
      };
      for (const [key, value] of Object.entries(values)) for (const node of host.querySelectorAll<HTMLElement>(`[data-value="${key}"]`)) if (node.textContent !== value) node.textContent = value;
      host.dataset.reason = state.reason;
      host.dataset.inWindow = String(state.inWindow);
      host.dataset.recalled = String(state.recalled);
      host.dataset.currentPosition = String(state.position);
    };
    const place = () => {draw();};
    const tick = (now: number) => {
      handle = 0;
      if (!inView || document.hidden) {last = 0;return;}
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;last = now;
      let moving = false;
      for (const key of ['position', 'relevance', 'threshold'] as const) {
        const target = targets.current[key] ?? (key === 'threshold' ? 0.2 : 0);
        const old = current[key] ?? target;
        const next = old + (target - old) * (1 - Math.exp(-dt / 0.12));
        current[key] = Math.abs(next - target) < (key === 'position' ? 0.01 : 0.0001) ? target : next;
        if (current[key] !== target) moving = true;
      }
      current.namespaceMatch = targets.current.namespaceMatch !== false;
      current.hasEmbedding = targets.current.hasEmbedding !== false;
      place();
      if (moving) handle = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (preference.matches) {Object.assign(current, targets.current);place();return;}
      if (!handle && inView && !document.hidden) {last = 0;handle = requestAnimationFrame(tick);}
    };
    wake.current = kick;
    const observer = new IntersectionObserver(entries => {
      inView = entries.at(-1)?.isIntersecting ?? false;setVisible(inView);
      if (inView) kick();else if (handle) {cancelAnimationFrame(handle);handle = 0;}
    }, {rootMargin: '100px 0px'});
    observer.observe(host);
    const onPreference = () => {setReduced(preference.matches);if (preference.matches) setTour(false);kick();};
    const onVisibility = () => {setForeground(!document.hidden);if (document.hidden && handle) {cancelAnimationFrame(handle);handle = 0;}else kick();};
    preference.addEventListener('change', onPreference);document.addEventListener('visibilitychange', onVisibility);
    onPreference();onVisibility();draw();
    return () => {observer.disconnect();cancelAnimationFrame(handle);preference.removeEventListener('change', onPreference);document.removeEventListener('visibilitychange', onVisibility);wake.current = null;};
  }, []);
  useEffect(() => {targets.current = input;wake.current?.();}, [input]);
  useEffect(() => {
    if (!tour || !visible || reduced || !foreground) return;
    let index = 0;
    const timer = setInterval(() => {index = (index + 1) % PRESETS.length;setInput(PRESETS[index]!.input);}, 3200);
    return () => clearInterval(timer);
  }, [tour, visible, reduced, foreground]);
  const change = (next: MemoryWindowInput) => {setTour(false);setInput(next);};
  const initialOffsets: Record<Motion, number> = {position: 1000 / 1099 * TRAVEL, a: 0.72 * TRAVEL, b: 0.46 * TRAVEL, c: 0, threshold: 0.2 * TRAVEL};

  return <section ref={root} className={`${frame.surface} ${styles.demo}`} data-demo="ruflo-memory-window" data-book-island
    data-hydrated={hydrated} data-reason={INITIAL.reason} aria-labelledby={`${id}-heading`}>
    <p className={frame.eyebrow}>Anatomy / Ruflo Memory Bridge</p>
    <h3 className={frame.heading} id={`${id}-heading`}>相关性很高，为什么仍找不到？</h3>
    <p className={frame.note}>这里解剖 <code>memory-bridge.ts</code> 的 SQLite 搜索分支：最近记录先获得评分资格，相关性排序随后才发生。C 的相关性是教学输入，位置表示它在 <code>patterns</code> 内按更新时间倒序的顺位。</p>
    <ol className={styles.stageOrder} aria-label="实际筛选顺序"><li>① <code>namespace</code> 过滤</li><li>② 最近 <code>1000</code> 条</li><li>③ 混合评分</li><li>④ 阈值与 Top 10</li></ol>
    <div className={frame.card}>
      <div className={frame.corners}><span>Fig 01 · 记忆窗口与相关性比较台</span><span>① 新 → 旧 · ②③④ 低分 → 高分</span></div>
      <svg className={frame.figure} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`${id}-title ${id}-desc`} data-anatomy-parts={PART_COUNT}>
        <title id={`${id}-title`}>一条最近记录尺与三条评分尺</title>
        <desc id={`${id}-desc`}>第一条尺的游标是 C 的更新顺位，竖挡标记第 1000 条。下面依次是 A、B、C 的分数，三个同步竖挡代表阈值。C 在窗口外时，第四条尺上没有分数游标。移动控件可观察门限前后的变化。</desc>
        <path className={styles.shadow} d={SHADOW} />
        <g ref={drawing}>{PARTS.slice().sort((a, b) => (a.key + (a.motion ? depthOf([initialOffsets[a.motion], 0, 0], PROJECTION) : 0)) - (b.key + (b.motion ? depthOf([initialOffsets[b.motion], 0, 0], PROJECTION) : 0))).map(part => <g key={part.name} data-depth={part.key} data-motion={part.motion} transform={part.motion ? translateAlong(PROJECTION, [initialOffsets[part.motion], 0, 0]) : undefined}
          style={part.motion === 'c' ? {visibility: 'hidden'} : undefined}>
          <AnatomySolid paths={part.paths} tone={part.tone} lit={part.motion === 'position' || part.motion === 'c'} name={part.name} />
          {part.lines.map((d, index) => <AnatomyLine key={index} d={d} />)}
          {LABELS.filter(label => part.name === `${label.motion}-number`).map(label => <g key={label.motion} transform={label.transform} className={styles.engraving}><text x="1" y="3" fontSize="4.5">{label.index + 1}</text></g>)}
          {['a', 'b', 'c'].map((motion, index) => part.name === `${motion}-rail` && <g key={motion}>
            <path data-score-fill={['A', 'B', 'C'][index]} className={styles.scoreFill}
              d={lineOnTop([TRACK_START, ROWS[index + 1]! + 3], [TRACK_START + ([0.72, 0.46, 0][index]!) * TRAVEL, ROWS[index + 1]! + 3], 3.04, PROJECTION)} />
            <circle className={styles.datum} cx={iso([TRACK_START, ROWS[index + 1]! + 3, 3.04], PROJECTION)[0]} cy={iso([TRACK_START, ROWS[index + 1]! + 3, 3.04], PROJECTION)[1]} r="1.15" />
          </g>)}
        </g>)}</g>
      </svg>
      <div className={frame.corners}><span data-value="position">第 1001 条</span><span data-value="window">C 在评分窗口之外</span></div>
    </div>
    <ul className={styles.legend}><li><strong>①</strong>C 的更新顺位；竖挡＝1000</li><li><strong>②</strong>A 的得分</li><li><strong>③</strong>B 的得分</li><li><strong>④</strong>C 的得分</li><li>下方三挡同步＝阈值 <span data-value="threshold">0.20</span></li></ul>
    <fieldset className={styles.controls} disabled={!hydrated}>
      <legend>改变输入，观察哪道筛选决定结果</legend>
      <label className={styles.control}><span className={styles.label}><span>C 的更新时间顺位</span><output>设为第 {input.position} 条</output></span>
        <input type="range" min="3" max="1100" step="1" value={input.position} data-control="position" aria-label="C 的更新时间顺位" onChange={event => change({...input, position: Number(event.target.value)})} />
        <span className={styles.rangeEnds}><span>3 · 较新</span><span>1000 / 1001 是边界</span><span>1100 · 较旧</span></span></label>
      <label className={styles.control}><span className={styles.label}><span>C 的预设余弦相关性</span><output>设为 {input.relevance.toFixed(2)}</output></span>
        <input type="range" min="0" max="1" step="0.01" value={input.relevance} data-control="relevance" aria-label="C 的预设余弦相关性" onChange={event => change({...input, relevance: Number(event.target.value)})} />
        <span className={styles.rangeEnds}><span>0 · 无关</span><span>1 · 很相关</span></span></label>
      <label className={styles.control}><span className={styles.label}><span>搜索阈值</span><output>设为 {(input.threshold ?? 0.2).toFixed(2)}</output></span>
        <input type="range" min="0" max="1" step="0.01" value={input.threshold ?? 0.2} data-control="threshold" aria-label="搜索阈值" onChange={event => change({...input, threshold: Number(event.target.value)})} /></label>
      <label className={styles.namespace}><input type="checkbox" checked={input.hasEmbedding !== false} data-control="embedding" onChange={event => change({...input, hasEmbedding: event.target.checked})} />提供查询向量（关闭后语义分量为 0）</label>
      <label className={styles.namespace}><input type="checkbox" checked={input.namespaceMatch !== false} data-control="namespace" onChange={event => change({...input, namespaceMatch: event.target.checked})} />C 属于本次检索的 <code>patterns</code> 命名空间</label>
    </fieldset>
    <div className={styles.presets}>{PRESETS.map(preset => <button key={preset.label} type="button" disabled={!hydrated} onClick={() => change(preset.input)}>{preset.label}</button>)}
      <button type="button" disabled={!hydrated || reduced} aria-pressed={tour} onClick={() => {if (tour) setTour(false);else {setInput(DEFAULT_MEMORY_INPUT);setTour(true);}}}>{tour ? '暂停对照' : '播放四种对照'}</button></div>
    <dl className={styles.scoreboard}>
      <dt>查询</dt><dd><code>token login</code></dd>
      <dt>A · 无字面命中</dt><dd>预设 cosine 0.72 · 得分 <span data-record-score="A">0.720</span> · <span data-record-rank="A">第 1 位</span></dd>
      <dt>B · 两词命中</dt><dd>预设 cosine 0.10 · coverage 1 · 得分 <span data-record-score="B">0.460</span> · <span data-record-rank="B">第 2 位</span></dd>
      <dt>C · 无字面命中</dt><dd>cosine <span data-value="semantic">未评分</span> · 得分 <span data-record-score="C">未评分</span> · <span data-value="rank">未召回</span></dd>
      <dt>返回顺序</dt><dd data-value="results">A → B</dd>
    </dl>
    <p className={styles.result} role="status" aria-live={tour ? 'off' : 'polite'}><strong data-value="result">{explanation(INITIAL.reason)}</strong></p>
    <p className={frame.note}><code>lexical = max(BM25 / 10 的封顶值, coverage)</code>，<code>score = max(0.6 × max(0, cosine) + 0.4 × lexical, cosine)</code>。B 命中全部查询词，所以词法分量为 1；关闭向量后得分为 0.40。</p>
    <p className={frame.note}>模型边界：1100 条合成记录，A、B 始终较新且位于同一命名空间，其余记录的语义和关键词匹配为 0；C 的预设向量相似度用于演示，不是嵌入模型的测量结果。第一条尺只画 C 的位置，不画出全部 1100 条。装置是教学比喻；这里没有运行 Ruflo、SQLite 或测量生产性能。</p>
    <p className={`${frame.note} ${styles.source}`}><a href={SOURCE} target="_blank" rel="noopener noreferrer">核对固定提交 070349a 的搜索实现</a>。此图解释 SQLite 候选分支，不能概括所有向量后端。</p>
    <noscript><p className={frame.note}>初始结果：C 排第 1001，尚未获得评分资格；A 得分 0.72、B 得分 0.46，阈值 0.20 时按 A、B 返回。</p></noscript>
  </section>;
}
