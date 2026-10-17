import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {trackDemoStart} from '../../lib/analytics';
import {AnatomyLine, AnatomySolid} from './AnatomyArt';
import {translateAlong} from './anatomy-iso-kit';
import {GATE_SCENARIOS, INITIAL_GATE, releaseGate, VERSION_OPTIONS, WAZA_SOURCE, type GateInput} from './waza-release-gate-model';
import {WIDTH, HEIGHT, PROJECTION, SHADOW, PARTS, PART_COUNT, INPUT_PRINTS, OUTPUT_PRINT, TAG_PRINT, type Motion} from './waza-release-gate-geometry';
import demoSurface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './WazaReleaseGateMachine.module.css';

const INITIAL = releaseGate(INITIAL_GATE);
const initialOffsets: Record<Motion, number> = {field0: 0, field1: 0, field2: 0, status: INITIAL.statusPosition};
const motionOf = (state: ReturnType<typeof releaseGate>): Record<Motion, number> => ({field0: state.fieldPositions[0]!, field1: state.fieldPositions[1]!, field2: state.fieldPositions[2]!, status: state.statusPosition});
const TOUR = ['parity', 'mismatch', 'behind', 'ahead', 'prerelease', 'build-mismatch', 'no-tag'];

export default function WazaReleaseGateMachine() {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const art = useRef<SVGGElement>(null);
  const targets = useRef(initialOffsets);
  const wake = useRef<(() => void) | null>(null);
  const [input, setInput] = useState<GateInput>(INITIAL_GATE);
  const state = useMemo(() => releaseGate(input), [input]);
  const [hydrated, setHydrated] = useState(false);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  const [reduced, setReduced] = useState(true);
  const [tour, setTour] = useState(false);
  const tourIndex = useRef(0);

  useEffect(() => {
    setHydrated(true);
    const host = root.current;const layer = art.current;
    if (!host || !layer) return;
    const nodes = Array.from(layer.querySelectorAll<SVGGElement>('[data-motion]'));
    const current = {...initialOffsets};
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let inView = false;let handle = 0;let last = 0;
    const place = () => nodes.forEach(node => node.setAttribute('transform', translateAlong(PROJECTION, [current[node.dataset.motion as Motion], 0, 0])));
    const tick = (now: number) => {
      handle = 0;
      if (!inView || document.hidden) {last = 0;return;}
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;last = now;
      let moving = false;
      for (const motion of Object.keys(current) as Motion[]) {
        const target = targets.current[motion];
        current[motion] += (target - current[motion]) * (1 - Math.exp(-dt / 0.15));
        if (Math.abs(target - current[motion]) < 0.01) current[motion] = target;
        else moving = true;
      }
      place();if (moving) handle = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (preference.matches) {Object.assign(current, targets.current);place();return;}
      if (!handle && inView && !document.hidden) {last = 0;handle = requestAnimationFrame(tick);}
    };
    wake.current = kick;
    const observer = new IntersectionObserver(entries => {
      inView = entries.at(-1)?.isIntersecting ?? false;setVisible(inView);
      if (inView) kick();else if (handle) {cancelAnimationFrame(handle);handle = 0;}
    });
    observer.observe(host);
    const onPreference = () => {setReduced(preference.matches);if (preference.matches) setTour(false);kick();};
    const onVisibility = () => {setForeground(!document.hidden);if (document.hidden && handle) {cancelAnimationFrame(handle);handle = 0;}else kick();};
    preference.addEventListener('change', onPreference);document.addEventListener('visibilitychange', onVisibility);
    onPreference();onVisibility();
    return () => {observer.disconnect();if (handle) cancelAnimationFrame(handle);preference.removeEventListener('change', onPreference);document.removeEventListener('visibilitychange', onVisibility);wake.current = null;};
  }, []);
  useEffect(() => {targets.current = motionOf(state);wake.current?.();}, [state]);
  useEffect(() => {
    if (!tour || !visible || !foreground || reduced) return;
    const timer = setInterval(() => {
      tourIndex.current = (tourIndex.current + 1) % TOUR.length;
      setInput(GATE_SCENARIOS.find(scenario => scenario.id === TOUR[tourIndex.current])!.input);
    }, 3400);
    return () => clearInterval(timer);
  }, [tour, visible, foreground, reduced]);
  function change(next: GateInput, action: string) {setTour(false);setInput(next);trackDemoStart('waza-release-gate-machine', action);}
  const scenario = GATE_SCENARIOS.find(item => item.input.tag === input.tag && item.input.versions.every((value, index) => value === input.versions[index]))?.id ?? 'custom';

  return <section ref={root} id="waza-release-gate-machine" className={`${demoSurface.surface} ${frame.surface} ${styles.demo}`}
    data-demo="waza-release-gate-machine" data-book-island data-status={state.status} data-hydrated={hydrated} data-tour={tour ? 'playing' : 'paused'} aria-labelledby={`${id}-heading`}>
    <p className={frame.eyebrow}>Anatomy / Waza Release Gate</p>
    <h3 className={frame.heading} id={`${id}-heading`}>版本一致，为什么仍可能 FAIL？</h3>
    <p className={frame.note}>三通道比较仪先核对 manifest 字段，再把唯一版本与本地可达的稳定 Tag 对照。移动版本尺，观察哪个条件改变了证据状态。</p>
    <ol className={styles.steps} aria-label="源码中的转换顺序">
      <li><code>collect_versions</code><span>收集已有字段</span></li>
      <li><code>v / V → 单一字符串</code><span>只去掉开头一个前缀</span></li>
      <li><code>parse_semver → Tag</code><span>解析，再检查有无回退</span></li>
      <li><code>status</code><span>交给 /check 继续判断</span></li>
    </ol>
    <div className={frame.card}>
      <div className={frame.corners}><span>Fig 01 · 三通道版本比较仪</span><span>3.40.0 · 固定源码切片</span></div>
      <svg className={frame.figure} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`${id}-title ${id}-desc`} data-anatomy-parts={PART_COUNT}>
        <title id={`${id}-title`}>manifest 版本比较仪</title>
        <desc id={`${id}-desc`}>左侧三条滑尺分别表示 VERSION、package.json、Cargo.toml。相同的规范化字符串使探针对齐基准点；不同字符串使它们错开。右侧游标报告 {state.status}。{state.reasons.join('')}</desc>
        <path className={styles.shadow} d={SHADOW} />
        <g ref={art}>
          {PARTS.map(part => <g key={part.name} data-part={part.name} data-motion={part.motion}
            transform={part.motion ? translateAlong(PROJECTION, [initialOffsets[part.motion], 0, 0]) : undefined}>
            <AnatomySolid paths={part.paths} tone={part.tone} lit={part.motion === 'status'} name={part.name} />
            {part.lines.map((line, index) => <AnatomyLine key={index} {...line} />)}
            {INPUT_PRINTS.map((print, index) => part.name === print.name && <g key={print.name} transform={print.transform} className={styles.print}>
              <text x="0" y="0" fontSize="3.4">0{index + 1}</text><text x="34" y="10" fontSize="8" textAnchor="middle">{state.fields[index]!.raw ?? '—'}</text>
            </g>)}
            {part.name === OUTPUT_PRINT.name && <g transform={OUTPUT_PRINT.transform} className={styles.print}>
              <text x="38" y="14" textAnchor="middle" fontSize="12" data-field="meter-status">{state.status}</text>
              <text x="38" y="26" textAnchor="middle" fontSize="3.8">VERSION FIELD SYNC</text>
            </g>}
            {part.name === TAG_PRINT.name && <g transform={TAG_PRINT.transform} className={styles.print}><text x="38" y="6" textAnchor="middle" fontSize="4">{input.tag ? `TAG ${input.tag}` : 'NO STABLE TAG'}</text></g>}
          </g>)}
        </g>
      </svg>
      <div className={frame.corners}><span>改变字段或选择对照场景</span><span>version_sync → {state.status}</span></div>
    </div>
    <div className={frame.legend}><span>01 VERSION</span><span>02 package.json</span><span>03 Cargo.toml</span><span>对齐＝规范化字符串相同</span><span>游标从左到右：N/A · PASS · WARN · FAIL</span></div>
    <fieldset className={styles.controls} disabled={!hydrated}>
      <legend>选择一组输入，或单独调整字段</legend>
      <label className={styles.scenario}>条件对照<select data-control="scenario" value={scenario} onChange={event => {
        const selected = GATE_SCENARIOS.find(item => item.id === event.target.value);if (selected) change(selected.input, selected.id);
      }}><option value="custom" disabled>自定义条件</option>{GATE_SCENARIOS.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <div className={styles.inputGrid}>
        {state.fields.map((field, index) => <label key={field.name}>{field.name}<select data-control={`field-${index}`} value={field.raw ?? ''} onChange={event => {
          const versions = [...input.versions] as GateInput['versions'];versions[index] = event.target.value || null;change({...input, versions}, `field-${index}`);
        }}>{VERSION_OPTIONS.map(value => <option key={value ?? 'absent'} value={value ?? ''}>{value ?? '不存在 / 没有 version 字段'}</option>)}</select></label>)}
        <label>已选出的稳定可达 Tag<select data-control="tag" value={input.tag ?? ''} onChange={event => change({...input, tag: event.target.value || null}, 'tag')}>
          <option value="">没有</option>{['v3.39.0', 'v3.40.0', 'v3.41.0'].map(tag => <option key={tag}>{tag}</option>)}
        </select></label>
      </div>
    </fieldset>
    <div className={styles.playback}><button type="button" disabled={!hydrated || reduced} aria-pressed={tour} data-action="tour" onClick={() => {
      if (tour) {setTour(false);return;}tourIndex.current = 0;setInput(INITIAL_GATE);setTour(true);trackDemoStart('waza-release-gate-machine', 'play');
    }}>{tour ? '暂停对照' : '播放条件对照'}</button><span>{reduced ? '减少动画模式：控件仍可手动操作。' : '每 3.4 秒切换；手动调整即停止，离开视口暂停。'}</span></div>
    <div className={styles.tableWrap}>
      <table className={styles.fields}><caption>原始字段 → 前缀规范化 → SemVer 拆分</caption><thead><tr><th>字段</th><th>去掉 v/V 后</th><th>core</th><th>prerelease</th><th>build</th></tr></thead><tbody>
        {state.fields.map(field => <tr key={field.name}><th scope="row">{field.name}<small>{field.raw ?? '未收集'}</small></th><td>{field.normalized ?? '—'}</td><td>{field.parsed?.core.join('.') ?? (field.raw === null ? '—' : '解析失败')}</td><td>{field.parsed?.prerelease ?? '—'}</td><td>{field.parsed?.build ?? '—'}</td></tr>)}
      </tbody></table>
    </div>
    <div className={styles.result} role="status" aria-live={tour ? 'off' : 'polite'} data-machine-status>
      <strong data-field="status">{state.status}</strong><div><p>单一 manifest：<code data-field="manifest">{state.manifest ?? '无'}</code></p>{state.reasons.map(reason => <p key={reason}>{reason}</p>)}</div>
    </div>
    <p className={frame.note}>特别试试“只有 build 不同”：<code>+ci.1</code> 与 <code>+ci.2</code> 会导致字段不一致；统一 build 后，与 Tag 比较时只使用 core 与 prerelease。滑尺错位表示字符串不同，距离不代表版本差值；缺失字段没有参与比较。</p>
    <p className={frame.note}>模型边界：输入已通过文件安全检查并收集为字符串，只展示三种 manifest；实际脚本还读 <code>pyproject.toml</code>，并处理格式损坏、符号链接和大小限制。Tag 控件模拟 <code>latest_stable_reachable_tag</code> 的稳定结果；本地可达不等于远端最新发布。</p>
    <p className={frame.note}>这是 <code>/check</code> Ship 的一项证据。完整审查还要核对工作区、远端、changelog、分发内容等；这个 PASS 不表示“允许发布”。脚本发现 WARN / FAIL 仍正常返回退出码 0，也不会执行发布。<a href={WAZA_SOURCE} target="_blank" rel="noopener noreferrer">核对固定版本源码</a></p>
    <noscript><p className={frame.note}>初始静态结果：三个字段仅 v/V 前缀不同，规范化后均为 3.40.0，与稳定 Tag 相同，VERSION FIELD SYNC 为 PASS。</p></noscript>
  </section>;
}
