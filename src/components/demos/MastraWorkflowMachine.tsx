import {Fragment, useEffect, useId, useReducer, useState} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {AnatomyLine, AnatomySolid} from './AnatomyArt';
import {DECISION_MATRIX, HEIGHT, PARTS, SHADOW, SNAPSHOT_MATRIX, TICKETS, WIDTH} from './mastra-workflow-geometry';
import {APPROVAL_THRESHOLD, initialWorkflowState, MAX_AMOUNT, MIN_AMOUNT, workflowReadout, workflowReducer} from './mastra-workflow-model';
import demoSurface from './DemoSurface.module.css';
import frameStyles from './AnatomyFrame.module.css';
import styles from './MastraWorkflowMachine.module.css';

const physicalParts = PARTS.map(part => <g key={part.name}>
  <AnatomySolid name={part.name} paths={part.paths} tone={part.tone} />
  {part.line && <AnatomyLine d={part.line} />}
</g>);

/** Printed fields are drawn on the paper plane, not floating annotation boxes. */
function TicketInk({amount, decision, complete = false, blank = false}: {amount: number; decision?: string; complete?: boolean; blank?: boolean}) {
  return <g className={styles.ticketInk} opacity={blank ? 0.22 : 1}>
    <text x="7" y="10" className={styles.paperLabel}>AMOUNT</text>
    <text x="7" y="24" className={styles.paperNumber}>{amount}</text>
    <rect x="7" y="28" width="59" height="3" rx="0.5" className={styles.paperTrack} />
    <rect data-amount-strip x="7" y="28" width={59 * amount / MAX_AMOUNT} height="3" rx="0.5" className={styles.amountInk} />
    <text x="7" y="44" className={styles.paperDecision}>{decision ?? (complete ? 'SAVED' : 'PENDING')}</text>
  </g>;
}

export default function MastraWorkflowMachine({id = 'mastra-workflow-machine'}: {id?: string}) {
  const uid = useId();
  const [ready, setReady] = useState(false);
  const [state, dispatch] = useReducer(workflowReducer, undefined, () => initialWorkflowState());
  const readout = workflowReadout(state);
  useEffect(() => setReady(true), []);
  const paused = state.status === 'suspended';
  const done = state.status === 'success';
  const approval = state.snapshot?.context.approval;
  const decision = readout.resumeData ? String(readout.resumeData.approved) : readout.output?.decision === 'automatic' ? 'AUTO' : '—';
  const receiptDecision = readout.receipt?.decision === 'approved' ? 'APPROVED' : readout.receipt?.decision === 'rejected' ? 'REJECTED' : readout.receipt ? 'AUTO' : undefined;

  return <section id={id} className={`${demoSurface.surface} ${frameStyles.surface} ${styles.root}`} data-book-island data-demo="mastra-workflow-machine" data-hydrated={ready} data-workflow-status={state.status} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <span className={styles.eyebrow}>ANATOMY · FIG. 01</span>
      <h3 id={`${uid}-title`}>暂停留下输入，恢复补上决定</h3>
      <p>票据上的金额来自保存的 <code>payload</code>；冲印台只补入新的 <code>approved</code>，然后交给 <code>receipt</code>。</p>
    </header>

    <div className={styles.controls}>
      <Slider minValue={MIN_AMOUNT} maxValue={MAX_AMOUNT} step={10} value={state.draftAmount} onChange={value => dispatch({type: 'amount', amount: Array.isArray(value) ? value[0]! : value})} isDisabled={!ready}>
        <Label>待提交金额 amount</Label><Slider.Output /><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
      </Slider>
      <div className={styles.actions}>
        <Button size="sm" variant="primary" isDisabled={!ready || state.status !== 'ready'} onPress={() => dispatch({type: 'start'})}>运行 Workflow</Button>
        <Button size="sm" variant="outline" isDisabled={!ready} onPress={() => dispatch({type: 'reset'})}>重置为新运行</Button>
      </div>
      <p className={styles.controlHint}>阈值 <code>amount &gt; {APPROVAL_THRESHOLD}</code>。先运行 180，暂停后把待提交金额改为 60，再选择恢复。</p>
    </div>

    <div className={styles.machineCard}>
      <div className={styles.figureCorners}><span>保存的金额 ≠ 待提交的金额</span><strong data-status-readout>{readout.statusLabel}</strong></div>
      <svg className={styles.machine} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`${uid}-art-title ${uid}-art-desc`}>
        <title id={`${uid}-art-title`}>工作流票据冲印台</title>
        <desc id={`${uid}-art-desc`}>左侧票据金额 {readout.displayedAmount}，中间冲印台接收 approved={decision}，右侧{readout.receipt ? `生成金额 ${readout.receipt.amount}、结果 ${readout.receipt.decision} 的票据` : '等待生成 receipt'}。前方抽屉{readout.savedAmount === null ? '还没有 snapshot' : `保存原金额 ${readout.savedAmount}`}。上方滑块当前为 {state.draftAmount}，不改变已保存的金额。</desc>
        <path className={styles.shadow} d={SHADOW} />
        {PARTS.map((part, index) => <Fragment key={part.name}>
          {physicalParts[index]}
          {part.name === TICKETS.input.name && <g transform={TICKETS.input.matrix}><TicketInk amount={readout.displayedAmount} decision={readout.frozen ? 'PAYLOAD' : 'DRAFT'} complete={readout.frozen} /></g>}
          {part.name === TICKETS.approval.name && <g transform={TICKETS.approval.matrix} data-approval-ticket><TicketInk amount={readout.displayedAmount} decision={readout.output ? `BOOL ${readout.resumeData ? String(readout.resumeData.approved).toUpperCase() : 'AUTO'}` : 'BOOL ?'} blank={!readout.frozen} /></g>}
          {part.name === TICKETS.receipt.name && <g transform={TICKETS.receipt.matrix} data-receipt-ticket><TicketInk amount={readout.receipt?.amount ?? readout.displayedAmount} decision={receiptDecision} complete={done} blank={!done} /></g>}
          {part.name === 'snapshot-ticket' && <g transform={SNAPSHOT_MATRIX} className={styles.ticketInk} opacity={readout.frozen ? 1 : 0.22}><text x="5" y="8" className={styles.paperLabel}>SNAPSHOT · PAYLOAD</text><text x="5" y="16" className={styles.drawerNumber}>{readout.savedAmount === null ? '—' : `amount: ${readout.savedAmount}`}</text></g>}
          {part.name === 'decision-cartridge' && <g transform={DECISION_MATRIX} className={styles.ticketInk}><text x="21" y="10" textAnchor="middle" className={styles.cartridgeNumber} data-bool-die>{decision}</text></g>}
        </Fragment>)}
      </svg>
      <div className={styles.figureCorners}><span>normalize → approval → receipt</span><span data-counts>execute 次数：{state.counts.normalize} → {state.counts.approval} → {state.counts.receipt}</span></div>
    </div>

    <div className={styles.resumeControls}>
      <div><strong>恢复时传入 resumeData</strong><p>点击一个决定，继续当前保存的运行。</p></div>
      <div className={styles.actions}>
        <Button size="sm" variant="secondary" isDisabled={!ready || !paused} onPress={() => dispatch({type: 'resume', approved: true})}>批准 · true</Button>
        <Button size="sm" variant="outline" isDisabled={!ready || !paused} onPress={() => dispatch({type: 'resume', approved: false})}>拒绝 · false</Button>
      </div>
    </div>
    <p className={styles.status} role="status" aria-live="polite">{readout.explanation}</p>
    {readout.draftDiffers && <p className={styles.frozenNote} data-frozen-comparison>待提交 <strong>{state.draftAmount}</strong>；当前运行已保存 <strong>{readout.savedAmount}</strong>。先重置再运行，才会使用新金额。</p>}

    <div className={styles.dataGrid}>
      <div className={styles.dataCell}>
        <span className={styles.fieldOrigin}>① 原运行输入 · 保存在 snapshot</span>
        <strong>approval.payload</strong>
        <pre data-saved-payload>{JSON.stringify(approval?.payload ?? null, null, 2)}</pre>
        <small>normalize：{state.counts.normalize} 次 · {state.snapshot ? '已完成，不重跑' : '等待运行'}</small>
      </div>
      <div className={styles.dataCell}>
        <span className={styles.fieldOrigin}>② 外部新输入 · 只送给 approval</span>
        <strong>resumeData</strong>
        <pre data-resume-data>{JSON.stringify(readout.resumeData, null, 2)}</pre>
        <small>approval：{state.counts.approval} 次 · {paused ? '暂停，等待重新执行' : done ? '已完成' : '等待运行'}</small>
      </div>
      <div className={`${styles.dataCell} ${done ? styles.completed : ''}`}>
        <span className={styles.fieldOrigin}>③ 组合字段 · 传向下游 receipt</span>
        <strong>approval.output</strong>
        <pre data-approval-output>{JSON.stringify(readout.output, null, 2)}</pre>
        <small>receipt：{state.counts.receipt} 次 · {readout.receipt ? <code>{readout.receipt.receipt}</code> : '尚未执行'}</small>
      </div>
    </div>
    <details className={styles.snapshot}>
      <summary>展开 snapshot 的教学摘录</summary>
      <p>仅保留本图解释所需的步骤字段；这不是 Mastra 完整的存储记录。</p>
      <pre data-snapshot>{JSON.stringify(state.snapshot, null, 2)}</pre>
    </details>
    <p className={styles.boundary}>教学模型，在浏览器本地计算，不调用 Mastra、LLM 或数据库。暂停条件检查 <code>resumeData === undefined</code>，所以传入 <code>{'{approved: false}'}</code> 后也会完成；业务结果是 <code>rejected</code>，Workflow 状态仍为 <code>success</code>。没有自动重放。</p>
  </section>;
}
