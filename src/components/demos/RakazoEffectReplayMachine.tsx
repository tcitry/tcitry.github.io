import {Fragment, useEffect, useId, useState} from 'react';
import {AnatomySolid} from './AnatomyArt';
import {GATE_OPEN, HEIGHT, PAPER, partsForGate, SHADOW, WIDTH} from './rakazo-effect-geometry';
import {EFFECT_STATUSES, effectReplayView, PROPOSAL_RECIPIENTS, SAVED_REQUEST, SAVED_RESULT} from './rakazo-effect-model';
import type {EffectStatus, MailRequest} from './rakazo-effect-model';
import demoSurface from './DemoSurface.module.css';
import frame from './AnatomyFrame.module.css';
import styles from './RakazoEffectReplayMachine.module.css';

function RequestFields({request}: {request: Readonly<MailRequest>}) {
  const [recipient, domain] = request.to.split('@');
  return <><text x="5" y="22">to: {recipient}@</text><text x="5" y="31">{domain}</text><text x="5" y="43">{request.subject}</text><text x="5" y="53">{request.body}</text></>;
}

export default function RakazoEffectReplayMachine({id = 'rakazo-effect-replay-machine'}: {id?: string}) {
  const uid = useId();
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<EffectStatus>('approved');
  const [proposedTo, setProposedTo] = useState<string>(PROPOSAL_RECIPIENTS[0]);
  const view = effectReplayView(status, proposedTo);
  useEffect(() => setReady(true), []);
  return <section id={id} data-book-island data-demo="rakazo-effect-replay" data-effect-status={status} data-hydrated={ready} className={`${demoSurface.surface} ${frame.surface} ${styles.root}`} aria-labelledby={`${uid}-title`}>
    <header className={styles.header}><span className={frame.eyebrow}>ANATOMY · FIG. 01</span><h3 id={`${uid}-title`}>批准放行的是存档请求</h3><p>改变持久化状态和模型新提议的收件人，观察执行台最终收到什么。</p></header>
    <div className={styles.controls}>
      <fieldset disabled={!ready}><legend>已保存的 effect.status</legend><div className={styles.radios}>{EFFECT_STATUSES.map(value => <label key={value}><input type="radio" name={`${uid}-status`} value={value} checked={status === value} onChange={() => setStatus(value)} /><code>{value}</code></label>)}</div></fieldset>
      <label className={styles.selectLabel} htmlFor={`${uid}-proposal`}>模型新提议的 request.to<select id={`${uid}-proposal`} value={proposedTo} disabled={!ready} onChange={event => setProposedTo(event.target.value)}>{PROPOSAL_RECIPIENTS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    <div className={styles.card}>
      <div className={frame.corners}><span>存档抽屉 → 批准闸门 → 接收台</span><strong data-readout>{view.label}</strong></div>
      <svg className={styles.machine} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby={`${uid}-figure ${uid}-description`}>
        <title id={`${uid}-figure`}>请求存档分拣台</title><desc id={`${uid}-description`}>左侧抽屉始终保存收件人 {SAVED_REQUEST.to}。前方新提议为 {view.proposedRequest.to}。{status === 'approved' ? '批准闸门升起，右侧执行票据仍使用存档收件人。' : status === 'completed' ? `闸门关闭，右侧取出 ${SAVED_RESULT.messageId} 的已有回执。` : '闸门保持关闭，右侧没有可执行的请求。'}{view.label}。</desc>
        <path d={SHADOW} className={styles.shadow} />
        {partsForGate(status === 'approved').map(part => <Fragment key={part.name}>
          <g className={styles.gate} transform={part.moving && status === 'approved' ? GATE_OPEN : undefined}>
            <AnatomySolid name={part.name} paths={part.paths} tone={part.tone} lit={part.name === 'output-paper' && view.lane !== 'held'} />
          </g>
          {part.name === 'saved-paper' && <g transform={PAPER.saved} className={styles.ink} data-saved-ticket><text x="5" y="10" className={styles.field}>SAVED REQUEST</text><RequestFields request={SAVED_REQUEST} /></g>}
          {part.name === 'output-paper' && <g transform={PAPER.output} className={styles.ink} data-output-ticket>
            <text x="5" y="10" className={styles.field}>{view.lane === 'request' ? 'EXECUTE PAYLOAD' : view.lane === 'receipt' ? 'RETURN RESULT' : 'NO TOOL CALL'}</text>
            {view.executionPayload ? <RequestFields request={view.executionPayload} /> : view.lane === 'receipt' ? <><text x="5" y="25">{SAVED_RESULT.messageId}</text><text x="5" y="39">delivered:</text><text x="5" y="51">{String(SAVED_RESULT.delivered)}</text></> : <><text x="5" y="29">{status === 'denied' ? 'DENIED' : status === 'intended' ? 'PAUSED' : 'UNCERTAIN'}</text><text x="5" y="47">{view.toolCalls} executions</text></>}
          </g>}
          {part.name === 'proposal-paper' && <g transform={PAPER.proposal} className={styles.ink} data-proposal-ticket><text x="5" y="11">MODEL PROPOSAL · to: {view.proposedRequest.to}</text></g>}
        </Fragment>)}
      </svg>
      <div className={frame.corners}><span>新提议留在独立纸托；存档 request 保持原值</span><span data-tool-calls>{view.toolCalls ? '认领成功后可调用工具 1 次' : '调用工具 0 次'}</span></div>
    </div>
    <p role="status" aria-live="polite" className={styles.explanation}>{view.explanation}</p>
    <div className={styles.dataGrid}>
      <div><span>① effect.request · 原记录</span><pre data-saved-request>{JSON.stringify(SAVED_REQUEST, null, 2)}</pre></div>
      <div><span>② 模型新提议 · 不覆盖存档</span><pre data-proposed-request>{JSON.stringify(view.proposedRequest, null, 2)}</pre></div>
      <div><span>{view.executionPayload ? '③ 执行 payload · 来自①' : '③ 返回结果 · 不发送邮件'}</span><pre data-replay-output>{JSON.stringify(view.executionPayload ?? view.returnedResult ?? {paused: true}, null, 2)}</pre></div>
    </div>
    <p className={styles.boundary}>这是浏览器内的教学模型，不运行 Rakazo、Agent 或邮件工具。只展示已匹配同一 effect、路由校验通过后的普通直接工具恢复分支；<code>approved</code> 仍需原子认领成功，才会执行保存的参数。图中不模拟 catalog 参数封装、并发 worker 或媒体任务的专门恢复。</p>
  </section>;
}
