/** Educational subset of Rakazo 08ee8cf approval-effect.ts, for an already matched
 * duplicate effect and a plain direct tool request. No provider calls or storage. */
export const EFFECT_STATUSES = ['approved', 'completed', 'denied', 'intended', 'executing', 'uncertain'] as const;
export type EffectStatus = typeof EFFECT_STATUSES[number];
export type MailRequest = {to: string; subject: string; body: string};
export const SAVED_REQUEST: Readonly<MailRequest> = Object.freeze({
  to: 'team@example.test', subject: 'Build report', body: 'Build 42 passed',
});
export const SAVED_RESULT = Object.freeze({messageId: 'mail-42', delivered: true});
export const PROPOSAL_RECIPIENTS = ['other@example.test', 'team@example.test'] as const;
const DENIED_ERROR = 'The user denied this action. Do not retry or rephrase it; tell the user and ask what they want instead.';
export function uncertainResult(toolName: string) {
  return {error: `The earlier ${toolName} execution was interrupted, so its outcome is unknown. It was not replayed to avoid a duplicate side effect. Verify the destination before proposing another action.`, uncertain: true};
}
export type ReplayGate =
  | {action: 'execute'}
  | {action: 'return'; result: unknown}
  | {action: 'paused'}
  | {action: 'uncertain'; toolName: string};

/** Mirrors resolveDuplicateEffectGate, including null-result fallbacks. */
export function replayGate(effect: {status: string; result?: unknown}, toolName = 'send_email'): ReplayGate {
  if (effect.status === 'completed') return {action: 'return', result: effect.result ?? {duplicate: true}};
  if (effect.status === 'denied') return {action: 'return', result: {error: DENIED_ERROR}};
  if (effect.status === 'executing') return {action: 'uncertain', toolName};
  if (effect.status === 'uncertain') return {action: 'return', result: effect.result ?? uncertainResult(toolName)};
  if (effect.status === 'approved') return {action: 'execute'};
  if (effect.status === 'intended') return {action: 'paused'};
  return {action: 'uncertain', toolName};
}

export function effectReplayView(status: EffectStatus, proposedTo: string) {
  const proposedRequest: MailRequest = {...SAVED_REQUEST, to: proposedTo};
  const savedResult = status === 'completed' ? SAVED_RESULT : status === 'uncertain' ? uncertainResult('send_email') : undefined;
  const gate = replayGate({status, result: savedResult});
  // executor.ts restores approvedReplayArgs before executing. This fixture is
  // the plain-object branch; catalog and resource-bound envelopes are excluded.
  const executionPayload = gate.action === 'execute' ? {...SAVED_REQUEST} : null;
  const returnedResult = gate.action === 'return' ? gate.result : gate.action === 'uncertain' ? uncertainResult('send_email') : null;
  const lane = status === 'approved' ? 'request' : status === 'completed' ? 'receipt' : 'held';
  const label = {
    approved: '执行保存的 request', completed: '返回保存的 result', denied: '返回拒绝，不调用工具',
    intended: '保持暂停，等待批准', executing: '转入 uncertain，不重放', uncertain: '返回 uncertain，不重放',
  }[status];
  const explanation = {
    approved: `批准闸门允许原子认领；认领成功后，执行 payload 的 to 仍为 ${SAVED_REQUEST.to}。模型新提议的收件人不能替换它。`,
    completed: `执行台不再接收 request；取出已保存的 ${SAVED_RESULT.messageId} 回执并直接返回，避免第二次发送。`,
    denied: '已拒绝的 effect 直接返回拒绝信息。改写收件人或换一种措辞不会让这个 effect 获得执行资格。',
    intended: '这个重复 effect 尚未批准，返回 paused。这里展示恢复分支，不表示所有新建 intended 都必须等待人工批准。',
    executing: '记录停在 executing，外部动作可能已经发生。先把该记录标成 uncertain 并保存错误结果，不能盲目再次发送。',
    uncertain: '结果不确定的记录直接返回已保存的 uncertain 结果。先核实目标端，再提出后续动作。',
  }[status];
  return {status, proposedRequest, executionPayload, savedResult, returnedResult, gate, lane, label, explanation,
    changed: proposedTo !== SAVED_REQUEST.to, toolCalls: status === 'approved' ? 1 : 0};
}
