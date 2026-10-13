import demoSurface from './DemoSurface.module.css';
import {useEffect, useRef, useState} from 'react';
import {Button} from '@heroui/react';
import {AnatomyDots, AnatomyLine, AnatomySolid} from './AnatomyArt';
import {CINDY_LABEL_TRANSFORM, CINDY_PARTS, CINDY_PROJECTION, CINDY_VIEW} from './cindy-orca-geometry';
import {translateAlong} from './anatomy-iso-kit';
import {actCindyOrca, canSummarizeCindy, cindyHasTransfers, cindyPhaseText, createCindyOrca, tickCindyOrca, type CindyOrcaAction, type CindyOrcaState, type CindyWorkerId} from './cindy-orca-model';
import frame from './AnatomyFrame.module.css';
import styles from './CindyOrcaMachine.module.css';

const REST = createCindyOrca();
const smooth = (value: number) => value * value * (3 - 2 * value);
const signature = (state: CindyOrcaState) => state.workers.map(worker => `${worker.phase}:${worker.step}:${worker.history.length}`).join('|') + state.summary;
const STATIC_ART = new Map(CINDY_PARTS.filter(part => !part.motion && !part.name.endsWith('output-sheet')).map(part => [part.name, <g key={part.name}>
  <AnatomySolid paths={part.paths} tone={part.tone} name={part.name} />
  {part.screws && <AnatomyDots points={part.screws} />}
  {part.rules && <AnatomyLine d={part.rules} faint free={part.freeRules} />}
  {part.name === 'lead-nameplate' && <text className={styles.engraving} transform={CINDY_LABEL_TRANSFORM} x="0" y="4">ORCA</text>}
</g>]));

/** An illustrative local state machine: no network, real Cindy session or model call. */
export default function CindyOrcaMachine() {
  const [snapshot, setSnapshot] = useState(REST);
  const [hydrated, setHydrated] = useState(false);
  const [selected, setSelected] = useState<CindyWorkerId>('A');
  const [touring, setTouring] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const surface = useRef<HTMLElement>(null);
  const moving = useRef<Record<string, SVGGElement | null>>({});
  const live = useRef<HTMLSpanElement>(null);
  const state = useRef(createCindyOrca());
  const animation = useRef({raf: 0, last: 0, visible: false, reduced: false, tour: true, pointer: false, focus: false, sinceAction: 0, tourClock: 0, selector: 0, progressA: 0, progressB: 0});
  const kick = useRef<() => void>(() => {});
  const pausedByUser = useRef(false);

  function publish(next: CindyOrcaState, announce = true) {
    state.current = next;
    setSnapshot(next);
    if (announce) setAnnouncement(next.summary ?? next.workers.map(worker => `Worker ${worker.id}：${cindyPhaseText(worker)}`).join('；'));
    kick.current();
  }
  function act(action: CindyOrcaAction) {
    pausedByUser.current = true; animation.current.tour = false; setTouring(false);
    if ('worker' in action) setSelected(action.worker);
    publish(actCindyOrca(state.current, action));
  }

  useEffect(() => {
    setHydrated(true);
    const runtime = animation.current;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    runtime.reduced = still.matches;
    setReducedMotion(still.matches);
    if (still.matches) {runtime.tour = false; setTouring(false);}
    let disposed = false;
    const follow = (current: number, target: number, dt: number) => runtime.reduced || Math.abs(target - current) < 0.003 ? target : current + (target - current) * (1 - Math.exp(-dt / 0.18));
    function paint(dt: number) {
      const current = state.current;
      const active = current.workers.some(worker => worker.phase !== 'idle');
      runtime.selector = follow(runtime.selector, active ? 12 : 0, dt);
      moving.current.selector?.setAttribute('transform', translateAlong(CINDY_PROJECTION, [runtime.selector, 0, 0]));
      moving.current['selector-knob']?.setAttribute('transform', translateAlong(CINDY_PROJECTION, [runtime.selector, 0, 0]));
      for (const worker of current.workers) {
        const position = worker.phase === 'delivering' ? smooth(worker.transfer) * 38 : worker.phase === 'returning' ? (1 - smooth(worker.transfer)) * 38 : ['working', 'waiting', 'ready', 'error'].includes(worker.phase) ? 38 : 0;
        moving.current[`ticket-${worker.id}`]?.setAttribute('transform', translateAlong(CINDY_PROJECTION, [position, 0, 0]));
        const field = worker.id === 'A' ? 'progressA' : 'progressB';
        runtime[field] = follow(runtime[field], worker.step / 3 * 48, dt);
        moving.current[`progress-${worker.id}`]?.setAttribute('transform', translateAlong(CINDY_PROJECTION, [runtime[field], 0, 0]));
      }
      if (live.current) live.current.textContent = current.summary ? 'Lead 已检查两份回报' : `${current.workers.filter(worker => worker.phase === 'reported').length}/2 已回报 · ${cindyHasTransfers(current) ? '工单在途' : '等待下一步'}`;
      return Math.abs(runtime.selector - (active ? 12 : 0)) > 0.003 || current.workers.some(worker => Math.abs(runtime[worker.id === 'A' ? 'progressA' : 'progressB'] - worker.step / 3 * 48) > 0.003);
    }
    function tourStep() {
      let next = state.current;
      if (next.summary) next = createCindyOrca();
      else if (next.workers.every(worker => worker.phase === 'idle')) next = actCindyOrca(next, {type: 'dispatch'});
      else if (!cindyHasTransfers(next)) {
        for (const worker of next.workers) {
          if (worker.phase === 'waiting') next = actCindyOrca(next, {type: 'confirm', worker: worker.id});
          else if (worker.phase === 'working') next = actCindyOrca(next, {type: 'advance', worker: worker.id});
          else if (worker.phase === 'ready') next = actCindyOrca(next, {type: 'report', worker: worker.id});
        }
        if (canSummarizeCindy(next)) next = actCindyOrca(next, {type: 'summarize'});
      }
      if (next !== state.current) {state.current = next; setSnapshot(next);}
    }
    function tick(now: number) {
      runtime.raf = 0;
      if (disposed || !runtime.visible || document.hidden) {runtime.last = 0; return;}
      const dt = runtime.last ? Math.min((now - runtime.last) / 1000, 1 / 30) : 1 / 60;
      runtime.last = now;
      const previous = state.current;
      state.current = tickCindyOrca(previous, dt, runtime.reduced);
      if (signature(previous) !== signature(state.current)) {
        setSnapshot(state.current);
        if (pausedByUser.current) setAnnouncement(state.current.workers.map(worker => `Worker ${worker.id}：${cindyPhaseText(worker)}`).join('；'));
      }
      const automatic = runtime.tour && !runtime.reduced && !runtime.pointer && !runtime.focus;
      if (automatic) {
        runtime.tourClock += dt;
        if (runtime.tourClock >= (state.current.summary ? 4 : 1.7)) {runtime.tourClock = 0; tourStep();}
      }
      const unsettled = paint(dt);
      if (automatic || cindyHasTransfers(state.current) || unsettled) runtime.raf = requestAnimationFrame(tick);
      else runtime.last = 0;
    }
    const run = () => {if (!disposed && runtime.visible && !document.hidden && !runtime.raf) {runtime.last = 0; runtime.raf = requestAnimationFrame(tick);}};
    kick.current = run;
    const observer = new IntersectionObserver(entries => {
      runtime.visible = entries[entries.length - 1]!.isIntersecting;
      if (runtime.visible) run();
      else {cancelAnimationFrame(runtime.raf); runtime.raf = 0; runtime.last = 0;}
    }, {rootMargin: '120px 0px'});
    if (surface.current) observer.observe(surface.current);
    const visibility = () => {if (document.hidden) {cancelAnimationFrame(runtime.raf); runtime.raf = 0; runtime.last = 0;} else run();};
    const motionPreference = () => {
      runtime.reduced = still.matches;
      setReducedMotion(still.matches);
      if (still.matches) {runtime.tour = false; setTouring(false);}
      run();
    };
    document.addEventListener('visibilitychange', visibility);
    still.addEventListener('change', motionPreference);
    return () => {
      disposed = true; cancelAnimationFrame(runtime.raf); observer.disconnect();
      document.removeEventListener('visibilitychange', visibility); still.removeEventListener('change', motionPreference); kick.current = () => {};
    };
  }, []);

  const dispatched = snapshot.workers.some(worker => worker.phase !== 'idle');
  const reported = snapshot.workers.filter(worker => worker.phase === 'reported').length;
  return <section className={`${demoSurface.surface} ${frame.surface}`} ref={surface} aria-label="Orca 独立会话调度台" data-cindy-orca="true"
    onPointerEnter={() => {animation.current.pointer = true;}}
    onPointerLeave={() => {animation.current.pointer = false; kick.current();}}
    onFocusCapture={event => {animation.current.focus = !(event.target as HTMLElement).closest('[data-action="tour"]');}}
    onBlurCapture={event => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {animation.current.focus = false; kick.current();}}}>
    <header className={styles.header}>
      <div><div className={frame.eyebrow}>ANATOMY / ORCA SESSIONS</div><h2 className={frame.heading}>工单往返，历史各自保留</h2></div>
      <span className={styles.status}>本地教学模型</span>
    </header>
    <div className={frame.card}>
      <div className={frame.corners}><span>Fig 02</span><span>Lead 调度台 / 两座记录台</span></div>
      <svg className={frame.figure} viewBox={`0 0 ${CINDY_VIEW.width} ${CINDY_VIEW.height}`} role="img" aria-label="左侧 Lead 调度拨杆向两座独立 Worker 记录台分派工单，作业进度各自记录，成果沿工单轨道回传。">
        <ellipse className={styles.halo} cx="360" cy="304" rx="248" ry="53" />
        {CINDY_PARTS.map(part => {
          const output = part.name.match(/^worker-([AB])-output-sheet$/);
          if (!part.motion && !output) return STATIC_ART.get(part.name);
          const isTicket = part.motion?.startsWith('ticket-');
          const worker = output ? snapshot.workers.find(item => item.id === output[1]) : undefined;
          const piece = <g key={part.name} opacity={output && !worker?.result ? 0 : 1}>
            <AnatomySolid paths={part.paths} tone={part.tone} lit={Boolean(isTicket && part.motion === `ticket-${selected}`)} name={part.name} />
            {part.rules && <AnatomyLine d={part.rules} faint free={part.freeRules} />}
          </g>;
          return <g key={part.name} ref={node => {if (part.motion) {
            if (part.motion === 'selector' && part.name === 'lead-lever-knob') return;
            moving.current[part.motion] = node;
          }}}>{part.motion === 'selector' && part.name === 'lead-lever-knob' ? <g ref={node => {moving.current['selector-knob'] = node;}}>{piece}</g> : piece}</g>;
        })}
      </svg>
      <div className={frame.corners}><span>分派 → 各自作业 → 回报 → Lead 检查</span><span ref={live}>0/2 已回报 · 等待派活</span></div>
    </div>
    <div className={frame.legend}><span>左侧：Lead 调度台</span><span>后侧：Worker A 记录台</span><span>前侧：Worker B 记录台</span><span>强调的工单：Worker {selected}</span></div>
    <div className={frame.controls} role="group" aria-label="Lead 调度操作">
      <Button size="sm" variant="primary" isDisabled={!hydrated || dispatched} onPress={() => act({type: 'dispatch'})}>分派两个任务</Button>
      <Button size="sm" variant="secondary" isDisabled={!hydrated || !canSummarizeCindy(snapshot) || Boolean(snapshot.summary)} onPress={() => act({type: 'summarize'})}>检查并汇总</Button>
      <Button size="sm" variant="tertiary" isDisabled={!hydrated} onPress={() => {
        pausedByUser.current = true; animation.current.tour = false; setTouring(false); publish(createCindyOrca());
      }}>重置</Button>
      <Button size="sm" variant="tertiary" isDisabled={!hydrated || reducedMotion} data-action="tour" aria-pressed={touring} onPress={() => {
        const next = !animation.current.tour;
        animation.current.tour = next; animation.current.tourClock = 0; pausedByUser.current = !next; setTouring(next); kick.current();
      }}>{touring ? '暂停自动演示' : '自动演示'}</Button>
    </div>
    <div className={styles.workers}>
      {snapshot.workers.map(worker => <article key={worker.id} className={styles.worker} data-selected={selected === worker.id || undefined}>
        <h3>Worker {worker.id} · {worker.harness}</h3>
        <p><strong>{worker.task}</strong><br />{snapshot.summary && worker.phase === 'reported' ? 'done · Lead 已检查回报' : cindyPhaseText(worker)}</p>
        <p>独立上下文：{worker.context}</p>
        <div className={styles.actions} role="group" aria-label={`Worker ${worker.id} 操作`}>
          <Button size="sm" variant="secondary" isDisabled={!hydrated || !['working', 'waiting', 'error'].includes(worker.phase)} onPress={() => act({type: worker.phase === 'waiting' ? 'confirm' : worker.phase === 'error' ? 'retry' : 'advance', worker: worker.id})}>
            {worker.phase === 'waiting' ? `确认 ${worker.id} 范围` : worker.phase === 'error' ? `重试 ${worker.id}` : `推进 ${worker.id} 一步`}
          </Button>
          <Button size="sm" variant="secondary" isDisabled={!hydrated || worker.phase !== 'ready'} onPress={() => act({type: 'report', worker: worker.id})}>{worker.id} 回报</Button>
          <Button size="sm" variant="tertiary" isDisabled={!hydrated || !['working', 'waiting', 'ready'].includes(worker.phase)} onPress={() => act({type: 'fail', worker: worker.id})}>{worker.id} 模拟失败</Button>
        </div>
        <details className={styles.history}><summary>{worker.id} 的独立历史 · {worker.history.length} 条</summary><ol>{worker.history.map((line, index) => <li key={index}>{line}</li>)}</ol></details>
      </article>)}
    </div>
    <div className={styles.lead}><strong>{snapshot.summary ?? (reported === 2 ? '两份回报已收到，等待 Lead 检查。' : `Lead 已收到 ${reported}/2 份回报。`)}</strong><br /><span>独立历史不自动合并：Lead 收到的是消息与成果回报。</span></div>
    <details className={styles.history}><summary>查看 Lead 历史 · {snapshot.leadHistory.length} 条</summary><ol>{snapshot.leadHistory.map((line, index) => <li key={index}>{line}</li>)}</ol></details>
    <p className={styles.caption}>拨杆代表派活，工单纸代表消息往返，独立卷盘与纸张代表各自的上下文和历史。等待确认属于会话的执行条件；源码中的 Worker 状态仍是 idle / running / done / error。done 表示已回报，验收需要 Lead 另行检查。</p>
    <p className={frame.note}>图中使用预设任务和成果，不调用 Cindy、云服务或模型。三步进度是教学安排；两座作业台说明独立会话，不复刻产品的 focused Worker 界面，也不表示独立文件系统或默认独立 worktree。</p>
    <noscript><p>未启用 JavaScript：两个 Worker 已创建但尚未派活。它们保留各自上下文和历史；Lead 必须收到成果回报后才能检查并汇总。</p></noscript>
    <span className={styles.sr} aria-live="polite">{announcement}</span>
  </section>;
}
