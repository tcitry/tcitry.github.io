/** Stable teaching branches of Cindy 5feeb59; no tasks, timers or native sessions run here. */
export const CINDY_REVISION = '5feeb591811b9ff779cbf62d30e7096ac7f18ec1';
export type CindyLeadCondition = 'busy' | 'idle';
export type CindyReportPath = 'terminal' | 'explicit';
export type CindyDelivery = 'accepted' | 'rejected';
export interface CindyOrcaConditions {
  lead: CindyLeadCondition;
  delivery: CindyDelivery;
  report: CindyReportPath;
}
export const CINDY_DEFAULT: CindyOrcaConditions = {lead: 'busy', delivery: 'accepted', report: 'terminal'};
export const CINDY_TOUR: CindyOrcaConditions[] = [
  CINDY_DEFAULT,
  {lead: 'busy', delivery: 'rejected', report: 'terminal'},
  {lead: 'idle', delivery: 'accepted', report: 'explicit'},
];
export const CINDY_SESSIONS = {
  lead: {businessId: 'lead-session', nativeId: 'native-lead', history: ['用户：核对接口与回归范围', 'Lead：把接口核对交给 Worker', 'Lead：保留自己的对话与上下文']},
  worker: {businessId: 'worker-session', nativeId: 'native-worker', history: ['Lead 消息：核对接口并附证据', 'Worker：读取实现与相关用例', 'Worker：已整理报告，等待交付']},
} as const;
export type CindyCardPlace = 'queue' | 'input' | 'pending';

/** A completed Worker output is fixed; changing conditions compares code paths, not task progress. */
export function evaluateCindyOrca(conditions: CindyOrcaConditions = CINDY_DEFAULT) {
  const terminal = conditions.report === 'terminal';
  const accepted = conditions.delivery === 'accepted';
  const queued = accepted && conditions.lead === 'busy';
  const mode = !accepted ? 'rejected' : queued ? 'queued' : 'dispatched';
  const workerStatus = terminal || accepted ? 'done' : 'running';
  const cardPlace: CindyCardPlace = !accepted ? 'pending' : queued ? 'queue' : 'input';
  const retryAfterRejectedDelivery = terminal && !accepted;
  const pendingState = terminal ? accepted ? 'cleared' : 'retained' : 'terminal-close';
  const order = terminal
    ? ['OrcaTeamService：先写 Worker done', 'bridgeWorkerCompletion：形成回报', 'Dispatcher：' + (accepted ? queued ? '加入 Lead 队列' : '送到 Lead 会话入口' : '返回投递失败'), accepted ? 'accepted=true：删除当前 pending' : '保留 pending：后续终态事件可重试']
    : ['Worker MCP：send_to_lead', 'Dispatcher：' + (accepted ? queued ? '加入 Lead 队列' : '送到 Lead 会话入口' : '返回投递失败'), accepted ? 'settleWorkerReport：请求写 done' : '没有成功 settlement：本次不写 done', '随后终态路径处理运行期回报状态'];
  const receipt = terminal
    ? accepted ? 'accepted: true（result.ok）' : 'accepted: false'
    : accepted ? queued ? 'ok: true · queued: true' : 'ok: true' : '工具返回投递错误';
  const pendingText = terminal
    ? accepted ? 'autoBridge 当前 pending 已删除' : '进程内 pending 保留 · retry=true'
    : accepted ? '请求标 done；随后终态收口' : '本次未结清；终态仍可补回报';
  const explanation = !accepted
    ? terminal
      ? 'Worker 已终止，因此先成为 done。回报投递被拒后仍保留在进程内 autoBridge 中，等待符合条件的后续终态事件重试。'
      : '显式回报被拒，没有执行成功 settlement。假定本轮仍在运行，Worker 保持 running；已有回报没有进入 Lead 队列。'
    : queued
      ? terminal
        ? 'Worker 先成为 done，回报随后被宿主接受并进入 Lead 待处理队列。accepted 让 autoBridge 删除当前 pending；Lead 还没有消费这条排队消息。'
        : '宿主接受了排队回报，工具返回 queued:true，并请求把 Worker 标为 done。排队消息仍等待 Lead 处理；MCP 返回不保证数据库与 autoBridge 同步结清。'
      : terminal
        ? 'Worker 先成为 done，宿主把回报交给 Lead 会话入口，并删除当前 pending。入口接受不提供内容已读或任务验收结果。'
        : 'Lead 空闲，宿主把回报交给会话入口，再请求把 Worker 标为 done。状态写入成功后的稳定结果仍不代表 Lead 已读或验收。';
  return {conditions: {...conditions}, mode, workerStatus, cardPlace, queuedCount: queued ? 1 : 0, retryAfterRejectedDelivery, pendingState, receipt, pendingText, order, explanation,
    workerMark: terminal ? 'done · 终态先写入' : accepted ? 'done · 假定异步写入成功' : 'running · 本次未写 done',
    leadText: queued ? '1 条回报 · 等待处理' : accepted ? '已交会话入口' : '回报未到达',
    dispatcherText: queued ? 'queued · 宿主已接受' : accepted ? 'dispatched · 宿主已接受' : 'rejected · 未接受',
    leadReadReceipt: null,
    leadValidation: null,
  };
}
export type CindyOrcaBranch = ReturnType<typeof evaluateCindyOrca>;
