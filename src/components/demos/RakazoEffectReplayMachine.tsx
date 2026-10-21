import {useEffect, useId, useState} from 'react';
import {Button} from '@heroui/react';
import {MechanismPlayer} from './MechanismPlayer';
import {drawReplayMotion, ReplayMotionDrawing} from './rakazo-replay-motion';
import {EFFECT_STATUSES, effectReplayView, PROPOSAL_RECIPIENTS, SAVED_REQUEST, SAVED_RESULT} from './rakazo-effect-model';
import type {EffectStatus, MailRequest} from './rakazo-effect-model';
import demoSurface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './RakazoEffectReplayMachine.module.css';

const REQUEST_FIELDS = ['to', 'subject', 'body'] as const satisfies readonly (keyof MailRequest)[];
const BRANCHES: Record<EffectStatus, string> = {
  approved: '读取保存的 request；原子认领成功后执行', completed: '直接返回保存的 result',
  denied: '返回拒绝信息', intended: '返回 paused，继续等待批准',
  executing: '保存 uncertain 结果，核验外部目标', uncertain: '直接返回已有 uncertain 结果',
};

/** The read copy travels continuously from a retained original into its actual branch. */
export default function RakazoEffectReplayMachine({id = 'rakazo-effect-replay-machine'}: {id?: string}) {
  const uid = useId();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<EffectStatus>('approved');
  const [proposedTo, setProposedTo] = useState<string>(PROPOSAL_RECIPIENTS[0]);
  const view = effectReplayView(status, proposedTo);
  const arrivalValue = status === 'approved' ? `request.to → ${SAVED_REQUEST.to}` : status === 'completed' ? `result.messageId → ${SAVED_RESULT.messageId}` : status === 'executing' || status === 'uncertain' ? 'result.uncertain → true' : status === 'denied' ? 'error → denied' : 'paused → true';
  useEffect(() => setReady(true), []);
  const moving = status === 'approved' || status === 'completed' || status === 'executing' || status === 'uncertain';
  const phases = [
    {at: 0, label: '原始请求与成功回执分别留存在左侧档案读台。前方轨道上的新提议与它们分离。'},
    {at: .05, label: '模型新提议走向自己的限位，不能替换已经保存的获批请求。'},
    {at: .20, label: status === 'completed' ? '扫描保存的回执，读取它的工作副本；原回执仍留在档案中。' : status === 'approved' ? '读取已保存请求，工作副本保留同一身份；原始档案始终留存。' : moving ? '读取未确认的执行状态，生成待核验标记；请求本身仍留在档案中。' : '这个状态没有执行资格。原请求保持封存，取件夹不会把它送往工具。'},
    {at: .46, label: status === 'approved' ? '夹具运输完整的存档请求副本，新提议留在独立轨道。' : status === 'completed' ? '小回执沿返回路线前进；请求执行托座保持关闭。' : moving ? '不确定结果标记进入前方待核验托座，执行托座保持关闭。' : '保持暂停或直接返回拒绝；没有请求副本经过执行入口。'},
    {at: .80, label: status === 'approved' ? '只有认领成功的教学情景才把保存的参数放入执行托座；网页不调用邮件工具。' : status === 'completed' ? '保存的回执落入返回槽，不会第二次发送请求。' : moving ? '先核验外部目标，不能把“不知道是否成功”当成可以重试。' : '这条恢复分支不会调用工具。'},
    {at: .90, label: `${view.label}。原档案保持原位，工作头空载回位；输出副本留在对应托座。`},
  ];

  function compare(next: EffectStatus) {setStatus(next);setProposedTo(PROPOSAL_RECIPIENTS[0]);}

  return <section id={id} data-book-island data-demo="rakazo-effect-replay" data-effect-status={status}
    data-hydrated={ready} className={`${demoSurface.surface} ${frame.surface} ${styles.root}`} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <p className={styles.eyebrow}>Rakazo / 动态请求回放</p>
      <h3 id={`${uid}-title`}>恢复时，哪一份请求真正进入执行？</h3>
      <p>观察扫描头从哪份档案生成工作副本，再沿着同一个副本看它抵达哪里。切换状态，比较取回请求、返回回执和停止重放的不同路线。</p>
    </header>
    <fieldset className={styles.controls} disabled={!ready}>
      <legend>改变恢复条件，重放一次</legend>
      <div className={styles.radios} role="group" aria-label="已保存的 effect.status">{EFFECT_STATUSES.map(value => <label key={value}>
        <input type="radio" name={`${uid}-status`} value={value} checked={status === value} onChange={() => setStatus(value)} /><code>{value}</code>
      </label>)}</div>
      <div className={styles.conditions}>
        <label className={styles.selectLabel} htmlFor={`${uid}-proposal`}>新提议的 request.to
          <select id={`${uid}-proposal`} data-control="proposal" value={proposedTo} onChange={event => setProposedTo(event.target.value)}>{PROPOSAL_RECIPIENTS.map(value => <option key={value} value={value}>{value}</option>)}</select>
        </label>
        <p className={styles.original}>存档 request.to 始终为<br /><strong>{SAVED_REQUEST.to}</strong></p>
      </div>
      <div className={styles.presets}>{(['approved', 'completed', 'executing'] as const).map(value => <Button key={value} size="sm" variant="outline" isDisabled={!ready} data-scenario={value} onPress={() => compare(value)}>
        {{approved: '批准后改收件人', completed: '已有成功回执', executing: '执行中发生中断'}[value]}
      </Button>)}</div>
    </fieldset>

    <MechanismPlayer label="Rakazo 请求回放机" duration={14} resetKey={`${status}:${proposedTo}`} phases={phases} onFrame={(stage, p) => drawReplayMotion(stage, p, status)}>
      <ReplayMotionDrawing uid={uid} changed={view.changed} />
      <div className={styles.arrival} data-arrival-readout data-arrived="false" style={{opacity: 0}}>
        <strong data-readout>{view.label}</strong>
        <span data-tool-calls>{view.toolCalls ? '认领成功后可调用工具 1 次；此网页实际调用 0 次。' : '此恢复分支调用工具 0 次。'}</span>
        <code>{arrivalValue}</code>
      </div>
    </MechanismPlayer>
    <div className={styles.legend} aria-label="装置与实际对象的对应">
      <span><i className={styles.requestMark} />三条纹匣 · 完整请求</span><span><i className={styles.receiptMark} />短纸片 · 保存回执</span><span><i className={styles.reviewMark} />交叉标记 · 待核验结果</span>
    </div>
    <p className={styles.note}>左后为回执读台，左中为请求读台，左前为新提议轨道；右侧依次对应返回、执行和待核验托座。扫描表示读取并生成工作副本，原始数据不会被搬空。</p>

    <details className={styles.raw}><summary>核对请求字段与恢复分支</summary>
      <p className={styles.note}>下面是所选条件的模型预期结果；动画中的主读数要等工作副本抵达后才出现。</p>
      <div className={styles.tableWrap}><table className={styles.fields}>
        <thead><tr><th scope="col">字段</th><th scope="col">保存的 request</th><th scope="col">模型新提议</th><th scope="col">认领成功后的执行参数</th></tr></thead>
        <tbody>{REQUEST_FIELDS.map(field => <tr key={field} data-request-field={field}>
          <th scope="row"><code>{field}</code></th><td><code>{SAVED_REQUEST[field]}</code></td>
          <td data-different={view.proposedRequest[field] !== SAVED_REQUEST[field]}><code>{view.proposedRequest[field]}</code>{view.proposedRequest[field] !== SAVED_REQUEST[field] && <small>未采用</small>}</td>
          <td data-effective-field={field}>{view.executionPayload ? <><code>{view.executionPayload[field]}</code><small>来自存档</small></> : '无执行参数'}</td>
        </tr>)}</tbody>
      </table></div>
      <dl className={styles.branches}>{EFFECT_STATUSES.map(value => <div key={value} data-active={status === value}><dt><code>{value}</code></dt><dd>{BRANCHES[value]}</dd></div>)}</dl>
      <p className={styles.note}>当前决策：<code data-gate-action>{view.gate.action}</code>。状态切换是在比较条件，不表示数据库已经发生这些操作。</p>
      <pre data-replay-output>{JSON.stringify(view.executionPayload ?? view.returnedResult ?? {paused: true}, null, 2)}</pre>
      <div className={styles.dataGrid}><div><p>effect.request · 原记录</p><pre data-saved-request>{JSON.stringify(SAVED_REQUEST, null, 2)}</pre></div><div><p>模型新提议</p><pre data-proposed-request>{JSON.stringify(view.proposedRequest, null, 2)}</pre></div></div>
      {status === 'completed' && <p className={styles.note}>返回的是已有回执 <code>{SAVED_RESULT.messageId}</code>，不会再次发送。</p>}
    </details>
    <p className={styles.boundary}>浏览器教学模型，不运行 Rakazo、Agent 或邮件工具。前提是已匹配同一 effect、工具路由校验通过；approved 的执行路线仍以原子认领成功为条件。装置未模拟认领竞争，盖板开启只标出此前提下的路线。这里只展示普通直接工具分支，省略 catalog 参数封装、并发 Worker 与媒体任务。重复的 intended 返回 paused；新建操作可能走自动审批或直接执行路径。装置运动是教学慢放，不表示实际运行时长。</p>
    <noscript><p className={styles.note}>初始条件为 approved：认领成功后仍执行保存的 team@example.test 请求，新提议 other@example.test 不会覆盖它。completed 返回 mail-42 旧回执；executing 转入 uncertain，不自动重放。</p></noscript>
  </section>;
}
