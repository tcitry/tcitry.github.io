/**
 * Small teaching model of REA's literal Electron IPC pairing, verified against
 * 33b9b31a6fb50cc3e6f4591d0395dbba15b51f13. It generates a bounded fixture;
 * it does not parse JavaScript, run Electron, or claim runtime reachability.
 */
export const REA_IPC_REVISION = '33b9b31a6fb50cc3e6f4591d0395dbba15b51f13';
export type TransmissionOperation = 'invoke' | 'send' | 'sendSync' | 'sendToHost';
export type HandlerOperation = 'handle' | 'handleOnce' | 'on' | 'once';
export type IpcMode = 'invoke' | 'send' | 'handle' | 'listen';
export interface TeachingHandler {
  id: string;
  channel: string;
  operation: HandlerOperation;
  enabled: boolean;
}
export interface PairingInput {
  channel: string;
  dynamic: boolean;
  operation: TransmissionOperation;
  handlers: TeachingHandler[];
}
export interface TeachingFinding {
  side: 'renderer' | 'main';
  operation: string;
  mode: IpcMode;
  channel: string | null;
  channel_expression: string | null;
}
export interface HandlerResult {
  input: TeachingHandler;
  finding: TeachingFinding;
  channelMatches: boolean;
  modeMatches: boolean;
  candidate: boolean;
}
export type PairingStatus = 'paired' | 'ambiguous' | 'unpaired';
const operationNames = {invoke: 'invoke', send: 'send', sendSync: 'send-sync', sendToHost: 'send-to-host', handle: 'handle', handleOnce: 'handle-once', on: 'on', once: 'once'} as const;
const modes = {invoke: 'invoke', send: 'send', sendSync: 'send', sendToHost: 'send', handle: 'handle', handleOnce: 'handle', on: 'listen', once: 'listen'} as const;

export function pairingModel(input: PairingInput) {
  const transmission: TeachingFinding = {
    side: 'renderer', operation: operationNames[input.operation], mode: modes[input.operation],
    channel: input.dynamic ? null : input.channel, channel_expression: input.dynamic ? 'CHANNEL' : null,
  };
  const eligible = input.operation !== 'sendToHost';
  const handlers: HandlerResult[] = input.handlers.filter(item => item.enabled).map(item => {
    const finding: TeachingFinding = {side: 'main', operation: operationNames[item.operation], mode: modes[item.operation], channel: item.channel, channel_expression: null};
    const channelMatches = transmission.channel !== null && finding.channel === transmission.channel;
    const modeMatches = transmission.mode === 'invoke' ? finding.mode === 'handle' : transmission.mode === 'send' && finding.mode === 'listen';
    return {input: item, finding, channelMatches, modeMatches, candidate: eligible && channelMatches && modeMatches};
  });
  const candidates = handlers.filter(item => item.candidate);
  // sendToHost is excluded before classification: it has no upstream state.
  const status: PairingStatus | null = !eligible ? null : candidates.length === 1 ? 'paired' : candidates.length > 1 ? 'ambiguous' : 'unpaired';
  const pairedHandler = status === 'paired' ? candidates[0]! : null;
  const rendererSource = `const { ipcRenderer } = require("electron");\n${input.dynamic ? `const CHANNEL = ${JSON.stringify(input.channel)};\n` : ''}ipcRenderer.${input.operation}(${input.dynamic ? 'CHANNEL' : JSON.stringify(input.channel)});`;
  const mainSource = `const { ipcMain } = require("electron");\n${handlers.map(({input: item}) => `ipcMain.${item.operation}(${JSON.stringify(item.channel)}, () => {}); // ${item.id}`).join('\n')}`;
  return {
    transmission, eligible, handlers, candidates, status, pairedHandler, rendererSource, mainSource,
    channelCount: eligible ? handlers.filter(item => item.channelMatches).length : 0,
    directEdges: pairedHandler ? [{source: 'renderer.js', target: pairedHandler.input.id, relation: transmission.mode === 'invoke' ? 'invokes' : 'sends', operation: 'pair-ipc-literal-channel'}] : [],
    unpairedLiteral: status === 'unpaired' && transmission.channel !== null ? 1 : 0,
    dynamicOperations: transmission.channel === null ? 1 : 0,
  };
}

const defaults = (): TeachingHandler[] => [
  {id: 'H1', channel: 'profile:read', operation: 'handle', enabled: true},
  {id: 'H2', channel: 'profile:read', operation: 'on', enabled: true},
  {id: 'H3', channel: 'profile:write', operation: 'handle', enabled: true},
];
export const REA_IPC_PRESETS = [
  {id: 'unique', label: '唯一候选', input: {channel: 'profile:read', dynamic: false, operation: 'invoke', handlers: defaults()}},
  {id: 'send', label: '改成 send', input: {channel: 'profile:read', dynamic: false, operation: 'send', handlers: defaults()}},
  {id: 'ambiguous', label: '重复 handle', input: {channel: 'profile:read', dynamic: false, operation: 'invoke', handlers: defaults().map(item => item.id === 'H2' ? {...item, operation: 'handle' as const} : item)}},
  {id: 'missing', label: 'Channel 不同', input: {channel: 'prefs:read', dynamic: false, operation: 'invoke', handlers: defaults()}},
  {id: 'dynamic', label: 'const 别名', input: {channel: 'profile:read', dynamic: true, operation: 'invoke', handlers: defaults()}},
  {id: 'host', label: 'sendToHost', input: {channel: 'profile:read', dynamic: false, operation: 'sendToHost', handlers: defaults()}},
] satisfies Array<{id: string; label: string; input: PairingInput}>;

/** Physical x-position of a handler token, in the same four-step filter model. */
export function handlerPosition(handler: HandlerResult, eligible: boolean, step: number): number {
  if (step === 0 || !eligible) return -142;
  if (!handler.channelMatches) return -111;
  if (step === 1) return -34;
  if (!handler.modeMatches) return -26;
  return step === 2 ? 51 : 116;
}
