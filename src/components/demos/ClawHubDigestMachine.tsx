import demoSurface from './DemoSurface.module.css';
import {useEffect, useId, useRef, useState, type ReactNode} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {trackDemoStart} from '../../lib/analytics';
import {AnatomyDots, AnatomyLine, AnatomySolid} from './AnatomyArt';
import {translateAlong, depthOf} from './anatomy-iso-kit';
import {
  DIGEST_PARTS, DIGEST_PROJECTION, DIGEST_WIDTH, DIGEST_HEIGHT,
  DIGEST_HALO, DIGEST_PART_COUNT, paperFields, pressOffset,
} from './clawhub-digest-geometry';
import {
  createDigestMachine, commitDigestFields, projectDigest, readDigest,
  removeDigest, rebuildDigest, receiptIsStale, digestStatus,
  INITIAL_UPDATED_AT, type DigestFields, type DigestMachineState, type DigestOperation,
} from './clawhub-digest-model';
import frame from './AnatomyFrame.module.css';
import styles from './ClawHubDigestMachine.module.css';

type MotionController = {play: (operation: DigestOperation) => void};
const partArt = new Map(DIGEST_PARTS.map(item => [item.name, (
  <g key={`${item.name}-art`}>
    <AnatomySolid name={item.name} paths={item.paths} tone={item.tone} lit={item.assembly === 'digest'} />
    {item.lines.map((line, i) => <AnatomyLine key={`${item.name}-line-${i}`} {...line} />)}
    {item.dots.length > 0 ? <AnatomyDots points={item.dots} size={0.5} /> : null}
  </g>
)]));

function FieldsPrint({paper, fields}: {paper: Parameters<typeof paperFields>[0]; fields: DigestFields | null}) {
  return fields ? <g className={styles.printed}>{paperFields(paper, fields).map((d, i) =>
    <AnatomyLine key={`${paper}-field-${i}`} d={d} free />,
  )}</g> : null;
}

function DocumentReading({label, fields, empty, children}: {label: string; fields: DigestFields | null; empty: string; children?: ReactNode}) {
  return <div className={styles.document}>
    <dt>{label}</dt>
    <dd>{fields ? <><strong>{fields.displayName}</strong><span>downloads {fields.downloads}</span>
      <small className={styles.timestamp}>updatedAt +{Math.round((fields.updatedAt - INITIAL_UPDATED_AT) / 60_000)} min</small>
    </> : <strong>{empty}</strong>}{children}</dd>
  </div>;
}

/** Pure SVG art remains readable before hydration; React only updates controls and snapshots. */
export default function ClawHubDigestMachine() {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const partsHost = useRef<SVGGElement>(null);
  const motion = useRef<MotionController | null>(null);
  const [state, setState] = useState<DigestMachineState>(createDigestMachine);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [name, setName] = useState<DigestFields['displayName']>('Beta');
  const [downloads, setDownloads] = useState(20);
  const [hydrated, setHydrated] = useState(false);
  const [touring, setTouring] = useState(false);
  const stale = receiptIsStale(state);

  // A single time-based loop moves precomputed groups, never React-rendering per frame.
  useEffect(() => {
    setHydrated(true);
    const host = root.current;
    if (!host || !svg.current) return;
    const pressed = Array.from(svg.current.querySelectorAll<SVGGElement>('[data-motion="press"]'));
    const receipts = Array.from(svg.current.querySelectorAll<SVGGElement>('[data-motion="receipt"]'));
    const nodes = Array.from(partsHost.current?.querySelectorAll<SVGGElement>(':scope > g[data-part]') ?? []);
    let painted = nodes.map(node => node.dataset.part).join('|');
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let handle = 0;
    let last = 0;
    let age = 2;
    let press = 0;
    let receipt = 0;
    let operation: DigestOperation = 'ready';
    const place = () => {
      const transform = translateAlong(DIGEST_PROJECTION, pressOffset(press));
      pressed.forEach(node => node.setAttribute('transform', transform));
      receipts.forEach(node => node.setAttribute('transform', translateAlong(DIGEST_PROJECTION, [0, -1.5 * receipt, 0])));
      const pressDepth = depthOf(pressOffset(press), DIGEST_PROJECTION);
      const receiptDepth = depthOf([0, -1.5 * receipt, 0], DIGEST_PROJECTION);
      const ordered = [...nodes].sort((a, b) => {
        const key = (node: SVGGElement) => Number(node.dataset.anatomyKey)
          + (node.dataset.motion === 'press' ? pressDepth : node.dataset.motion === 'receipt' ? receiptDepth : 0);
        return key(a) - key(b);
      });
      const nextOrder = ordered.map(node => node.dataset.part).join('|');
      if (nextOrder !== painted && partsHost.current) {
        const fragment = document.createDocumentFragment();
        ordered.forEach(node => fragment.appendChild(node));
        partsHost.current.appendChild(fragment);
        painted = nextOrder;
      }
    };
    const tick = (now: number) => {
      handle = 0;
      if (!visible || document.hidden) {last = 0; return;}
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      age += dt;
      const progress = Math.min(age / 1.15, 1);
      const envelope = progress < 1 ? Math.sin(Math.PI * progress) ** 2 : 0;
      const stamp = ['patch', 'noop', 'rebuild'].includes(operation);
      const print = ['query-hit', 'query-miss'].includes(operation);
      const targetPress = calm.matches ? 0 : stamp ? envelope : 0;
      const targetReceipt = calm.matches ? 0 : print ? envelope : 0;
      const follow = 1 - Math.exp(-dt / 0.1);
      press += (targetPress - press) * follow;
      receipt += (targetReceipt - receipt) * follow;
      if (Math.abs(press) < 0.0005 && progress === 1) press = 0;
      if (Math.abs(receipt) < 0.0005 && progress === 1) receipt = 0;
      place();
      if (!calm.matches && (progress < 1 || press !== 0 || receipt !== 0)) handle = requestAnimationFrame(tick);
    };
    const kick = () => {if (!handle && visible && !document.hidden) {last = 0; handle = requestAnimationFrame(tick);}};
    const controller: MotionController = {
      play(next) {
        operation = next; age = next === 'ready' ? 2 : 0;
        if (calm.matches) {press = 0; receipt = 0; place(); return;}
        kick();
      },
    };
    motion.current = controller;
    const observer = new IntersectionObserver(entries => {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) kick();
      else if (handle) {cancelAnimationFrame(handle); handle = 0; last = 0;}
    }, {rootMargin: '120px 0px'});
    observer.observe(host);
    const onVisibility = () => {
      if (document.hidden && handle) {cancelAnimationFrame(handle); handle = 0; last = 0;}
      else kick();
    };
    const onCalm = () => {if (calm.matches) {age = 2; press = 0; receipt = 0; place();} else kick();};
    document.addEventListener('visibilitychange', onVisibility);
    calm.addEventListener('change', onCalm);
    return () => {
      observer.disconnect();
      if (handle) cancelAnimationFrame(handle);
      document.removeEventListener('visibilitychange', onVisibility);
      calm.removeEventListener('change', onCalm);
      motion.current = null;
    };
  }, []);

  useEffect(() => {motion.current?.play(state.operation);}, [state.sequence, state.operation]);

  // The optional tour invokes exactly the same state transitions as the buttons.
  useEffect(() => {
    if (!touring || !hydrated || !root.current) return;
    const host = root.current;
    let visible = false;
    let interacting = host.matches(':hover');
    let phase = 0;
    const observer = new IntersectionObserver(entries => {visible = entries[entries.length - 1].isIntersecting;});
    observer.observe(host);
    const enter = () => {interacting = true;};
    const leave = () => {interacting = false;};
    host.addEventListener('pointerenter', enter);
    host.addEventListener('pointerleave', leave);
    const timer = window.setInterval(() => {
      if (!visible || interacting || (host.contains(document.activeElement) && !document.activeElement?.matches('[data-action="tour"]')) || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const previous = stateRef.current;
      const step = phase++ % 5;
      const next = step === 0 ? readDigest(createDigestMachine())
        : step === 1 ? commitDigestFields(previous, 'Beta', 20)
          : step === 2 ? projectDigest(previous)
            : step === 3 ? readDigest(previous) : createDigestMachine();
      setState(next);
    }, 1800);
    return () => {
      clearInterval(timer); observer.disconnect();
      host.removeEventListener('pointerenter', enter);
      host.removeEventListener('pointerleave', leave);
    };
  }, [touring, hydrated]);

  function act(action: string, transition: (current: DigestMachineState) => DigestMachineState) {
    setTouring(false);
    setState(transition);
    trackDemoStart('clawhub-digest-machine', action);
  }

  return <section ref={root} id="clawhub-digest-machine" className={`${demoSurface.surface} ${frame.surface} ${styles.demo}`}
    data-demo="clawhub-digest-machine" data-book-island data-operation={state.operation}
    aria-labelledby={`${id}-heading`}>
    <p className={frame.eyebrow}>Anatomy / 交互读模型</p>
    <h3 className={frame.heading} id={`${id}-heading`}>读模型压印机</h3>
    <p className={frame.note}>先读取 Alpha，再把它更新为 Beta：digest 会改变，已经拿到的 one-shot 收据仍保留 Alpha。</p>
    <div className={frame.card}>
      <div className={frame.corners}><span>Fig 01</span><span>Projection → difference guard → digest</span></div>
      <svg ref={svg} className={frame.figure} viewBox={`0 0 ${DIGEST_WIDTH} ${DIGEST_HEIGHT}`}
        role="img" aria-label="等距视角的制卡压印机：左侧源记录料斗，中部带导轨的压头和字段比较触针，右侧持久化 digest 抽屉，前方独立 one-shot 收据托盘。"
        data-anatomy-parts={DIGEST_PART_COUNT}>
        <path d={DIGEST_HALO} className={styles.halo} />
        <g ref={partsHost}>
        {DIGEST_PARTS.map(item => {
          const paper = item.name === 'stock-paper' ? state.source
            : item.name === 'candidate-paper' ? state.source
              : item.name === 'digest-paper' ? state.digest
                : item.name === 'one-shot-receipt' ? state.receipt?.result : undefined;
          const hidden = item.assembly === 'digest' && !state.digest || item.assembly === 'receipt' && !state.receipt?.result;
          return <g key={item.name} data-motion={item.assembly} data-part={item.name} data-anatomy-key={item.key} visibility={hidden ? 'hidden' : undefined}>
            {partArt.get(item.name)}
            {paper ? <FieldsPrint paper={item.name as Parameters<typeof paperFields>[0]} fields={paper} /> : null}
          </g>;
        })}
        </g>
      </svg>
      <div className={frame.corners}><span>压头下压表示投影与比较</span><span>digest revision {state.revision}</span></div>
    </div>
    <div className={frame.legend} aria-label="装置图例">
      <span>左：源记录</span><span>中：投影模具与比较触针</span><span>右：持久 digest</span><span>前：one-shot 收据</span>
    </div>
    <div className={styles.editor}>
      <label className={styles.nameLabel}>待提交 displayName
        <select value={name} disabled={!hydrated} onChange={event => {setTouring(false); setName(event.target.value as DigestFields['displayName']);}}>
          <option value="Alpha">Alpha</option><option value="Beta">Beta</option>
        </select>
      </label>
      <Slider className={styles.slider} value={downloads} minValue={0} maxValue={30} step={1} isDisabled={!hydrated}
        onChange={value => {setTouring(false); setDownloads(Array.isArray(value) ? value[0] : value);}}>
        <Label className="text-xs">待提交 downloads</Label><Slider.Output className="text-xs tabular-nums" />
        <Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
      </Slider>
    </div>
    <div className={frame.controls} role="group" aria-label="压印机控制">
      <Button size="sm" isDisabled={!hydrated} onPress={() => act('update', current => commitDigestFields(current, name, downloads))} data-action="update">更新并投影</Button>
      <Button size="sm" variant="secondary" isDisabled={!hydrated} onPress={() => act('reproject', projectDigest)} data-action="reproject">重复投影</Button>
      <Button size="sm" variant="secondary" isDisabled={!hydrated} onPress={() => act('read', readDigest)} data-action="read">读取一次</Button>
      <Button size="sm" variant="ghost" isDisabled={!hydrated || !state.digest} onPress={() => act('delete', removeDigest)} data-action="delete">模拟误删 digest</Button>
      <Button size="sm" variant="ghost" isDisabled={!hydrated || !!state.digest} onPress={() => act('rebuild', rebuildDigest)} data-action="rebuild">重建 digest</Button>
      <Button size="sm" variant="ghost" isDisabled={!hydrated} onPress={() => act('reset', () => createDigestMachine())} data-action="reset">重置</Button>
      <Button size="sm" variant="ghost" isDisabled={!hydrated} onPress={() => {
        setTouring(current => !current); trackDemoStart('clawhub-digest-machine', 'tour');
      }} aria-pressed={touring} data-action="tour">{touring ? '停止演示' : '播放示例'}</Button>
    </div>
    <p className={styles.actionHelp}>“重复投影”保留源字段；“模拟误删”会让列表缺项，需要从源记录重建。播放示例后，移入装置可暂停观察。</p>
    <dl className={styles.documents}>
      <DocumentReading label="skills / 源记录" fields={state.source} empty="缺失" />
      <DocumentReading label="skillSearchDigest" fields={state.digest} empty="已误删">
        <span className={styles.flag} data-digest-revision>revision {state.revision}</span>
      </DocumentReading>
      <DocumentReading label="one-shot / 已返回" fields={state.receipt?.result ?? null} empty={state.receipt ? '没有这一项' : '尚未读取'}>
        {state.receipt ? <span className={styles.flag} data-receipt-stale>{stale ? '保留旧收据；再次读取才更新' : `读取于 revision ${state.receipt.revision}`}</span> : null}
      </DocumentReading>
    </dl>
    <div className={styles.stats} aria-label="教学模型计数">
      <span>digest 写入 <strong data-count="writes">{state.writes}</strong></span>
      <span>跳过写入 <strong data-count="skips">{state.skippedWrites}</strong></span>
      <span>Query 求值 <strong data-count="runs">{state.queryRuns}</strong></span>
      <span>教学命中 <strong data-count="hits">{state.cacheHits}</strong></span>
    </div>
    <p className={`${frame.note} ${styles.status}`} role="status" aria-live="polite" data-machine-status>{digestStatus(state)}</p>
    <p className={frame.note}>只保留 displayName、downloads、updatedAt 三个投影字段；机械动作回放同一次原子提交。Query 仅模拟匿名读取一个 digest，真实 Browse 还可能读取 Publisher 或回源。计数来自本页模型，未测量线上性能。</p>
    <noscript><p className={frame.note}>图中源记录与 digest 均为 Alpha、downloads 10；启用 JavaScript 后可比较真实更新与重复投影。</p></noscript>
  </section>;
}
