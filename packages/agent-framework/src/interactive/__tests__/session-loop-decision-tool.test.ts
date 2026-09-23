import { describe, expect, it } from 'vitest';

import {
  LOOP_DECISION_TOOL_NAME,
  extractSelfPacedLoopDecision,
} from '../session-loop-decision-tool.js';

describe('structured self-paced loop decision', () => {
  it('uses one successfully executed decision in the current turn, without a model-supplied loop id', () => {
    const args = { action: 'continue', delaySeconds: 90, reason: 'CI is running' };
    expect(
      extractSelfPacedLoopDecision([
        { name: 'read_file', args: '{}' },
        {
          name: LOOP_DECISION_TOOL_NAME,
          args: JSON.stringify(args),
        },
      ], [{ name: LOOP_DECISION_TOOL_NAME, args, success: true }]),
    ).toEqual({ action: 'continue', delaySeconds: 90, reason: 'CI is running' });
  });

  it.each([
    '{',
    '{"action":"continue","delaySeconds":59,"reason":"too soon"}',
    '{"action":"continue","delaySeconds":3601,"reason":"too late"}',
    '{"action":"continue","delaySeconds":60,"reason":""}',
    '{"action":"continue","delaySeconds":60,"reason":"ok","loopId":"another"}',
  ])('treats invalid or cross-loop arguments as an omitted decision: %s', (args) => {
    expect(extractSelfPacedLoopDecision([{ name: LOOP_DECISION_TOOL_NAME, args }], [])).toBeNull();
  });

  it('does not use an older valid decision when the last one is malformed', () => {
    expect(
      extractSelfPacedLoopDecision([
        { name: LOOP_DECISION_TOOL_NAME, args: '{"action":"stop"}' },
        { name: LOOP_DECISION_TOOL_NAME, args: '{"action":"continue"}' },
      ], []),
    ).toBeNull();
  });

  it('requires the last model decision to have exactly one successful execution', () => {
    const args = { action: 'continue', delaySeconds: 90, reason: 'CI is running' };
    const summaries = [{ name: LOOP_DECISION_TOOL_NAME, args: JSON.stringify(args) }];
    expect(extractSelfPacedLoopDecision(summaries, [
      { name: LOOP_DECISION_TOOL_NAME, args, success: false },
    ])).toBeNull();
    expect(extractSelfPacedLoopDecision(summaries, [
      { name: LOOP_DECISION_TOOL_NAME, args: { ...args, delaySeconds: 120 }, success: true },
    ])).toBeNull();
    expect(extractSelfPacedLoopDecision(summaries, [
      { name: LOOP_DECISION_TOOL_NAME, args, success: true },
      { name: LOOP_DECISION_TOOL_NAME, args, success: false },
    ])).toBeNull();
    expect(extractSelfPacedLoopDecision(summaries, [
      { name: LOOP_DECISION_TOOL_NAME, args, success: true },
    ])).toEqual(args);
  });
});
