export type AgentStepPhase = 'before-tools' | 'before-barrier' | 'after-barrier';

export interface AgentStepInput {
  phase: AgentStepPhase;
  restarted: boolean;
}

export const AGENT_STEP_PHASES: ReadonlyArray<{value: AgentStepPhase; label: string}> = [
  {value: 'before-tools', label: '工具执行前'},
  {value: 'before-barrier', label: '两个工具完成，提交屏障前'},
  {value: 'after-barrier', label: '提交屏障成功后'},
];
export const INITIAL_AGENT_STEP: Readonly<AgentStepInput> = {phase: 'before-barrier', restarted: false};
export const AGENT_STEP_SOURCE = 'https://github.com/cloudflare/cloudflare-os/blob/d1ff6d8d3db0968673fceb6ba18546dc1d6f9b3e/packages/workshop-backend/src';

export const STEP_TOOL_RESULTS = {
  executeCode: {count: 1},
  editFile: {success: true},
} as const;
export const STEP_CODE_CHANGE = {
  workpiece: 7,
  path: 'server.js',
  before: 'const priority = "normal";',
  after: 'const priority = "high";',
} as const;

export interface AgentStepView {
  phase: AgentStepPhase;
  restarted: boolean;
  phaseLabel: string;
  memoryStep: boolean;
  durableStep: boolean;
  applicationCount: 0 | 1;
  executedTools: 0 | 2;
  replayToolCalls: 0;
  memoryTranscript: typeof STEP_TOOL_RESULTS | null;
  memoryChange: typeof STEP_CODE_CHANGE | null;
  durableTranscript: typeof STEP_TOOL_RESULTS | null;
  durableChange: typeof STEP_CODE_CHANGE | null;
  mainPriority: 'normal';
  proposalPriority: 'high' | null;
  stampDown: boolean;
  explanation: string;
  readout: string;
  svgDescription: string;
  memoryPrint: readonly string[];
  changePrint: readonly string[];
  effectPrint: readonly string[];
}

/** A projection of one completed model response, not a runner or a retry policy. */
export function agentStepView(input: Readonly<AgentStepInput>): AgentStepView {
  const toolsFinished = input.phase !== 'before-tools';
  const durableStep = input.phase === 'after-barrier';
  const memoryStep = input.phase === 'before-barrier' && !input.restarted;
  const applicationCount = toolsFinished ? 1 : 0;
  const phaseLabel = AGENT_STEP_PHASES.find(phase => phase.value === input.phase)!.label;
  const explanation = !input.restarted
    ? input.phase === 'before-tools'
      ? '切在工具前：这一步还没有工具结果、代码改动或应用写入。此前已经保存的聊天历史与文件读取不在图中。'
      : input.phase === 'before-barrier'
        ? 'executeCode 已把应用计数写成 1；随后 editFile 形成 priority 的改动。工具结果和代码改动还在内存里，尚未通过提交屏障。'
        : 'commitAgentStep 已把这一步的消息、工具结果与代码提案一起提交。应用计数为 1，代码提案仍待用户 Accept，主线 priority 还是 normal。'
    : input.phase === 'before-tools'
      ? 'DO 重启后没有这一步可恢复的结果，也没有应用写入。历史重放阶段调用工具 0 次；随后启动的新模型请求仍可能产生新的工具调用。'
      : input.phase === 'before-barrier'
        ? 'DO 重启清空了尚未提交的工具结果和代码改动，应用计数仍为 1。持久日志不知道这次写入；后续模型若再次选择调用，可能重复副作用，但这里不自动重发。'
        : 'DO 重启后从持久日志重建这一步，已保存的工具结果和代码提案仍在，应用计数仍为 1。历史重放阶段调用工具 0 次；代码提案仍待用户 Accept。';
  const readout = `${input.restarted ? '重启后' : '重启前'} · 持久 step ${durableStep ? 1 : 0} · 应用 count ${applicationCount}`;
  const memoryPrint = ['executeCode', 'count = 1', 'edit: success'] as const;
  const changePrint = ['server.js', 'priority', 'normal -> high'] as const;
  const effectPrint = ['increment()', `count = ${applicationCount}`];
  return {
    phase: input.phase,
    restarted: input.restarted,
    phaseLabel,
    memoryStep,
    durableStep,
    applicationCount,
    executedTools: toolsFinished ? 2 : 0,
    replayToolCalls: 0,
    memoryTranscript: memoryStep ? STEP_TOOL_RESULTS : null,
    memoryChange: memoryStep ? STEP_CODE_CHANGE : null,
    durableTranscript: durableStep ? STEP_TOOL_RESULTS : null,
    durableChange: durableStep ? STEP_CODE_CHANGE : null,
    mainPriority: 'normal',
    proposalPriority: memoryStep || durableStep ? 'high' : null,
    stampDown: durableStep,
    explanation,
    readout,
    svgDescription: `${phaseLabel}，${readout}。上方两个待提交托盘${memoryStep ? '分别放着 count = 1 的工具结果和 normal 改为 high 的代码改动' : '为空'}；下方两条持久账纸${durableStep ? '已同时印入工具结果与代码提案' : '没有这一步的记录'}。右侧独立的应用计数匣显示 ${applicationCount}。${explanation}`,
    memoryPrint,
    changePrint,
    effectPrint,
  };
}

export function selectAgentStepPhase(phase: AgentStepPhase): AgentStepInput {
  return {phase, restarted: false};
}

export function restartAgentStep(input: Readonly<AgentStepInput>): AgentStepInput {
  return {...input, restarted: true};
}

export function resetAgentStep(): AgentStepInput {
  return {...INITIAL_AGENT_STEP};
}
