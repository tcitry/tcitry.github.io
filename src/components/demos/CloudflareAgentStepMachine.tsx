import {useEffect, useId, useMemo, useState} from 'react';
import {Button} from '@heroui/react';
import {AnatomyLine, AnatomySolid} from './AnatomyArt';
import {
  AGENT_STEP_HALO, AGENT_STEP_HEIGHT, AGENT_STEP_PART_COUNT, AGENT_STEP_WIDTH,
  agentStepPartOrder, type AgentStepPart,
} from './cloudflare-agent-step-geometry';
import {
  AGENT_STEP_PHASES, AGENT_STEP_SOURCE, agentStepView, INITIAL_AGENT_STEP,
  resetAgentStep, restartAgentStep, selectAgentStepPhase, type AgentStepInput, type AgentStepView,
} from './cloudflare-agent-step-model';
import demoSurface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './CloudflareAgentStepMachine.module.css';

function visiblePart(part: AgentStepPart, state: AgentStepView) {
  if (part.family.startsWith('memory-')) return state.memoryStep;
  if (part.family.startsWith('durable-')) return state.durableStep;
  if (part.family === 'effect-receipt') return state.applicationCount > 0;
  return true;
}

function PaperInk({part, state}: {part: AgentStepPart; state: AgentStepView}) {
  const print = part.print!;
  if (print.field === 'label') return <text x="0" y="6" fontSize="6.2" letterSpacing="0.25">{print.text}</text>;
  if (print.field === 'count') return <text x="30.5" y="11" textAnchor="middle" fontSize="11">{String(state.applicationCount).padStart(3, '0')}</text>;
  const lines = print.field === 'transcript' ? state.memoryPrint : print.field === 'change' ? state.changePrint : state.effectPrint;
  if (print.field === 'effect') return <>{lines.map((line, index) => <text key={index} x="4" y={11 + index * 11} fontSize="7.8">{line}</text>)}</>;
  return <>
    <text x="5" y="11" fontSize="6.2" className={styles.paperHeading}>{print.field === 'transcript' ? 'MODEL + TOOLS' : 'CodeChange'}</text>
    {lines.map((line, index) => <text key={index} x="5" y={28 + index * 14} fontSize="8.7">{line}</text>)}
  </>;
}

/** The apparatus models a crash boundary, never a live Cloudflare OS execution. */
export default function CloudflareAgentStepMachine() {
  const id = useId();
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState<AgentStepInput>(() => ({...INITIAL_AGENT_STEP}));
  useEffect(() => setHydrated(true), []);
  const state = useMemo(() => agentStepView(input), [input]);
  const parts = useMemo(() => agentStepPartOrder(state.stampDown), [state.stampDown]);

  return <section id="cloudflare-agent-step-machine" data-demo="cloudflare-agent-step-machine" data-book-island
    data-hydrated={hydrated} data-phase={state.phase} data-restarted={state.restarted}
    data-memory-step={state.memoryStep ? 1 : 0} data-durable-step={state.durableStep ? 1 : 0}
    data-application-count={state.applicationCount} data-replay-tool-calls={state.replayToolCalls}
    className={`${demoSurface.surface} ${frame.surface} ${styles.demo}`} aria-labelledby={`${id}-heading`}>
    <p className={frame.eyebrow}>Anatomy / tool result → commitAgentStep → recovery</p>
    <h3 id={`${id}-heading`} className={frame.heading}>工具已经生效，本 step 就能在重启后保留吗？</h3>
    <p className={frame.note}>同一步先调用 <code>executeCode</code>，让已有 Gadget 的 <code>increment()</code> 把计数写成 1；再调用 <code>editFile</code>，将 <code>server.js</code> 的默认 priority 从 normal 改为 high。选择崩溃切点，观察两条账纸与独立计数匣。</p>

    <fieldset className={styles.controls} disabled={!hydrated}>
      <legend>让 DO 在哪里崩溃？</legend>
      <div className={styles.phases} role="radiogroup" aria-label="选择 DO 崩溃切点">
        {AGENT_STEP_PHASES.map(phase => <label key={phase.value}>
          <input type="radio" name={`${id}-phase`} value={phase.value} checked={input.phase === phase.value}
            onChange={() => setInput(selectAgentStepPhase(phase.value))} />{phase.label}
        </label>)}
      </div>
      <div className={styles.actions}>
        <Button size="sm" variant="secondary" isDisabled={!hydrated || state.restarted}
          onPress={() => setInput(current => restartAgentStep(current))}>模拟 DO 重启</Button>
        <Button size="sm" variant="ghost" isDisabled={!hydrated} onPress={() => setInput(resetAgentStep())}>恢复初始示例</Button>
      </div>
    </fieldset>

    <div className={frame.card}>
      <div className={frame.corners}><span>Fig 02 · 双联过账压印机</span><strong data-readout>{state.readout}</strong></div>
      <div className={styles.viewport} tabIndex={0} role="region" aria-label="Agent step 压印机，可横向滚动查看账纸">
        <svg className={`${frame.figure} ${styles.figure}`} viewBox={`0 0 ${AGENT_STEP_WIDTH} ${AGENT_STEP_HEIGHT}`}
          role="img" aria-labelledby={`${id}-svg-title ${id}-svg-description`} data-anatomy-parts={AGENT_STEP_PART_COUNT}>
          <title id={`${id}-svg-title`}>工具结果与代码提案同时过账，应用写入另行保存</title>
          <desc id={`${id}-svg-description`}>{state.svgDescription}</desc>
          <defs>{parts.filter(part => part.print).map(part => <clipPath key={part.name} id={`${id}-print-${part.name}`}>
            <rect width={part.print!.width} height={part.print!.height} />
          </clipPath>)}</defs>
          <path d={AGENT_STEP_HALO} className={styles.halo} />
          {parts.filter(part => visiblePart(part, state)).map(part => <g key={part.name} data-part={part.name} data-family={part.family}>
            <AnatomySolid paths={part.paths} tone={part.tone} name={part.name} lit={part.name === 'press.head'} />
            {part.lines.map((line, index) => <AnatomyLine key={index} {...line} />)}
            {part.print && <g className={part.print.field === 'label' ? styles.engraving : styles.ink}
              transform={part.print.transform} clipPath={`url(#${id}-print-${part.name})`} data-print={part.name}>
              <PaperInk part={part} state={state} />
            </g>}
          </g>)}
        </svg>
      </div>
      <div className={frame.corners}><span>上方待提交暂存 → 同一提交屏障 → 下方持久账纸</span><span>右侧 APP STORAGE 独立保存 count</span></div>
    </div>
    <div className={frame.legend}><span>上方两张纸：待提交的工具结果、代码改动</span><span>下方两张纸：已提交的消息、代码提案</span><span>右侧计数匣：Gadget 应用存储</span></div>

    <p className={`${frame.note} ${styles.status}`} role="status" aria-live="polite" aria-atomic="true" data-machine-status>{state.explanation}</p>
    <dl className={styles.readouts}>
      <div><dt>本 step 的待提交暂存</dt><dd data-field="memory-step">{state.memoryStep ? '工具结果 + priority 改动' : '空'}</dd></div>
      <div><dt>本 step 的持久记录</dt><dd data-field="durable-step">{state.durableStep ? '工具结果 + 代码提案' : '无'}</dd></div>
      <div><dt>Gadget 应用 count</dt><dd data-field="application-count">{state.applicationCount}</dd></div>
      <div><dt>历史重放阶段调用工具</dt><dd data-field="replay-tool-calls">{state.replayToolCalls} 次</dd></div>
    </dl>
    <p className={styles.acceptance}>主线 priority = <code data-field="accepted-priority">{state.mainPriority}</code>；本 step 的提案 = <code data-field="proposal-priority">{state.proposalPriority ?? '无'}</code>。持久化提案后仍需要用户 Accept。</p>
    <details className={styles.records}>
      <summary>查看这一步保存了什么</summary>
      <div><span>待提交暂存</span><pre data-field="memory-record">{JSON.stringify({toolResults: state.memoryTranscript, codeChange: state.memoryChange}, null, 2)}</pre></div>
      <div><span>持久记录</span><pre data-field="durable-record">{JSON.stringify({toolResults: state.durableTranscript, codeChange: state.durableChange}, null, 2)}</pre></div>
    </details>
    <p className={frame.note}>前提：Gadget 已存在；目标文件在此前 step 中已读取，文件知识仍匹配。工具顺序也有约束：本例先 executeCode、后 editFile；已有未提交文件编辑时，executeCode 的保护检查会拒绝执行。图中只展示当前 step 的数据投影，不清除此前已保存的聊天历史。</p>
    <p className={frame.note}>这里模拟 DO 崩溃与重启，不模拟 Stop。完整模型响应进入工具阶段后，Stop 仍可能让已完成的效果经过提交屏障保存。重启则丢失内存，从持久日志重建执行状态；它不保存 JavaScript 栈，也不保证外部副作用只发生一次。图示停在历史重放完成处，恢复随后启动的新模型请求仍可能产生新工具调用。</p>
    <p className={frame.note}>这是浏览器内的教学模型，不运行 Agent、模型、Gadget 或真实存储。图只展示待提交数据与本 step 的持久记录；上方清空不代表模型上下文也清空。压印机表示同一个 step 的提交边界；右侧计数匣表示与该边界分离的应用写入。</p>
    <p className={frame.note}><a href={`${AGENT_STEP_SOURCE}/agent.ts#L4054-L4170`} target="_blank" rel="noopener noreferrer">turn_end 提交屏障</a> · <a href={`${AGENT_STEP_SOURCE}/overseer.ts#L2871-L2955`} target="_blank" rel="noopener noreferrer">commitAgentStep 事务</a> · <a href={`${AGENT_STEP_SOURCE}/agent.ts#L3808-L3830`} target="_blank" rel="noopener noreferrer">executeCode 的编辑保护</a></p>
    <noscript><p className={frame.note}>静态示例处于“两个工具完成，提交屏障前”：工具结果与代码改动还在内存，应用 count 已为 1。此时 DO 崩溃会丢失这一步的暂存，但 count 保持 1。启用 JavaScript 可比较三个崩溃切点。</p></noscript>
  </section>;
}
