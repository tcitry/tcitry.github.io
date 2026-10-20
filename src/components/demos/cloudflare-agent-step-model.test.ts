import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_STEP_PHASES, agentStepView, INITIAL_AGENT_STEP, resetAgentStep,
  restartAgentStep, selectAgentStepPhase, STEP_CODE_CHANGE, STEP_TOOL_RESULTS,
} from './cloudflare-agent-step-model.ts';

test('crash points preserve the transcript, proposal and independent effect matrix', () => {
  const expected = [
    {phase: 'before-tools', memory: false, durable: false, effect: 0},
    {phase: 'before-barrier', memory: true, durable: false, effect: 1},
    {phase: 'after-barrier', memory: false, durable: true, effect: 1},
  ] as const;
  for (const row of expected) {
    const before = agentStepView(selectAgentStepPhase(row.phase));
    assert.equal(before.memoryStep, row.memory);
    assert.equal(before.durableStep, row.durable);
    assert.equal(before.applicationCount, row.effect);
    assert.deepEqual(before.memoryTranscript, row.memory ? STEP_TOOL_RESULTS : null);
    assert.deepEqual(before.memoryChange, row.memory ? STEP_CODE_CHANGE : null);
    const after = agentStepView(restartAgentStep(selectAgentStepPhase(row.phase)));
    assert.equal(after.memoryTranscript, null);
    assert.equal(after.memoryChange, null);
    assert.deepEqual(after.durableTranscript, row.durable ? STEP_TOOL_RESULTS : null);
    assert.deepEqual(after.durableChange, row.durable ? STEP_CODE_CHANGE : null);
    assert.equal(after.applicationCount, row.effect);
  }
});

test('historical replay never invokes a tool or rolls back the completed application write', () => {
  for (const {value} of AGENT_STEP_PHASES) {
    const input = selectAgentStepPhase(value);
    const before = agentStepView(input);
    const restarted = restartAgentStep(input);
    const after = agentStepView(restarted);
    assert.equal(after.replayToolCalls, 0);
    assert.equal(after.executedTools, before.executedTools);
    assert.equal(after.applicationCount, before.applicationCount);
    assert.deepEqual(restartAgentStep(restarted), restarted);
  }
});

test('a committed proposal has not advanced accepted source code', () => {
  const state = agentStepView(restartAgentStep(selectAgentStepPhase('after-barrier')));
  assert.equal(state.mainPriority, 'normal');
  assert.equal(state.proposalPriority, 'high');
  assert.equal(state.durableStep, true);
  assert.match(state.explanation, /Accept/);
});

test('changing the cut point and resetting start a fresh local experiment', () => {
  const restarted = restartAgentStep(INITIAL_AGENT_STEP);
  assert.equal(restarted.restarted, true);
  assert.equal(selectAgentStepPhase('after-barrier').restarted, false);
  assert.deepEqual(resetAgentStep(), INITIAL_AGENT_STEP);
  assert.notEqual(resetAgentStep(), INITIAL_AGENT_STEP);
  assert.equal(agentStepView(resetAgentStep()).memoryStep, true);
});
