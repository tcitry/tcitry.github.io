import {useEffect, useId, useMemo, useState} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {AnatomyDots, AnatomyLine, AnatomySolid} from './AnatomyArt';
import {DRAW_HEIGHT, DRAW_WIDTH, DRAW_HALO, drawGeometry} from './taste-direction-geometry';
import {DEFAULT_INPUT, DIRECTIONS, SECTORS, TASTE_COMMIT, TONES, directionNumber, drawDirections} from './taste-direction-model';
import demoSurface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './TasteDirectionMachine.module.css';

const excerpt = (value: string) => value.split(/(?<=\.)\s/).slice(0, 2).join(' ');

export default function TasteDirectionMachine() {
  const id = useId();
  const [hydrated, setHydrated] = useState(false);
  const [seed, setSeed] = useState(42);
  const [sector, setSector] = useState(DEFAULT_INPUT.sector);
  const [tone, setTone] = useState('');
  const [productPhoto, setProductPhoto] = useState(false);
  const [selectedRound, setSelectedRound] = useState(0);
  useEffect(() => {setHydrated(true);}, []);
  const state = useMemo(() => drawDirections(seed, {sector, tone: tone || null, have: productPhoto ? ['product-photo'] : [], avoid: []}), [seed, sector, tone, productPhoto]);
  const round = state.rounds[Math.min(selectedRound, state.rounds.length - 1)]!;
  const geometry = useMemo(() => drawGeometry(round, state.rounds, selectedRound), [round, state.rounds, selectedRound]);
  const [fraction, index] = [round.random.toFixed(8), round.index];
  const readout = `floor(${fraction} × ${round.before.length}) = ${index} → ${round.chosen.id}`;
  return <section className={`${demoSurface.surface} ${frame.surface} ${styles.demo}`} data-demo="taste-direction-machine" data-book-island
    data-hydrated={hydrated} data-seed={seed} data-selected-round={selectedRound + 1} data-direction={round.chosen.id} aria-labelledby={`${id}-heading`}>
    <p className={frame.eyebrow}>Anatomy / directionPool → rnd → pick</p>
    <h3 className={frame.heading} id={`${id}-heading`}>随机数如何落进一个方向？</h3>
    <p className={frame.note}>先按条件收窄方向池，再把随机数落在等宽区间内。区间序号从 0 开始；每抽出一个方向，下一轮池子少一个。图中的编号对应下方真实方向库。</p>
    <div className={frame.card}>
      <div className={frame.corners}><span>Fig 01 · 方向抽样尺</span><span>数字 seed {seed} · 第 {selectedRound + 1} 次抽样</span></div>
      <svg className={`${frame.figure} ${styles.figure}`} viewBox={`0 0 ${DRAW_WIDTH} ${DRAW_HEIGHT}`} role="img" aria-labelledby={`${id}-title ${id}-desc`} data-anatomy-parts={geometry.parts.length}>
        <title id={`${id}-title`}>32 位随机数通过等宽区间选取方向</title>
        <desc id={`${id}-desc`}>上方 32 个针位编码随机整数 {round.unsigned}。它除以 4294967296 得 {fraction}。刻度上的指针落入 {round.before.length} 个等宽区间中的第 {index} 号，选中 {round.chosen.id}；下一轮移除该方向。下方最多三个输出是本次抽样结果，不是模型生成的网页。</desc>
        <path d={DRAW_HALO} className={styles.halo} />
        {geometry.parts.map(part => <g key={part.name} data-part={part.name} data-family={part.family} data-bit={part.bit} data-selected={part.selected}>
          <AnatomySolid paths={part.paths} tone={part.family === 'base' ? 'lo' : 'hi'} lit={part.selected} name={part.name} />
          {part.lines.map((d, at) => <AnatomyLine key={at} d={d} />)}
          <AnatomyDots points={part.bolts} size={0.6} />
          {part.print && <g transform={part.print.transform} className={styles.print}><text x={part.print.width / 2} y="14" textAnchor="middle" fontSize={part.family === 'output' ? 8 : 7}>{part.print.text}</text></g>}
        </g>)}
        <text x={geometry.scaleStart[0]} y={geometry.scaleStart[1] - 10} textAnchor="middle" className={styles.scaleLabel}>0</text>
        <text x={geometry.scaleEnd[0]} y={geometry.scaleEnd[1] - 10} textAnchor="middle" className={styles.scaleLabel}>1</text>
        <circle cx={geometry.marker[0]} cy={geometry.marker[1]} r="3.5" className={styles.marker} />
      </svg>
      <div className={frame.corners}><span>上：32 位整数 · 中：0 ≤ r &lt; 1 与等宽候选池 · 下：最多三个输出</span><span>{round.before.length} 个候选 → 取走编号 {String(directionNumber(round.chosen.id)).padStart(2, '0')}</span></div>
    </div>
    <div className={styles.math} aria-live="polite"><code>u32 = {round.unsigned}</code><span>÷ 2³²</span><code>r = {fraction}</code><span>× {round.before.length}，向下取整</span><strong>index = {index}</strong></div>
    <fieldset disabled={!hydrated} className={styles.controls}>
      <legend>改变真实输入</legend>
      <Slider className={styles.slider} minValue={1} maxValue={99} step={1} value={seed} aria-label="数字 seed" onChange={value => {setSeed(Array.isArray(value) ? value[0] ?? 42 : value);}}>
        <Label>数字 seed</Label><Slider.Output>{seed}</Slider.Output><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
      </Slider>
      <div className={styles.filters}><label>sector<select className={styles.nativeSelect} value={sector} onChange={event => {setSector(event.target.value);setSelectedRound(0);}}>{SECTORS.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>tone<select className={styles.nativeSelect} value={tone} onChange={event => {setTone(event.target.value);setSelectedRound(0);}}><option value="">不指定</option>{TONES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className={styles.checkbox}><input className={styles.nativeCheck} type="checkbox" checked={productPhoto} onChange={event => {setProductPhoto(event.target.checked);setSelectedRound(0);}} />have 包含 product-photo</label></div>
      <div className={styles.rounds} role="group" aria-label="查看抽样轮次">{state.rounds.map((entry, at) => <Button size="sm" key={at} variant={selectedRound === at ? 'primary' : 'secondary'} aria-pressed={selectedRound === at} onPress={() => setSelectedRound(at)}>第 {at + 1} 次 · {entry.before.length} → {entry.after.length}</Button>)}
        <Button size="sm" variant="ghost" onPress={() => {setSeed(42);setSector('saas');setTone('');setProductPhoto(false);setSelectedRound(0);}}>恢复示例</Button></div>
    </fieldset>
    <p className={styles.selection} role="status" data-draw-readout>{readout}。取出后剩 {round.after.length} 个方向。</p>
    <div className={styles.pool} aria-label="本轮等宽区间与方向对应">{round.before.map((direction, at) => <span key={direction.id} data-chosen={at === round.index}><code>[{at}]</code><b>{String(directionNumber(direction.id)).padStart(2, '0')}</b><span>{direction.id}</span></span>)}</div>
    <ol className={styles.outputs} aria-label="三次实际方向输出">{state.rounds.map((entry, at) => <li key={entry.chosen.id} data-current={at === selectedRound}>
      <span className={styles.outputNumber}>{at + 1}</span><div><strong>{entry.chosen.name}</strong><code>{entry.chosen.id}</code><p>{excerpt(entry.chosen.idea)}</p><p className={styles.composition}>{excerpt(entry.chosen.composition)}</p></div>
    </li>)}</ol>
    <details className={styles.details}><summary>核对 20 个方向怎样经过过滤</summary>
      <ol className={styles.stages}>{state.stages.map(stage => <li key={stage.key}><code>{stage.label}</code><strong>{stage.ids.length} 个</strong><span>{stage.condition}；{stage.applied ? '已应用' : '保持上一池'}</span></li>)}</ol>
      <div className={styles.catalogue}>{DIRECTIONS.map(direction => <div key={direction.id} data-in-pool={state.pool.includes(direction)}><b>{String(directionNumber(direction.id)).padStart(2, '0')}</b><code>{direction.id}</code><span>{state.pool.includes(direction) ? '保留' : '筛除'}</span></div>)}</div>
    </details>
    <p className={frame.note}>此图复现固定版本的 <code>directionPool()</code>、seedable PRNG 与三次 <code>pick()</code>；历史固定为空、<code>avoid</code> 固定为空。相同 seed、方向库、输入与历史才可重复；真实脚本还会读取最近使用的方向。32 个针位只显示 PRNG 的最终整数，不模拟 CPU 内部执行。</p>
    <p className={frame.note}>后续由 Agent 按内容构思选择方向，再运行 <code>--direction</code> 生成完整 Direction Sheet；图中的三个结果只是候选，不代表网页质量、模型偏好或最终视觉稿。上游的 <code>brief</code> 不参与此处的候选抽样。</p>
    <p className={frame.note}><a href={`https://github.com/Leonxlnx/taste-skill/blob/${TASTE_COMMIT}/skills/taste-skill/scripts/draw.mjs#L95-L101`}>PRNG 源码</a> · <a href={`https://github.com/Leonxlnx/taste-skill/blob/${TASTE_COMMIT}/skills/taste-skill/scripts/draw.mjs#L217-L240`}>过滤与抽样源码</a> · 2026-10-15 核对</p>
    <noscript><p>当前静态图保留 seed 42、saas、空历史下的三次实际抽样和过滤结果。启用 JavaScript 后可调整参数并核对每一轮。</p></noscript>
  </section>;
}
