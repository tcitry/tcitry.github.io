import {useEffect, useId, useState} from 'react';
import {Button} from '@heroui/react';
import {EFFECT_STATUSES, effectReplayView, PROPOSAL_RECIPIENTS, SAVED_REQUEST, SAVED_RESULT} from './rakazo-effect-model';
import type {EffectStatus, MailRequest} from './rakazo-effect-model';
import demoSurface from './DemoSurface.module.css';
import styles from './RakazoEffectReplayMachine.module.css';

const REQUEST_FIELDS = ['to', 'subject', 'body'] as const satisfies readonly (keyof MailRequest)[];
const BRANCHES: Record<EffectStatus, string> = {
  approved: '取回保存的 request；原子认领成功后执行',
  completed: '直接返回保存的 result',
  denied: '返回拒绝信息',
  intended: '返回 paused，继续等待批准',
  executing: '保存 uncertain 结果，核验外部目标',
  uncertain: '直接返回已有 uncertain 结果',
};

/** Field sources for an already matched effect and a plain direct-tool request. */
export default function RakazoEffectReplayMachine({id = 'rakazo-effect-replay-machine'}: {id?: string}) {
  const uid = useId();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<EffectStatus>('approved');
  const [proposedTo, setProposedTo] = useState<string>(PROPOSAL_RECIPIENTS[0]);
  const view = effectReplayView(status, proposedTo);
  useEffect(() => setReady(true), []);

  function compare(next: EffectStatus) {
    setStatus(next);
    setProposedTo(PROPOSAL_RECIPIENTS[0]);
  }

  return <section id={id} data-book-island data-demo="rakazo-effect-replay" data-effect-status={status}
    data-hydrated={ready} className={`${demoSurface.surface} ${styles.root}`} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}>
      <p className={styles.eyebrow}>Rakazo / 审批恢复实验</p>
      <h3 id={`${uid}-title`}>恢复时，哪一份请求真正进入执行？</h3>
      <p>比较存档、新提议与执行参数的同一字段，再改变已保存的状态，观察为什么有时返回结果、有时暂停、有时必须核验外部目标。</p>
    </header>
    <fieldset className={styles.controls} disabled={!ready}>
      <legend>已匹配到同一个 ExternalEffect</legend>
      <div className={styles.radios} role="group" aria-label="已保存的 effect.status">
        {EFFECT_STATUSES.map(value => <label key={value}>
          <input type="radio" name={`${uid}-status`} value={value} checked={status === value} onChange={() => setStatus(value)} />
          <code>{value}</code>
        </label>)}
      </div>
      <label className={styles.selectLabel} htmlFor={`${uid}-proposal`}>恢复后模型新提议的 request.to
        <select id={`${uid}-proposal`} data-control="proposal" value={proposedTo} onChange={event => setProposedTo(event.target.value)}>
          {PROPOSAL_RECIPIENTS.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <div className={styles.presets}>
        <span>核对三个条件：</span>
        {(['approved', 'completed', 'executing'] as const).map(value => <Button key={value} size="sm" variant="outline"
          isDisabled={!ready} data-scenario={value} onPress={() => compare(value)}>
          {{approved: '批准后改收件人', completed: '已有成功回执', executing: '执行中发生中断'}[value]}
        </Button>)}
      </div>
    </fieldset>
    <ol className={styles.trace} aria-label="恢复决策与字段来源">
      <li>
        <h4>读取持久化状态，选择恢复动作</h4>
        <dl className={styles.branches}>{EFFECT_STATUSES.map(value => <div key={value} data-active={status === value}>
          <dt><code>{value}</code>{status === value && <span>当前</span>}</dt><dd>{BRANCHES[value]}</dd>
        </div>)}</dl>
        <p className={styles.note}>当前决策：<code data-gate-action>{view.gate.action}</code>。状态切换是在比较条件，不表示数据库已经发生这些操作。</p>
      </li>
      <li>
        <h4>逐字段核对执行参数来自哪里</h4>
        <div className={styles.tableWrap}><table className={styles.fields}>
          <thead><tr><th scope="col">字段</th><th scope="col">① 已保存 request</th><th scope="col">② 模型新提议</th><th scope="col">③ 认领成功后的执行参数</th></tr></thead>
          <tbody>{REQUEST_FIELDS.map(field => <tr key={field} data-request-field={field}>
            <th scope="row"><code>{field}</code></th>
            <td><code>{SAVED_REQUEST[field]}</code></td>
            <td data-different={view.proposedRequest[field] !== SAVED_REQUEST[field]}><code>{view.proposedRequest[field]}</code>
              {view.proposedRequest[field] !== SAVED_REQUEST[field] && <small>与存档不同，未采用</small>}
            </td>
            <td data-effective-field={field}>{view.executionPayload ? <><code>{view.executionPayload[field]}</code><small>来自①</small></> : <span>无执行参数</span>}</td>
          </tr>)}</tbody>
        </table></div>
        <p className={styles.note}>只有 <code>approved</code> 分支产生待执行参数；这里取回完整存档对象，模型的新提议不能覆盖其中的字段。</p>
      </li>
      <li>
        <h4>{view.executionPayload ? '取得执行资格后调用工具' : '直接返回，或保持暂停'}</h4>
        <div className={styles.result} role="status" aria-live="polite" aria-atomic="true">
          <strong data-readout>{view.label}</strong>
          <p data-tool-calls>{view.toolCalls ? '原子认领成功后才允许调用工具 1 次；此页面实际调用 0 次。' : '此恢复分支调用工具 0 次。'}</p>
          <pre data-replay-output>{JSON.stringify(view.executionPayload ?? view.returnedResult ?? {paused: true}, null, 2)}</pre>
        </div>
        {status === 'executing' && <p className={styles.note}>数据库仍为 executing，不能据此知道邮件是否已经发送；恢复时保存 uncertain 结果。是否实际发送，需要核对外部目标。</p>}
        {status === 'completed' && <p className={styles.note}>返回的是已有回执 <code>{SAVED_RESULT.messageId}</code>，这条分支不会再次发送。</p>}
      </li>
    </ol>
    <details className={styles.raw}><summary>展开两份请求的完整教学数据</summary><div className={styles.dataGrid}>
      <div><p>① effect.request · 原记录</p><pre data-saved-request>{JSON.stringify(SAVED_REQUEST, null, 2)}</pre></div>
      <div><p>② 模型新提议</p><pre data-proposed-request>{JSON.stringify(view.proposedRequest, null, 2)}</pre></div>
    </div></details>
    <p className={styles.boundary}>这是浏览器内的教学模型，不运行 Rakazo、Agent 或邮件工具。前提是已匹配同一 effect、工具路由校验通过；只展示普通直接工具分支，省略 catalog 参数封装、并发 Worker 与媒体任务。重复的 intended 返回 paused；新建操作可能进入自动审批或直接执行路径。</p>
  </section>;
}
