import {useEffect, useId, useRef, useState, type SyntheticEvent} from 'react';
import {Button} from '@heroui/react';
import {AnatomyDots, AnatomyLine, AnatomySolid} from './AnatomyArt';
import {CINDY_PARTS, CINDY_PROJECTION, CINDY_SHADOW, CINDY_VIEW} from './cindy-orca-geometry';
import {topMatrix} from './anatomy-iso-kit';
import {CINDY_DEFAULT, CINDY_REVISION, CINDY_SESSIONS, CINDY_TOUR, evaluateCindyOrca, type CindyOrcaConditions} from './cindy-orca-model';
import demoSurface from './DemoSurface.module.css';
import frameStyles from './AnatomyFrame.module.css';
import styles from './CindyOrcaMachine.module.css';

const SOURCE = `https://github.com/makecindy/cindy/blob/${CINDY_REVISION}/`;
const STATIC_ART = new Map(CINDY_PARTS.filter(part => !part.show && !part.switch).map(part => [part.name,
  <g key={part.name}><AnatomySolid paths={part.paths} tone={part.tone} name={part.name} />
    {part.rules && <AnatomyLine d={part.rules} faint />}
    {part.screws && <AnatomyDots points={part.screws} />}
  </g>,
]));
const isTourControl = (event: SyntheticEvent) => Boolean((event.target as Element).closest('[data-action="tour"]'));

/** Branch comparison, not Cindy's product UI or a staged task-completion simulation. */
export default function CindyOrcaMachine() {
  const uid = useId();
  const root = useRef<HTMLElement>(null);
  const [conditions, setConditions] = useState<CindyOrcaConditions>(CINDY_DEFAULT);
  const [hydrated, setHydrated] = useState(false);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(true);
  const [reduced, setReduced] = useState(true);
  const [tour, setTour] = useState(false);
  const [touched, setTouched] = useState(false);
  const [hovering, setHovering] = useState(false);
  const branch = evaluateCindyOrca(conditions);
  const stop = () => {setTouched(true); setTour(false);};
  function choose<K extends keyof CindyOrcaConditions>(key: K, value: CindyOrcaConditions[K]) {
    stop(); setConditions(current => ({...current, [key]: value}));
  }
  useEffect(() => {
    setHydrated(true);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const preference = () => {setReduced(media.matches); if (media.matches) setTour(false);};
    preference(); media.addEventListener('change', preference);
    const visibility = () => setForeground(!document.hidden);
    visibility(); document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(entries => setVisible(entries[entries.length - 1]!.isIntersecting));
    if (root.current) observer.observe(root.current);
    return () => {observer.disconnect(); media.removeEventListener('change', preference); document.removeEventListener('visibilitychange', visibility);};
  }, []);
  useEffect(() => {
    if (!hydrated || !visible || !foreground || reduced || touched || tour || hovering) return;
    const timer = setTimeout(() => setTour(true), 12000);
    return () => clearTimeout(timer);
  }, [hydrated, visible, foreground, reduced, touched, tour, hovering]);
  useEffect(() => {
    if (!tour || !visible || !foreground || reduced || (hovering && !touched)) return;
    let index = 0;
    const timer = setInterval(() => {setConditions({...CINDY_TOUR[index % CINDY_TOUR.length]!}); index++;}, 3400);
    return () => clearInterval(timer);
  }, [tour, visible, foreground, reduced, hovering, touched]);

  return <section ref={root} className={`${demoSurface.surface} ${frameStyles.surface} ${styles.root}`} data-cindy-orca="true" data-demo="cindy-orca-machine" data-hydrated={hydrated} data-card-place={branch.cardPlace} data-report-path={conditions.report} data-delivery={conditions.delivery} aria-labelledby={`${uid}-title`}
    onPointerEnter={() => setHovering(true)} onPointerLeave={() => setHovering(false)}
    onPointerDown={event => {if (!isTourControl(event)) stop();}} onFocusCapture={event => {if (!isTourControl(event)) stop();}}>
    <header className={styles.header}>
      <span className={styles.figureNumber}>ANATOMY · FIG. 02</span>
      <h3 id={`${uid}-title`}>两个会话，一条回报，三种状态</h3>
      <p>Worker 的历史留在自己的会话中。回报经过 Dispatcher；宿主接受投递后，Lead 仍可能忙于另一轮输入。</p>
    </header>

    <div className={styles.modules}>
      <article className={styles.session} data-session="lead">
        <h4>Lead · 独立 Session</h4><p className={styles.moduleRole}>保留自己的上下文，接收 Worker 消息</p>
        <ol>{CINDY_SESSIONS.lead.history.map(line => <li key={line}>{line}</li>)}</ol>
        <span className={styles.native}>业务 Session L · native history L</span>
      </article>
      <article className={styles.dispatcher}>
        <h4>Dispatcher · 交换机构</h4><p className={styles.moduleRole}>判断目标是否忙，排队或送往会话入口</p>
        <strong data-dispatch-mode={branch.mode}>{branch.dispatcherText}</strong>
        <small>{conditions.report === 'terminal' ? 'auto-bridge 返回' : 'send_to_lead 返回'}</small><code>{branch.receipt}</code>
      </article>
      <article className={styles.session} data-session="worker">
        <h4>Worker · 独立 Session</h4><p className={styles.moduleRole}>接到上游 Harness，独立执行与记录</p>
        <ol>{CINDY_SESSIONS.worker.history.map(line => <li key={line}>{line}</li>)}</ol>
        <span className={styles.native}>业务 Session W · native history W</span>
      </article>
    </div>

    <div className={styles.machineWrap}>
      <svg viewBox={`0 0 ${CINDY_VIEW.width} ${CINDY_VIEW.height}`} className={styles.machine} role="img" aria-labelledby={`${uid}-machine-title ${uid}-machine-description`}>
        <title id={`${uid}-machine-title`}>两台独立纸卷电传机与一座回报交换台</title>
        <desc id={`${uid}-machine-description`}>左侧 Lead 与右侧 Worker 分别保留纸卷历史。中间 Dispatcher 对应宿主消息派发。当前报告{branch.cardPlace === 'queue' ? '在左侧 Lead 待处理托盘中' : branch.cardPlace === 'input' ? '已交到左侧 Lead 会话入口' : '仍在右侧 Worker 未交付托盘中'}。Worker 状态是{branch.workerStatus}；没有 Lead 已读或验收回执。</desc>
        <path d={CINDY_SHADOW} className={styles.shadow} />
        {CINDY_PARTS.map(part => {
          if (!part.show && !part.switch) return STATIC_ART.get(part.name);
          const shown = !part.show || part.show === branch.cardPlace;
          return <g key={part.name} visibility={shown ? 'visible' : 'hidden'} data-report-card={part.show}>
            <AnatomySolid paths={part.paths} tone={part.switch && conditions.delivery === 'rejected' ? 'lo' : part.tone} lit={Boolean(part.show && shown)} name={part.name} />
            {part.show && part.shape.kind === 'slab' && <g transform={topMatrix([part.shape.plan.x + 3, part.shape.plan.y + 3], part.shape.z + part.shape.height, CINDY_PROJECTION)} className={styles.reportInk}>
              <text x="0" y="3">接口核对报告</text><text x="0" y="7">输入 · 返回值 · 证据</text>
            </g>}
          </g>;
        })}
      </svg>
      <div className={styles.bays}>
        <p data-lead-status><span>Lead 待处理托盘 / 会话入口</span><strong>{branch.leadText}</strong><small>{conditions.lead === 'busy' ? 'Lead 当前轮次仍在运行' : 'Lead 当前轮次空闲'}；尚无内容已读或验收证据</small></p>
        <p className={styles.pending}><span>OrcaTeamService · 运行期回报状态</span><strong>{branch.pendingText}</strong><small>{conditions.report === 'terminal' ? 'autoBridge 为进程内 Map' : '状态写入是异步请求，非原子收口'}</small></p>
        <p data-worker-status={branch.workerStatus}><span>Worker 运行标记 · orca_workers.status</span><strong>{branch.workerMark}</strong><small>结果已产生；done 不能推出 Lead 已读或验收</small></p>
      </div>
    </div>

    <div className={styles.controls}>
      <fieldset><legend>Lead 当前状态</legend>
        <Button size="sm" variant={conditions.lead === 'busy' ? 'secondary' : 'outline'} aria-pressed={conditions.lead === 'busy'} isDisabled={!hydrated} onPress={() => choose('lead', 'busy')}>忙 · 当前轮次运行中</Button>
        <Button size="sm" variant={conditions.lead === 'idle' ? 'secondary' : 'outline'} aria-pressed={conditions.lead === 'idle'} isDisabled={!hydrated} onPress={() => choose('lead', 'idle')}>空闲</Button>
      </fieldset>
      <fieldset><legend>宿主投递结果</legend>
        <Button size="sm" variant={conditions.delivery === 'accepted' ? 'secondary' : 'outline'} aria-pressed={conditions.delivery === 'accepted'} isDisabled={!hydrated} onPress={() => choose('delivery', 'accepted')}>接受</Button>
        <Button size="sm" variant={conditions.delivery === 'rejected' ? 'secondary' : 'outline'} aria-pressed={conditions.delivery === 'rejected'} isDisabled={!hydrated} onPress={() => choose('delivery', 'rejected')}>拒绝</Button>
      </fieldset>
      <fieldset><legend>Worker 回报路径</legend>
        <Button size="sm" variant={conditions.report === 'terminal' ? 'secondary' : 'outline'} aria-pressed={conditions.report === 'terminal'} isDisabled={!hydrated} onPress={() => choose('report', 'terminal')}>终态 auto-bridge</Button>
        <Button size="sm" variant={conditions.report === 'explicit' ? 'secondary' : 'outline'} aria-pressed={conditions.report === 'explicit'} isDisabled={!hydrated} onPress={() => choose('report', 'explicit')}>显式 send_to_lead</Button>
      </fieldset>
      {!reduced && <Button size="sm" variant="ghost" data-action="tour" aria-pressed={tour} isDisabled={!hydrated} onPress={() => {setTouched(true); setTour(value => !value);}}>{tour ? '暂停演示' : '自动比较分支'}</Button>}
    </div>
    <div className={styles.explanation}>
      <ol className={styles.order}>{branch.order.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
      <p role="status" aria-live={tour ? 'off' : 'polite'}>{branch.explanation}</p>
    </div>
    <p className={styles.harness}><strong>Maker 适配层</strong>用统一 Session 接口连接 Claude Code SDK、Codex app-server 或 Pi RPC。两台纸卷表示独立业务 Session 与原生会话历史；共享 Host 可以多路复用原生会话，独立 Session 不等于每个 Worker 单独启动一个进程。</p>
    <details className={styles.source}><summary>源码中的模块职责（核对用）</summary><ul>
      <li><a target="_blank" rel="noopener noreferrer" href={`${SOURCE}apps/desktop/src/main/maker-ipc/orcaWorkerCreationService.ts#L1368-L1411`}>Worker 创建</a>生成独立业务 Session 并调用 bootstrap；<a target="_blank" rel="noopener noreferrer" href={`${SOURCE}packages/maker-core/src/maker.ts#L784-L919`}>Maker 适配</a>创建原生 handle、包装 Session 并保存身份关联。</li>
      <li><a target="_blank" rel="noopener noreferrer" href={`${SOURCE}apps/desktop/src/main/maker-ipc/orcaInterAgentDispatcher.ts#L411-L558`}>Dispatcher</a>形成队列回执，或发送到目标会话。</li>
      <li><a target="_blank" rel="noopener noreferrer" href={`${SOURCE}packages/orca-workflow/src/orca-bridge-mcp.ts#L802-L868`}>显式回报</a>在宿主接受之后请求标 done；写入失败单独记录。</li>
      <li><a target="_blank" rel="noopener noreferrer" href={`${SOURCE}apps/desktop/src/main/maker-ipc/orcaTeamService.ts#L622-L672`}>终态桥接</a>接受后删 pending；拒绝或异常则保留重试标记。先写状态的顺序见正文固定链接。</li>
    </ul></details>
    <p className={styles.boundary}>教学分支：固定一个已产生结果的 Worker，授权、归属、会话和存储均可用，delivery 使用默认 queue，不展开锁冲突、steer 与竞态。显式成功显示假定异步状态写入成功后的结果，省略写入失败；运行期收口另行发生。卡片位置表示回报去向，纸卷显示的是预设对话摘要。此图不运行 Cindy、上游 Harness 或模型，也不模拟创建任务、执行步数与人工验收。</p>
  </section>;
}
