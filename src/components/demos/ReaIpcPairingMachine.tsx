import {useEffect, useId, useRef, useState, type CSSProperties} from 'react';
import {Button, Input, Label, TextField} from '@heroui/react';
import {AnatomyLine, AnatomySolid} from './AnatomyArt';
import {depthOf, axisVector} from './anatomy-iso-kit';
import {
  REA_BASE_PARTS, REA_FRAME_PARTS, REA_BLADE_PARTS, REA_GATE_MARKERS, REA_LANES,
  REA_LATCH, REA_MACHINE_HEIGHT, REA_MACHINE_PROJECTION, REA_MACHINE_SHADOW,
  REA_MACHINE_WIDTH, REA_TALLY_MARKS, REA_TOKEN_LABELS, REA_TOKEN_PARTS,
} from './rea-ipc-pairing-geometry';
import {handlerPosition, pairingModel, REA_IPC_PRESETS, REA_IPC_REVISION, type PairingInput, type TransmissionOperation} from './rea-ipc-pairing-model';
import demoSurface from './DemoSurface.module.css';
import frameStyles from './AnatomyFrame.module.css';
import styles from './ReaIpcPairingMachine.module.css';

const steps = ['提取 IPC facts', '精确比较 Channel', '过滤通信模式', '计数并投影 Graph'] as const;
const source = `https://github.com/morluto/rea/blob/${REA_IPC_REVISION}/src/application/javascript/`;
const translations = {paired: '唯一候选', ambiguous: '存在歧义', unpaired: '没有候选'} as const;
const copyPreset = (index: number): PairingInput => structuredClone(REA_IPC_PRESETS[index]!.input);
const motion = (x: number, z = 0): CSSProperties => {
  const [dx, dy] = axisVector(REA_MACHINE_PROJECTION, [x, 0, z]);
  return {transform: `translate(${dx}px, ${dy}px)`};
};
// A long supporting base cannot be ordered by its centre against short tokens:
// it is physically below every lane, including tokens at the far input end.
const baseParts = [...REA_BASE_PARTS].sort((a, b) => a.center[2] - b.center[2] || a.depth - b.depth).map(part =>
  <g key={part.name}><AnatomySolid name={part.name} paths={part.paths} tone="lo" />{part.seam && <AnatomyLine d={part.seam} />}</g>,
);
const staticParts = REA_FRAME_PARTS.map(part => ({
  key: part.name, depth: part.depth,
  art: <g key={part.name}><AnatomySolid name={part.name} paths={part.paths} tone={part.layer === 'base' ? 'lo' : 'mid'} />{part.seam && <AnatomyLine d={part.seam} />}</g>,
}));

export default function ReaIpcPairingMachine({id = 'rea-ipc-pairing-machine'}: {id?: string}) {
  const uid = useId();
  const root = useRef<HTMLElement>(null);
  const [input, setInput] = useState<PairingInput>(() => copyPreset(0));
  const [step, setStep] = useState(3);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [touched, setTouched] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [foreground, setForeground] = useState(true);
  const model = pairingModel(input);
  useEffect(() => {
    setReady(true);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {setReduced(media.matches); if (media.matches) setPlaying(false);};
    update(); media.addEventListener('change', update);
    const visibility = () => setForeground(!document.hidden);
    visibility(); document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    if (root.current) observer.observe(root.current);
    return () => {observer.disconnect(); media.removeEventListener('change', update); document.removeEventListener('visibilitychange', visibility);};
  }, []);
  useEffect(() => {
    if (!ready || touched || reduced || !visible || !foreground) return;
    const timer = setTimeout(() => {setStep(0); setPlaying(true);}, 10000);
    return () => clearTimeout(timer);
  }, [ready, touched, reduced, visible, foreground]);
  useEffect(() => {
    if (!playing || reduced || !visible || !foreground) return;
    const timer = setTimeout(() => setStep(value => (value + 1) % 4), step === 3 ? 3500 : 1800);
    return () => clearTimeout(timer);
  }, [playing, reduced, visible, foreground, step]);
  const stop = () => {setTouched(true); setPlaying(false);};
  const update = (change: Partial<PairingInput>) => {stop(); setInput(value => ({...value, ...change})); setStep(3);};
  const choose = (index: number) => {stop(); setInput(copyPreset(index)); setStep(3);};
  const status = model.status === null ? '排除在配对之外' : translations[model.status];
  const stepDescription = !model.eligible
    ? 'send-to-host 在进入 classifyElectronIpcPairings 前被排除；记录仍然保留，不能把它计为 unpaired。'
    : step === 0 ? `从 renderer.js 取出 1 条 transmission；从 main.js 取出 ${model.handlers.length} 条 main handler。此时尚未匹配。`
    : step === 1 ? input.dynamic ? 'CHANNEL 是变量表达式；即使前面赋了常量，当前实现也将 channel 记为 null。所有 handler 都停在第一道闸前。' : `只保留 channel === ${JSON.stringify(input.channel)} 的 handler；${model.channelCount} 条通过第一道闸。大小写和空格都参与比较。`
    : step === 2 ? `再要求 ${model.transmission.mode === 'invoke' ? 'invoke → handle' : 'send → listen'}；剩下 ${model.candidates.length} 个 candidate。相同 Channel 本身不足以配对。`
    : model.status === 'paired' ? `候选集合只有 ${model.pairedHandler!.input.id}，所以状态为 paired，并增加一条 renderer → handler 的静态推断边。`
    : model.status === 'ambiguous' ? `候选集合有 ${model.candidates.length} 条，状态为 ambiguous；REA 保留歧义，不任意挑一个 handler 生成直接配对边。`
    : input.dynamic ? '动态 Channel 的状态为 unpaired，但不计入 unpaired_literal_renderer_transmissions；仍保留发送事实与动态 Channel 节点。'
    : '候选集合为空，状态为 unpaired；它表示此份静态输入没有找到候选，不能证明运行时没有接收方。';

  const tokenArt = input.handlers.filter(item => item.enabled).map(handler => {
    const lane = input.handlers.findIndex(item => item.id === handler.id);
    const result = model.handlers.find(item => item.input.id === handler.id)!;
    const x = handlerPosition(result, model.eligible, step);
    const rejected = model.eligible && ((step >= 1 && !result.channelMatches) || (step >= 2 && !result.modeMatches));
    return {
      key: handler.id, depth: depthOf([x, REA_LANES[lane]!, 6], REA_MACHINE_PROJECTION),
      art: <g key={handler.id} data-handler-token={handler.id} data-token-x={x} data-candidate={result.candidate} className={`${styles.moving} ${rejected ? styles.rejected : ''}`} style={motion(x + 142)}>
        {REA_TOKEN_PARTS[lane]!.map((part, index) => <AnatomySolid key={part.name} name={part.name} paths={part.paths} tone="hi" lit={index === 0 && step >= 2 && result.candidate} />)}
        <text transform={REA_TOKEN_LABELS[lane]} className={styles.tokenLabel} fontSize="4.7" textAnchor="middle">{handler.id}</text>
      </g>,
    };
  });
  const blades = REA_BLADE_PARTS.map(part => {
    const handler = input.handlers[part.lane]!;
    const result = model.handlers.find(item => item.input.id === handler.id);
    const open = !handler.enabled || (model.eligible && (part.gate === 0 ? step >= 1 && result!.channelMatches : step >= 2 && result!.channelMatches && result!.modeMatches));
    return {key: part.name, depth: depthOf([part.gate ? 7 : -78, REA_LANES[part.lane]!, open ? 39 : 17], REA_MACHINE_PROJECTION), art: <g key={part.name} className={styles.moving} style={motion(0, open ? 23 : 0)}><AnatomySolid name={part.name} paths={part.paths} lit={open && handler.enabled} /></g>};
  });
  const picture = [...staticParts, ...blades, ...tokenArt, {
    key: 'output-coupling-latch', depth: depthOf([124, 74, 5], REA_MACHINE_PROJECTION),
    art: <g key="output-coupling-latch" className={styles.moving} style={motion(step === 3 && model.status === 'paired' ? 10 : 0)}><AnatomySolid name="output-coupling-latch" paths={REA_LATCH} lit={step === 3 && model.status === 'paired'} /></g>,
  }].sort((a, b) => a.depth - b.depth);

  return <section ref={root} id={id} className={`${demoSurface.surface} ${frameStyles.surface} ${styles.root}`} data-book-island data-demo="rea-ipc-pairing-machine" data-hydrated={ready} data-step={step} data-pairing-status={model.status ?? 'excluded'} data-candidates={model.candidates.length} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <span className={styles.figureNumber}>ANATOMY · FIG. 01</span>
      <h3 id={`${uid}-title`}>同一个 Channel，为什么还不能连线？</h3>
      <p><code>ElectronBoundaryAnalysis</code> 将发送事实依次经过 Channel 与通信模式筛选；只有唯一候选才能成为直接配对边。</p>
    </header>

    <div className={styles.presets} aria-label="IPC 配对场景">
      {REA_IPC_PRESETS.map((preset, index) => <Button key={preset.id} size="sm" variant="outline" onPress={() => choose(index)} isDisabled={!ready} data-preset={preset.id}>{preset.label}</Button>)}
    </div>

    <div className={styles.inputControls}>
      <TextField className={styles.channelField} value={input.channel} onChange={channel => update({channel})} isDisabled={!ready}>
        <Label>发送 Channel（逐字符比较）</Label><Input maxLength={50} placeholder="空字符串也是字面量" data-channel-input />
      </TextField>
      <div className={styles.operationControl}>
        <span className={styles.controlLabel}>ipcRenderer 操作</span>
        <div className={styles.buttonGroup}>
          {(['invoke', 'send', 'sendSync', 'sendToHost'] as TransmissionOperation[]).map(operation => <Button key={operation} size="sm" variant={input.operation === operation ? 'secondary' : 'ghost'} aria-pressed={input.operation === operation} onPress={() => update({operation})} isDisabled={!ready}>{operation}</Button>)}
        </div>
      </div>
    </div>
    <Button className={styles.dynamicButton} size="sm" variant="ghost" aria-pressed={input.dynamic} onPress={() => update({dynamic: !input.dynamic})} isDisabled={!ready}>Channel 写法：{input.dynamic ? '变量 CHANNEL（dynamic）' : '直接字符串（literal）'}</Button>

    <div className={styles.inputSources}>
      <div className={styles.sourceCell}><strong>renderer.js · 输入片段</strong><pre><code>{model.rendererSource}</code></pre></div>
      <div className={styles.sourceCell}><strong>main.js · 输入片段</strong><pre><code>{model.mainSource}</code></pre></div>
    </div>
    <p className={styles.facts} data-transmission-fact>提取的 transmission：<code>side: renderer</code><code>operation: {model.transmission.operation}</code><code>mode: {model.transmission.mode}</code><code>channel: {JSON.stringify(model.transmission.channel)}</code></p>

    <div className={styles.plate}>
      <div className={styles.plateTop}><strong>两道筛选闸 · 一个候选出口</strong><span>{steps[step]}</span></div>
      <svg viewBox={`0 0 ${REA_MACHINE_WIDTH} ${REA_MACHINE_HEIGHT}`} className={styles.machine} role="img" aria-labelledby={`${uid}-drawing-title ${uid}-drawing-desc`}>
        <title id={`${uid}-drawing-title`}>静态 IPC 候选分拣台</title>
        <desc id={`${uid}-drawing-desc`}>三条导轨分别代表 H1、H2、H3。第一道闸检查精确 Channel，第二道闸检查 mode。通过的筹码向右移动，落入候选出口。{stepDescription}这是解释算法的教学装置，REA 不包含机械分拣系统。</desc>
        <path className={styles.shadow} d={REA_MACHINE_SHADOW} />
        {baseParts}
        {picture.map(item => item.art)}
        <g className={styles.tally}>{REA_TALLY_MARKS.map((d, index) => <path key={d} d={d} data-filled={step >= 2 && index < model.candidates.length} />)}</g>
        {REA_GATE_MARKERS.map(([cx, cy], index) => <g key={index} className={styles.marker}><circle cx={cx} cy={cy} r="8" /><text x={cx} y={cy + 3} textAnchor="middle">{index + 1}</text></g>)}
      </svg>
      <div className={styles.legend}><span><b>①</b> Channel 相等才抬闸</span><span><b>②</b> mode 兼容才抬闸</span><span><b>③</b> 筹码数量决定是否扣合连杆</span></div>
      <div className={styles.stepButtons} aria-label="查看算法步骤">
        {steps.map((label, index) => <Button key={label} size="sm" variant={step === index ? 'secondary' : 'ghost'} aria-pressed={step === index} onPress={() => {stop(); setStep(index);}} isDisabled={!ready}>{index + 1}. {label}</Button>)}
      </div>
      <div className={styles.playback}>
        <Button size="sm" variant="outline" onPress={() => {stop(); setStep(0); if (!reduced) setPlaying(true);}} isDisabled={!ready} data-replay>从头{reduced ? '查看' : '回放'}</Button>
        <Button size="sm" variant="ghost" onPress={() => {stop(); setStep(value => Math.min(3, value + 1));}} isDisabled={!ready || step === 3} data-next>下一步</Button>
        {playing && <Button size="sm" variant="ghost" onPress={stop}>暂停</Button>}
        <span className={styles.liveCount} data-readout>{step === 3 ? `${status} · 直接配对边 ${model.directEdges.length}` : `步骤 ${step + 1}/4 · ${step === 0 ? '尚未筛选' : step === 1 ? `Channel 通过 ${model.channelCount}` : `候选 ${model.candidates.length}`}`}</span>
      </div>
    </div>

    <div className={styles.filterTable} role="group" aria-label="每个 handler 的筛选依据">
      <div className={styles.filterHeader}><span>main handler</span><span>① Channel</span><span>② mode</span><span>候选</span></div>
      {input.handlers.map((handler, lane) => {
        const result = model.handlers.find(item => item.input.id === handler.id);
        return <div key={handler.id} className={styles.filterRow} data-handler-row={handler.id} data-enabled={handler.enabled}>
          <span className={styles.handlerIdentity}><b>{handler.id}</b><code>{handler.operation}</code><small>{JSON.stringify(handler.channel)}</small></span>
          <span>{!handler.enabled ? '已移除' : step < 1 ? '待检查' : !model.eligible ? '不进入' : result!.channelMatches ? '相等 ✓' : input.dynamic ? 'dynamic ×' : '不同 ×'}</span>
          <span>{!handler.enabled ? '—' : step < 2 ? '待检查' : !model.eligible || !result!.channelMatches ? '跳过' : result!.modeMatches ? `${result!.finding.mode} ✓` : `${result!.finding.mode} ×`}</span>
          <span>{handler.enabled && step >= 2 && result!.candidate ? '✓' : '—'}</span>
          <Button size="sm" variant="ghost" onPress={() => update({handlers: input.handlers.map((item, i) => i === lane ? {...item, enabled: !item.enabled} : item)})} isDisabled={!ready} aria-label={`${handler.enabled ? '移除' : '恢复'} ${handler.id}`} className={styles.handlerToggle}>{handler.enabled ? '移除' : '恢复'}</Button>
        </div>;
      })}
    </div>
    <p className={styles.status} role="status" aria-live={playing ? 'off' : 'polite'}>{stepDescription}</p>

    <div className={styles.graph} data-static-graph>
      <div className={styles.graphTitle}><strong>Graph 投影</strong><code>pair-ipc-literal-channel</code></div>
      <div className={styles.graphConnection} data-direct-edge={step === 3 && model.directEdges.length === 1}>
        <span>renderer.js</span><span className={styles.graphLink}>{step === 3 && model.directEdges.length === 1 ? <><small>{model.directEdges[0]!.relation}</small><i aria-hidden="true">⟶</i></> : <small>{step < 3 ? '等待候选计数' : '无直接配对边'}</small>}</span><span>{step === 3 && model.pairedHandler ? `${model.pairedHandler.input.id} · main handler` : 'main handler'}</span>
      </div>
      <p>此处只展示发送者到 handler 的直接配对边。{input.dynamic ? '动态 Channel 节点与发送事实仍在原 Graph 中。' : 'Channel 节点、发送事实、handler 注册事实不依赖这条配对边。'}</p>
    </div>
    <details className={styles.sourceDetails}><summary>模型如何对应固定源码</summary><p><a href={`${source}ElectronBoundaryAnalysis.ts#L44-L81`}>classifyElectronIpcPairings / unambiguousElectronIpcPairings</a> 决定候选集合；<a href={`${source}ElectronBoundaryAnalysis.ts#L179-L199`}>compatibleIpcModes 与输入过滤</a> 决定配对范围；<a href={`${source}ElectronBoundaryGraphIpc.ts#L215-L246`}>addLiteralPairings</a> 只为唯一候选增加静态推断边。</p><p><code>sendSync</code> 与 <code>send</code> 的 mode 都是 <code>send</code>，对应 <code>ipcMain.on/once</code> 的 <code>listen</code>；<code>handle/handleOnce</code> 的 mode 都是 <code>handle</code>。动态发送会出现 <code>unpaired</code> 状态，但不会增加 <code>unpaired_literal_renderer_transmissions</code>；<code>sendToHost</code> 则完全排除在配对分类外。</p></details>
    <p className={styles.boundary}>教学模型，核对版本 <code>{REA_IPC_REVISION.slice(0, 7)}</code>。输入片段随控件生成，浏览器中不运行 REA、Babel 或 Electron。分拣台与连杆用于解释筛选与静态 Graph 投影；唯一字面量匹配不能证明 handler 已注册、运行时可达或已经完成通信。</p>
  </section>;
}
