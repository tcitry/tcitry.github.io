import {useEffect, useId, useReducer, useState} from 'react';
import {Button, Label, Slider} from '@heroui/react';
import {APPROVAL_THRESHOLD, initialWorkflowState, MAX_AMOUNT, MIN_AMOUNT, workflowReadout, workflowReducer} from './mastra-workflow-model';
import demoSurface from './DemoSurface.module.css';
import styles from './MastraWorkflowMachine.module.css';

export default function MastraWorkflowMachine({id = 'mastra-workflow-machine'}: {id?: string}) {
  const uid = useId();
  const [ready, setReady] = useState(false);
  const [state, dispatch] = useReducer(workflowReducer, undefined, () => initialWorkflowState());
  const readout = workflowReadout(state);
  useEffect(() => setReady(true), []);
  const paused = state.status === 'suspended';
  const done = state.status === 'success';
  const approval = state.snapshot?.context.approval;
  const hasResume = readout.resumeData !== null;
  const overThreshold = readout.savedAmount === null ? null : readout.savedAmount > APPROVAL_THRESHOLD;
  const decisionSource = !state.snapshot ? '等待运行' : paused ? '尚未返回 output' : hasResume ? `resumeData.approved = ${readout.resumeData!.approved}` : '未暂停，直接返回 automatic';

  return <section id={id} className={`${demoSurface.surface} ${styles.root}`} data-book-island data-demo="mastra-workflow-machine" data-hydrated={ready} data-workflow-status={state.status} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <span className={styles.eyebrow}>WORKFLOW · 字段来源实验</span>
      <h3 id={`${uid}-title`}>旧输入与新决定，怎样组成恢复结果</h3>
      <p>保存的 <code>payload.amount</code> 提供金额，恢复请求中的 <code>approved</code> 决定结果。下面把两份输入、分支条件和输出字段放在一起核对。</p>
    </header>

    <div className={styles.controls}>
      <Slider minValue={MIN_AMOUNT} maxValue={MAX_AMOUNT} step={10} value={state.draftAmount} onChange={value => dispatch({type: 'amount', amount: Array.isArray(value) ? value[0]! : value})} isDisabled={!ready}>
        <Label>待提交金额 amount</Label><Slider.Output /><Slider.Track><Slider.Fill /><Slider.Thumb /></Slider.Track>
      </Slider>
      <div className={styles.actions}>
        <Button size="sm" variant="primary" isDisabled={!ready || state.status !== 'ready'} onPress={() => dispatch({type: 'start'})}>运行 Workflow</Button>
        <Button size="sm" variant="outline" isDisabled={!ready} onPress={() => dispatch({type: 'reset'})}>重置为新运行</Button>
      </div>
      <p className={styles.note}>先运行 180，暂停后把待提交金额改为 60，再选择批准或拒绝。已有 Run 的输入保存在下方；重置后才能用新金额启动另一个 Run。</p>
    </div>

    <ol className={styles.execution} aria-label="各步骤执行次数" data-counts>
      <li><code>normalize</code><strong>{state.counts.normalize} 次</strong><span>{state.snapshot ? '已完成' : '尚未执行'}</span></li>
      <li><code>approval</code><strong>{state.counts.approval} 次</strong><span>{paused ? '暂停，等待恢复' : done ? '已完成' : '尚未执行'}</span></li>
      <li><code>receipt</code><strong>{state.counts.receipt} 次</strong><span>{readout.receipt ? '已完成' : '尚未执行'}</span></li>
    </ol>

    <div className={styles.sources}>
      <div className={`${styles.source} ${styles.savedSource}`}>
        <h4>① 保存的 Step 输入</h4>
        <code className={styles.path}>snapshot.context.approval.payload</code>
        <pre data-saved-payload>{JSON.stringify(approval?.payload ?? null, null, 2)}</pre>
        <p className={styles.note}>{state.snapshot ? <>重新进入 <code>approval.execute()</code> 时，这份对象成为 <code>inputData</code>。</> : <>运行后，<code>normalize.output</code> 成为这份输入。</>}</p>
        {readout.draftDiffers && <p className={styles.frozenNote} data-frozen-comparison>待提交 <strong>{state.draftAmount}</strong>；当前 Run 保存 <strong>{readout.savedAmount}</strong>。两者不同，恢复仍读取保存值。</p>}
      </div>
      <div className={`${styles.source} ${styles.resumeSource}`}>
        <h4>② 本次恢复请求</h4>
        <code className={styles.path}>resumeData</code>
        <pre data-resume-data>{hasResume ? JSON.stringify(readout.resumeData, null, 2) : 'undefined'}</pre>
        <div className={styles.actions}>
          <Button size="sm" variant="secondary" isDisabled={!ready || !paused} onPress={() => dispatch({type: 'resume', approved: true})}>批准 · true</Button>
          <Button size="sm" variant="outline" isDisabled={!ready || !paused} onPress={() => dispatch({type: 'resume', approved: false})}>拒绝 · false</Button>
        </div>
        <p className={styles.note}>{hasResume ? <>恢复数据已到达。<code>{String(readout.resumeData!.approved)}</code> 是决定的值，和缺少 <code>resumeData</code> 不同。</> : <>暂停后选择一个决定，传入 <code>{'{approved: true}'}</code> 或 <code>{'{approved: false}'}</code>。</>}</p>
      </div>
    </div>

    <div className={styles.condition} data-pause-condition>
      <h4>③ 重新执行 approval：先检查暂停条件</h4>
      <div className={styles.expression}>
        <span><code>inputData.amount &gt; {APPROVAL_THRESHOLD}</code><strong data-threshold-result>{overThreshold === null ? '—' : String(overThreshold)}</strong></span>
        <code className={styles.operator}>&amp;&amp;</code>
        <span><code>resumeData === undefined</code><strong data-resume-missing>{state.snapshot ? String(!hasResume) : '—'}</strong></span>
      </div>
      <p className={styles.note} data-condition-result>{!state.snapshot
        ? '尚未执行。两个条件同时为 true 时调用 suspend()，本次不产生 approval.output。'
        : paused
          ? 'true && true：调用 suspend()，保存输入并结束本次执行，等待外部决定。'
          : hasResume
            ? 'true && false：恢复数据已存在，继续构造 output。approved 为 false 也会走到这里。'
            : 'false && true：金额未超过阈值，直接构造 automatic 结果。'}</p>
    </div>

    <div className={styles.output}>
      <h4>④ 构造 output，再交给 receipt</h4>
      <dl className={styles.mapping}>
        <div><dt><code>output.amount</code></dt><dd><code className={styles.savedValue}>inputData.amount{readout.savedAmount === null ? '' : ` = ${readout.savedAmount}`}</code><span>从①原输入取值</span></dd></div>
        <div><dt><code>output.decision</code></dt><dd><code className={styles.resumeValue}>{decisionSource}</code><span>{hasResume ? `从②的布尔值选择 ${readout.resumeData!.approved ? 'approved' : 'rejected'}` : '无恢复数据且未暂停时为 automatic'}</span></dd></div>
      </dl>
      <pre data-approval-output>{readout.output ? <>{'{\n  "amount": '}<span className={styles.savedValue}>{readout.output.amount}</span>{',\n  "decision": "'}<span className={styles.resumeValue}>{readout.output.decision}</span>{'"\n}'}</> : '尚无 output'}</pre>
      {readout.receipt ? <div className={styles.receipt} data-receipt-construction>
        <span><code>receipt</code> 组合两个输出字段：</span>
        <div><code className={styles.resumeValue}>{readout.receipt.decision}</code><span> + </span><code>":"</code><span> + </span><code className={styles.savedValue}>{readout.receipt.amount.toFixed(2)}</code></div>
        <output data-receipt>{readout.receipt.receipt}</output>
      </div> : <p className={styles.note}>只有 <code>approval</code> 返回 output，才执行 <code>receipt</code>；金额用 <code>toFixed(2)</code> 格式化。</p>}
    </div>

    <div className={styles.status} role="status" aria-live="polite">
      <strong data-status-readout>{readout.statusLabel}</strong><p>{readout.explanation}</p>
    </div>
    <details className={styles.snapshot}>
      <summary>展开 Snapshot 的教学摘录</summary>
      <p className={styles.note}>这里只保留本实验所需的步骤字段；这不是 Mastra 完整的存储记录。</p>
      <pre data-snapshot>{JSON.stringify(state.snapshot, null, 2)}</pre>
    </details>
    <p className={styles.note}>浏览器中的确定性教学模型，不调用 Mastra、LLM 或数据库。阈值和业务规则由本文设定；恢复输入的来源依据固定版本源码。业务结果 <code>rejected</code> 表示流程完成并拒绝请求，Workflow 状态仍为 <code>success</code>。</p>
  </section>;
}
