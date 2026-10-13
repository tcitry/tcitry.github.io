/** A local teaching model, not Cindy's runtime or an upstream harness Agent Loop. */
export type CindyWorkerId = 'A' | 'B';
export type CindyWorkerPhase = 'idle' | 'delivering' | 'working' | 'waiting' | 'ready' | 'returning' | 'reported' | 'error';
export type CindyWorkerStatus = 'idle' | 'running' | 'done' | 'error';
export interface CindyWorker {
  id: CindyWorkerId;
  session: string;
  harness: string;
  task: string;
  context: string;
  history: string[];
  phase: CindyWorkerPhase;
  status: CindyWorkerStatus;
  step: number;
  transfer: number;
  result: string | null;
}
export interface CindyOrcaState {
  workers: [CindyWorker, CindyWorker];
  leadHistory: string[];
  summary: string | null;
}
export type CindyOrcaAction =
  | {type: 'dispatch'}
  | {type: 'advance'; worker: CindyWorkerId}
  | {type: 'confirm'; worker: CindyWorkerId}
  | {type: 'fail'; worker: CindyWorkerId}
  | {type: 'retry'; worker: CindyWorkerId}
  | {type: 'report'; worker: CindyWorkerId}
  | {type: 'summarize'};

export function createCindyOrca(): CindyOrcaState {
  return {
    workers: [
      {id: 'A', session: 'session-a', harness: 'Claude Code', task: '核对接口契约', context: '只核对接口输入和返回值，附源码证据。', history: ['独立会话 A 已创建，等待工单。'], phase: 'idle', status: 'idle', step: 0, transfer: 0, result: null},
      {id: 'B', session: 'session-b', harness: 'Codex', task: '检查回归范围', context: '只核对受影响用例，先确认检查范围。', history: ['独立会话 B 已创建，等待工单。'], phase: 'idle', status: 'idle', step: 0, transfer: 0, result: null},
    ],
    leadHistory: ['Lead：准备两份自包含工单，分别指定产物与检查范围。'],
    summary: null,
  };
}

const clone = (state: CindyOrcaState): CindyOrcaState => ({
  ...state,
  workers: state.workers.map(worker => ({...worker, history: [...worker.history]})) as CindyOrcaState['workers'],
  leadHistory: [...state.leadHistory],
});
export const canSummarizeCindy = (state: CindyOrcaState) => state.workers.every(worker => worker.phase === 'reported' && worker.result !== null);
export const cindyHasTransfers = (state: CindyOrcaState) => state.workers.some(worker => worker.phase === 'delivering' || worker.phase === 'returning');

export function actCindyOrca(state: CindyOrcaState, action: CindyOrcaAction): CindyOrcaState {
  if (action.type === 'dispatch') {
    if (!state.workers.every(worker => worker.phase === 'idle')) return state;
    const next = clone(state);
    next.workers.forEach(worker => {worker.phase = 'delivering'; worker.transfer = 0;});
    next.leadHistory.push('Lead：分别派发工单 A 与 B。');
    return next;
  }
  if (action.type === 'summarize') {
    if (!canSummarizeCindy(state) || state.summary !== null) return state;
    const next = clone(state);
    next.summary = 'Lead 已检查两份回报：接口契约与回归范围均已列出。';
    next.leadHistory.push(next.summary);
    return next;
  }
  const previous = state.workers.find(worker => worker.id === action.worker)!;
  if (action.type === 'advance' && previous.phase !== 'working') return state;
  if (action.type === 'confirm' && previous.phase !== 'waiting') return state;
  if (action.type === 'fail' && !['working', 'waiting', 'ready'].includes(previous.phase)) return state;
  if (action.type === 'retry' && previous.phase !== 'error') return state;
  if (action.type === 'report' && previous.phase !== 'ready') return state;
  const next = clone(state);
  const worker = next.workers.find(item => item.id === action.worker)!;
  if (action.type === 'advance') {
    worker.step += 1;
    if (worker.id === 'B' && worker.step === 2) {
      worker.phase = 'waiting';
      worker.history.push('检查到范围歧义，等待补充确认。');
    } else if (worker.step >= 3) {
      worker.phase = 'ready';
      worker.result = worker.id === 'A' ? '已列出接口输入、返回值与源码位置。' : '已列出受影响用例与回归检查范围。';
      worker.history.push('已整理成果，尚未交付给 Lead。');
    } else {
      worker.history.push(worker.id === 'A' ? '读取接口定义，记录证据。' : '读取用例，记录受影响范围。');
    }
  } else if (action.type === 'confirm') {
    worker.phase = 'working';
    worker.history.push('收到补充：沿既定范围继续检查。');
  } else if (action.type === 'fail') {
    worker.phase = 'error'; worker.status = 'error'; worker.result = null;
    worker.history.push('教学故障：执行中断，未取得可用成果。');
  } else if (action.type === 'retry') {
    worker.phase = 'delivering'; worker.status = 'idle'; worker.transfer = 0; worker.step = 0;
    worker.history.push('在同一独立会话中重试，保留已有历史。');
    next.leadHistory.push(`Lead：重新派发工单 ${worker.id}。`);
  } else if (action.type === 'report') {
    worker.phase = 'returning'; worker.transfer = 0;
    worker.history.push('发送成果回报，等待宿主接受。');
  }
  return next;
}

/** Transfer completion is the acceptance boundary: creation or work alone is insufficient. */
export function tickCindyOrca(state: CindyOrcaState, seconds: number, still = false): CindyOrcaState {
  if (!cindyHasTransfers(state) || (!still && (!Number.isFinite(seconds) || seconds <= 0))) return state;
  const next = clone(state);
  next.workers.forEach(worker => {
    if (worker.phase !== 'delivering' && worker.phase !== 'returning') return;
    worker.transfer = still ? 1 : Math.min(1, worker.transfer + seconds / 0.95);
    if (worker.transfer < 1) return;
    if (worker.phase === 'delivering') {
      worker.phase = 'working'; worker.status = 'running';
      worker.history.push(`收到工单：${worker.task}。`);
    } else {
      worker.phase = 'reported'; worker.status = 'done';
      worker.history.push('回报已被宿主接受；done 不表示 Lead 已验收。');
      next.leadHistory.push(`收到 Worker ${worker.id} 回报：${worker.result}`);
    }
  });
  return next;
}

export function cindyPhaseText(worker: CindyWorker): string {
  return {
    idle: 'idle · 尚未派活', delivering: 'idle · 工单在途', working: `running · 已记录 ${worker.step}/3 步`,
    waiting: 'running · 等待确认', ready: 'running · 成果待回报', returning: 'running · 回报在途',
    reported: 'done · 已回报，待 Lead 检查', error: 'error · 执行中断',
  }[worker.phase];
}
