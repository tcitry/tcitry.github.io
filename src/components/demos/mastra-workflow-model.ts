/** Deterministic teaching fixture. It does not import or execute Mastra. */
export const MASTRA_REVISION = 'a1fbf275e587d56a86c52295eceff6c0756169e8';
export const APPROVAL_THRESHOLD = 100;
export const MAX_AMOUNT = 300;
export const MIN_AMOUNT = 10;
export type WorkflowStatus = 'ready' | 'suspended' | 'success';
export type ApprovalResult = 'approved' | 'rejected' | 'automatic';
export interface ApprovalOutput {amount: number; decision: ApprovalResult}
export interface WorkflowSnapshot {
  status: 'suspended' | 'success';
  suspendedPaths: {approval?: [1]};
  context: {
    input: {amount: number};
    normalize: {status: 'success'; payload: {amount: number}; output: {amount: number}};
    approval: {
      status: 'suspended' | 'success';
      payload: {amount: number};
      suspendPayload?: {amount: number; reason: 'Amount exceeds automatic approval limit'};
      resumePayload?: {approved: boolean};
      output?: ApprovalOutput;
    };
    receipt?: {status: 'success'; payload: ApprovalOutput; output: ApprovalOutput & {receipt: string}};
  };
}
export interface WorkflowMachineState {
  draftAmount: number;
  status: WorkflowStatus;
  snapshot: WorkflowSnapshot | null;
  counts: {normalize: number; approval: number; receipt: number};
}
export type WorkflowAction = {type: 'amount'; amount: number} | {type: 'start'} | {type: 'resume'; approved: boolean} | {type: 'reset'};

export function boundedAmount(value: number): number {
  return Number.isFinite(value) ? Math.max(MIN_AMOUNT, Math.min(MAX_AMOUNT, value)) : MIN_AMOUNT;
}
export function initialWorkflowState(amount = 180): WorkflowMachineState {
  return {draftAmount: boundedAmount(amount), status: 'ready', snapshot: null, counts: {normalize: 0, approval: 0, receipt: 0}};
}

function finish(snapshot: WorkflowSnapshot, decision: ApprovalResult): WorkflowSnapshot {
  const {suspendPayload: _suspended, ...approval} = snapshot.context.approval;
  const amount = approval.payload.amount;
  const output: ApprovalOutput = {amount, decision};
  return {
    status: 'success',
    suspendedPaths: {},
    context: {
      ...snapshot.context,
      approval: {...approval, status: 'success', output},
      receipt: {status: 'success', payload: output, output: {...output, receipt: `${decision}:${amount.toFixed(2)}`}},
    },
  };
}

export function workflowReducer(state: WorkflowMachineState, action: WorkflowAction): WorkflowMachineState {
  if (action.type === 'amount') return {...state, draftAmount: boundedAmount(action.amount)};
  if (action.type === 'reset') return initialWorkflowState(state.draftAmount);
  if (action.type === 'start') {
    // Starting again is an explicit reset; a pending run cannot be overwritten by a UI click.
    if (state.status !== 'ready') return state;
    const inputAmount = state.draftAmount;
    const amount = Math.round(inputAmount * 100) / 100;
    const snapshot: WorkflowSnapshot = {
      status: 'suspended',
      suspendedPaths: {approval: [1]},
      context: {
        input: {amount: inputAmount},
        normalize: {status: 'success', payload: {amount: inputAmount}, output: {amount}},
        approval: {status: 'suspended', payload: {amount}, suspendPayload: {amount, reason: 'Amount exceeds automatic approval limit'}},
      },
    };
    if (amount > APPROVAL_THRESHOLD) return {...state, status: 'suspended', snapshot, counts: {normalize: 1, approval: 1, receipt: 0}};
    const completed = finish(snapshot, 'automatic');
    return {...state, status: 'success', snapshot: completed, counts: {normalize: 1, approval: 1, receipt: 1}};
  }
  if (state.status !== 'suspended' || !state.snapshot) return state;
  // resumeData being present is distinct from its approved field being true.
  const restored: WorkflowSnapshot = {
    ...state.snapshot,
    context: {...state.snapshot.context, approval: {...state.snapshot.context.approval, resumePayload: {approved: action.approved}}},
  };
  return {
    ...state,
    status: 'success',
    snapshot: finish(restored, action.approved ? 'approved' : 'rejected'),
    counts: {...state.counts, approval: state.counts.approval + 1, receipt: 1},
  };
}

/** Every physical display and textual readout uses these same derived values. */
export function workflowReadout(state: WorkflowMachineState) {
  const approval = state.snapshot?.context.approval;
  const savedAmount = approval?.payload.amount ?? null;
  const output = approval?.output ?? null;
  return {
    savedAmount,
    displayedAmount: savedAmount ?? state.draftAmount,
    frozen: savedAmount !== null,
    draftDiffers: savedAmount !== null && savedAmount !== state.draftAmount,
    amountFraction: (savedAmount ?? state.draftAmount) / MAX_AMOUNT,
    resumeData: approval?.resumePayload ?? null,
    output,
    receipt: state.snapshot?.context.receipt?.output ?? null,
    statusLabel: state.status === 'ready' ? '准备' : state.status === 'suspended' ? '暂停 · 等待 resumeData' : '成功 · receipt 已完成',
    explanation: state.status === 'ready'
      ? '提交金额后，normalize 生成 approval 的输入。超过 100 才会暂停。'
      : state.status === 'suspended'
        ? `金额 ${savedAmount} 已保存在 approval.payload；修改上方待提交金额，不会改写这个运行。恢复时从保存的输入重新执行 approval。`
        : output?.decision === 'automatic'
          ? `金额 ${savedAmount} 不超过 100，approval 直接输出 automatic，未发生暂停。`
          : `approval 读取保存的金额 ${savedAmount}，再组合新传入的 approved=${approval?.resumePayload?.approved}。即使值为 false，resumeData 也已存在，因此输出 ${output?.decision}，继续执行 receipt。`,
  };
}
