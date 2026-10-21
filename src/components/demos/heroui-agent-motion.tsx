import {useCallback, useId, useRef} from 'react';
import {AnatomyDots, AnatomyLine, AnatomySolid} from './AnatomyArt';
import {MechanismPlayer, motionEase, motionMix, motionRange} from './MechanismPlayer';
import {topMatrix} from './anatomy-iso-kit';
import {BASE_SEAM, BASE_SHADOW, FIXING_DOTS, GAUGE_PARTS, HEAD_PARTS, HEIGHT, INPUT_MATRIX, PAPER, PAPER_MATRIX, PAPER_PATH, PAPER_Z, PART_COUNT, P, PROTOCOL_MATRIX, SOURCE_READER, STATIC_PARTS, WIDTH, move} from './heroui-agent-motion-geometry';
import type {ComposerState} from './heroui-agent-composer-model';
import styles from './heroui-agent-motion.module.css';

const phases = [
  {at: 0, label: '读取工具数据'},
  {at: .15, label: '登记 root 引用'},
  {at: .28, label: '组装容器与 children'},
  {at: .46, label: '组件到达并校验'},
  {at: .55, label: '同一数据装入界面'},
  {at: .86, label: '检查完整结果'},
];
const smooth = (p: number, from: number, to: number) => motionEase(motionRange(p, from, to));
interface LiveNodes {
  paper: SVGGElement; root: SVGGElement; container: SVGGElement; component: SVGGElement;
  gauge: SVGGElement; head: SVGGElement; source: SVGGElement;
  probes: SVGGElement[];
  tokens: SVGGElement[]; backgrounds: SVGRectElement[]; lengths: SVGRectElement[]; values: SVGTextElement[];
  guide: SVGPathElement; count: HTMLElement; readout: HTMLElement; missing: SVGPathElement; metric: SVGGElement;
  partial: HTMLElement; transfer: HTMLElement; printedLabels: SVGGElement; phase: number; received: number; semanticKey: string; transferText: string;
}
function nodesAt(stage: HTMLDivElement): LiveNodes {
  const node = <T extends Element>(selector: string) => stage.querySelector<T>(selector)!;
  return {
    paper: node('[data-composer-sheet]'), root: node('[data-spec-root]'), container: node('[data-spec-container]'), component: node('[data-spec-component]'),
    gauge: node('[data-validation-comb]'), head: node('[data-registration-head]'), source: node('[data-source-scan]'),
    probes: [...stage.querySelectorAll<SVGGElement>('[data-validation-comb] [data-anatomy-part]')].slice(1),
    tokens: [...stage.querySelectorAll<SVGGElement>('[data-value-token]')],
    backgrounds: [...stage.querySelectorAll<SVGRectElement>('[data-token-body]')],
    lengths: [...stage.querySelectorAll<SVGRectElement>('[data-token-length]')],
    values: [...stage.querySelectorAll<SVGTextElement>('[data-token-number]')],
    guide: node('[data-assembly-guide]'), count: node('[data-motion-patches]'), readout: node('[data-motion-output]'),
    missing: node('[data-missing-slot]'), metric: node('[data-assembled-metric]'), partial: node('[data-motion-spec]'), transfer: node('[data-transfer-value]'),
    printedLabels: node('[data-printed-labels]'), phase: -1, received: -1, semanticKey: '', transferText: '',
  };
}

/** The values themselves travel through the reference fixture and become UI marks. */
export default function HeroUIAgentMotion({state}: {state: ComposerState}) {
  const uid = useId();
  const cache = useRef<{stage: HTMLDivElement; nodes: LiveNodes} | null>(null);
  const view = state.spec.elements['sales-view'];
  const total = view.type === 'metric-grid' ? (view.props.metrics as Array<{value?: number}>)[0]?.value : state.data.total;
  const sourceValues = state.data.rows.map(row => row.quantity);
  const graphValues = view.type === 'bar-chart'
    ? (view.props.data as Array<{value?: number}>).map(row => row.value)
    : view.type === 'data-table'
      ? (view.props.rows as Array<{quantity?: number}>).map(row => row.quantity)
      : [total];
  const resetKey = JSON.stringify([state.presentation, sourceValues, state.accepted]);

  const onFrame = useCallback((stage: HTMLDivElement, progress: number, _meta: {reducedMotion: boolean}) => {
    if (cache.current?.stage !== stage) cache.current = {stage, nodes: nodesAt(stage)};
    const n = cache.current.nodes;
    const p = progress;
    const out = 0;
    const registered = smooth(p, .13, .23);
    const container = smooth(p, .28, .4);
    const received = p < .16 ? 0 : p < .25 ? 1 : p < .34 ? 2 : p < .46 ? 3 : 4;
    const verified = smooth(p, .46, .53);
    stage.dataset.motionReceived = String(received);
    stage.dataset.motionValid = String(verified >= .999 && state.accepted);
    stage.dataset.motionPhase = String(phases.filter(phase => p >= phase.at).length - 1);
    n.root.style.opacity = String(registered * (1 - out));
    n.root.setAttribute('transform', move(0, 0, 12 * (1 - registered)));
    n.container.style.opacity = String(container * (1 - out));
    n.container.setAttribute('transform', move(0, 0, 17 * (1 - container)));
    n.component.style.opacity = String(smooth(p, .4, .46) * (1 - out));
    n.component.setAttribute('transform', move(0, 0, 12 * (1 - smooth(p, .4, .46))));
    const opened = smooth(p, .53, .58);
    const gaugeDrop = state.accepted ? 4 * verified * (1 - opened) - 8 * opened : 2 * verified;
    n.gauge.setAttribute('transform', move(0, 0, -gaugeDrop));
    n.gauge.dataset.blocked = String(!state.accepted && received === 4);
    n.probes.forEach((probe, index) => {
      if (graphValues[index] !== undefined && p >= .46 + index * .014 + .012) probe.setAttribute('data-lit', 'true');
      else probe.removeAttribute('data-lit');
    });
    // Read through the total register, then park behind the first source row
    // before any record is released into the transfer channel.
    n.source.setAttribute('transform', move(0, (smooth(p, .02, .1) - smooth(p, .1, .15)) * 156, 0));
    n.paper.setAttribute('transform', move(0, 190 * out, 0));
    n.paper.style.opacity = String(1 - out);
    // The metric number is the same travelling total token, enlarged in place.
    n.metric.style.opacity = '0';
    n.guide.style.opacity = String(state.accepted ? smooth(p, .51, .56) * (1 - out) : 0);
    n.printedLabels.style.opacity = String(state.accepted ? smooth(p, .51, .56) : 0);
    n.missing.style.opacity = String(!state.accepted && received === 4 ? verified * (1 - out) : 0);
    for (let index = 0; index < 4; index++) {
      const token = n.tokens[index];
      const value = graphValues[index];
      const onlyMetric = view.type === 'metric-grid';
      const departAt = .53 + index * .062;
      const travel = smooth(p, departAt, departAt + .13);
      // Invalid descriptions stay at the comb. No output marks are assembled.
      const route = travel;
      const format = state.accepted ? route : 0;
      const sourceY = onlyMetric ? 74 : -61 + index * 35;
      const endX = onlyMetric ? PAPER.x + 54 : view.type === 'data-table' ? PAPER.x + 112 : PAPER.x + 23;
      const endY = onlyMetric ? PAPER.y + 72 : PAPER.y + 24 + index * 30;
      // A rejected 80-unit carrier stops with its leading edge 2 units
      // before the comb at world x=9. It never stretches through the teeth.
      const stopX = 9 - 2 - 80;
      const x = motionMix(-228, state.accepted ? endX : stopX, route);
      const y = state.accepted ? motionMix(sourceY, endY, route) : sourceY;
      const z = PAPER_Z + .2;
      token.setAttribute('transform', topMatrix([x, y], z, P));
      const emitted = p >= departAt;
      token.style.opacity = String((onlyMetric && index > 0 || !emitted ? 0 : 1) * (1 - out));
      token.dataset.arrived = String(state.accepted && travel >= .999);
      token.dataset.stopped = String(!state.accepted && travel >= .999);
      token.dataset.value = value === undefined ? 'missing' : String(value);
      n.backgrounds[index].setAttribute('width', String(motionMix(80, view.type === 'data-table' ? 42 : 135, format)));
      n.backgrounds[index].style.opacity = String(1 - format);
      const amount = value ?? 0;
      n.lengths[index].setAttribute('width', String(view.type === 'data-table' || onlyMetric ? 0 : motionMix(amount * .61, amount * 1.27, format)));
      n.lengths[index].setAttribute('height', String(motionMix(7, 12, format)));
      n.values[index].setAttribute('x', String(view.type === 'data-table' || onlyMetric ? 6 : motionMix(62, amount * 1.27 + 4, format)));
      n.values[index].setAttribute('font-size', String(motionMix(8.4, onlyMetric ? 35 : view.type === 'data-table' ? 12 : 9.2, format)));
      n.values[index].textContent = value === undefined ? '—' : String(value);
    }
    const headTravel = state.accepted ? smooth(p, .53, .8) * (1 - smooth(p, .82, .94)) : 0;
    n.head.setAttribute('transform', move(headTravel * 135, 0, 0));
    n.head.dataset.working = String(state.accepted && p >= .53 && p < .84);
    // The mobile readout follows the same carrier and arrival pose, so tiny
    // projected glyphs are never the only way to follow the data's identity.
    const active = view.type === 'metric-grid' ? 0 : Math.min(3, Math.floor((p - .53) / .062));
    const atToken = Math.max(0, active);
    const arrived = smooth(p, .53 + atToken * .062, .66 + atToken * .062) >= .999;
    const target = view.type === 'metric-grid' ? '销量指标' : view.type === 'data-table' ? `表格第 ${atToken + 1} 行` : `第 ${atToken + 1} 根柱条`;
    const source = view.type === 'metric-grid' ? `工具合计 ${total ?? '缺失'}` : `${state.data.rows[atToken].day} ${graphValues[atToken] ?? '缺失'}`;
    const transferText = p < .53 ? '数据尚在工具盒内，等待组件与量规就绪。'
      : `${source} → ${state.accepted ? target : '字段量规'} · ${!state.accepted ? arrived ? '已停靠，未输出' : '移向阻挡处' : arrived ? '已入槽' : '运送中'}`;
    if (transferText !== n.transferText) {n.transfer.textContent = transferText;n.transferText = transferText;}
    const phase = phases.filter(item => p >= item.at).length - 1;
    if (phase !== n.phase || received !== n.received || resetKey !== n.semanticKey) {
      n.phase = phase;n.received = received;n.semanticKey = resetKey;
      n.count.textContent = `${received} / 4 patches`;
      n.partial.textContent = received === 0 ? '{}' : received === 1 ? JSON.stringify({root: state.spec.root}, null, 2)
        : JSON.stringify(received < 4 ? {root: state.spec.root, elements: received < 3 ? {} : {'sales-layout': state.spec.elements['sales-layout']}} : state.spec, null, 2);
      n.readout.textContent = received < 4 ? received === 0 ? '读取数据，尚无完整界面描述' : `${received} / 4 · 引用尚未完整，输出纸面保持空白`
        : p < .53 ? '引用已到齐 · 字段量规正在核验'
        : !state.accepted ? '必需字段缺失 · 量规未闭合，数据条不能进入输出'
        : p < .84 ? '引用完整、Schema 通过 · 同一数据条正在组成界面'
        : `${state.presentation} · ${state.data.total} 件 · 数据保持一致`;
    }
  }, [resetKey]);

  return <div className={styles.root} data-composer-motion>
    <MechanismPlayer label="HeroUI：数据怎样组装成界面" duration={16} resetKey={resetKey} phases={phases} onFrame={onFrame}>
      <div className={styles.corners}><span>FIG 03 · 串行描述 / 界面装配</span><strong data-motion-patches>4 / 4 patches</strong></div>
      <svg className={styles.scene} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`${uid}-title ${uid}-desc`} data-solid-count={PART_COUNT}>
        <title id={`${uid}-title`}>带有数据盒、引用插槽、字段量规与输出纸面的界面装配机</title>
        <desc id={`${uid}-desc`}>root和容器引用先组装，容器的一条children引用连接唯一的数据组件。完整组件通过必需字段量规后，数据盒中的同一数值条进入输出纸面，成为柱状图、表格，或使用工具预计算合计的指标。缺失字段让量规保持断开，零值会合法装入。装配后保留完整结果，可拖动进度回看各阶段。物理装置和时间均为教学比喻。</desc>
        <defs><clipPath id={`${uid}-paper-clip`}><path d={PAPER_PATH} /></clipPath></defs>
        <path d={BASE_SHADOW} className={styles.shadow} />
        {STATIC_PARTS.map(part => <AnatomySolid key={part.name} name={`heroui-${part.name}`} paths={part.paths} tone={part.tone} />)}
        <AnatomyLine d={BASE_SEAM} faint /><AnatomyDots points={FIXING_DOTS} size={1.1} />
        <g transform={INPUT_MATRIX} className={styles.inputInk}>
          {sourceValues.map((value, index) => <g key={index} transform={`translate(0 ${index * 35 + 3})`}>
            <rect x="5" y="6" width="69" height="7" rx="1" className={styles.inputTrack} />
            {value !== undefined && <rect x="5" y="6" width={value * .61} height="7" rx="1" className={styles.inputLength} />}
            <text x="76" y="13">{value ?? '—'}</text>
          </g>)}
          <rect className={styles.totalWindow} x="4" y="139" width="89" height="17" rx="2" />
          <text data-source-total x="9" y="151">Σ {state.data.total ?? '—'}</text>
        </g>
        <g data-source-scan><AnatomySolid name="heroui-source-reader" paths={SOURCE_READER} tone="hi" lit /></g>
        <g data-spec-root><g transform={PROTOCOL_MATRIX}>
          <path className={styles.reference} d="M5 3h65v129H5Z" />
          <rect className={styles.socket} x="2" y="0" width="6" height="6" rx="1" />
          <path className={styles.reference} d="M8 3H37v16" />
        </g></g>
        <g data-spec-container><g transform={PROTOCOL_MATRIX}>
          <path className={styles.reference} d="M12 19h52v107H12Z" />
          <rect className={styles.socket} x="16" y="25" width="5" height="5" rx="1" />
        </g></g>
        <g data-spec-component><g transform={PROTOCOL_MATRIX}>
          <path className={styles.reference} d="M21 27h7" />
          <rect className={styles.referenceTile} x="28" y="22" width="31" height="101" rx="1.5" />
          {graphValues.map((value, index) => <g key={index} transform={`translate(31 ${27 + index * 25})`}>
            <rect className={styles.fieldSlot} width="25" height="13" rx="1" />
            {value !== undefined && <rect className={styles.socket} x="3" y="4" width={Math.max(2, Math.min(19, value * .18))} height="5" rx=".6" />}
          </g>)}
        </g></g>
        <g clipPath={`url(#${uid}-paper-clip)`}>
          <g data-composer-sheet>
            <path className={styles.paper} d={PAPER_PATH} />
            <g transform={PAPER_MATRIX}>
              <path data-assembly-guide className={styles.paperInk} d={view.type === 'data-table' ? 'M13 15H169V139H13ZM13 43H169M13 73H169M13 103H169M91 15V139' : view.type === 'metric-grid' ? 'M17 34H165V119H17ZM27 46H155M27 106H155' : 'M19 15V140H165M19 16H165M19 46H165M19 76H165M19 106H165'} />
              <g data-printed-labels>{view.type !== 'metric-grid' && [0, 1, 2, 3].map(index => <text className={styles.rowIndex} key={index} x="8" y={36 + index * 30}>{index + 1}</text>)}</g>
              <g data-assembled-metric className={styles.metricInk} opacity={view.type === 'metric-grid' && state.accepted ? 1 : 0}><text x="91" y="86" textAnchor="middle">{total ?? '—'}</text><path d="M67 94h48" /></g>
            </g>
          </g>
        </g>
        {[0, 1, 2, 3].map(index => <g key={index} data-value-token={index} opacity={view.type === 'metric-grid' && index > 0 ? 0 : 1} transform={topMatrix([PAPER.x + 23, PAPER.y + 24 + index * 30], PAPER_Z + .4, P)} className={styles.token}>
          <rect data-token-body width="80" height="20" rx="2" className={styles.tokenBody} />
          <rect data-token-length x="0" y="4" width={(graphValues[index] ?? 0) * 1.27} height="12" rx="1" className={styles.tokenLength} />
          <text data-token-number x={(graphValues[index] ?? 0) * 1.27 + 4} y="14" fontSize="9.2">{graphValues[index] ?? '—'}</text>
        </g>)}
        <g data-validation-comb>{GAUGE_PARTS.map((paths, index) => <AnatomySolid key={index} name={`heroui-validation-${index}`} paths={paths} tone="hi" lit={index > 0} />)}</g>
        <path data-missing-slot className={styles.missingSlot} transform={topMatrix([9, -51], PAPER_Z + .6, P)} d="M0 0l16 12m0-12L0 12" />
        <g data-registration-head>{HEAD_PARTS.slice(0, 2).map((paths, index) => <AnatomySolid key={index} name={`heroui-head-${index}`} paths={paths} tone={index ? 'hi' : 'lo'} lit={index === 1} />)}</g>
      </svg>
      <div className={styles.mobileLedger} aria-label="动画数据读数">
        <p>工具销量 <code>{sourceValues.map(value => value ?? '缺失').join(' · ')}</code><span>合计 <code>{state.data.total ?? '缺失'}</code></span></p>
        <p data-transfer-value>{state.accepted ? '数据已装入对应界面。' : '数据停在字段量规前，未输出。'}</p>
      </div>
      <p className={styles.readout} data-motion-output>{state.accepted ? `${state.presentation} · ${state.data.total} 件 · 数据保持一致` : '必需字段缺失 · 数据条不能进入输出'}</p>
      <div className={styles.legend}><span>左：工具数据</span><span>中：root / children / 组件引用</span><span>右：同一 props 形成的界面</span></div>
      <details className={styles.protocol}><summary>核对动画当前已接收的 spec</summary><pre data-motion-spec>{JSON.stringify(state.spec, null, 2)}</pre></details>
    </MechanismPlayer>
  </div>;
}
