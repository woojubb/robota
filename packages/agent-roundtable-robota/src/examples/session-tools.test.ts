import { afterEach, describe, expect, it } from 'vitest';
import { clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import { runSessionTools } from './session-tools';

afterEach(() => {
  clearRegisteredToolProfiles();
});

describe('sessionParticipant tools example', () => {
  it('parks the paid tool for approval, runs it once after the host approves, and stays in budget', async () => {
    const { waiting, chargedWhileWaiting, result, charged, messages, usage } =
      await runSessionTools();
    expect(waiting.requests).toHaveLength(1);
    expect(waiting.requests[0]).toMatchObject({ kind: 'approval', data: { toolName: 'charge' } });
    expect(chargedWhileWaiting).toEqual([]);

    expect(result).toMatchObject({ status: 'limited', reason: 'turns' });
    expect(charged).toEqual(['A-1']);
    expect(messages).toEqual(['Charged once for A-1.']);

    expect(usage).toMatchObject({ settledCalls: 3, toolEffects: 1 });
    expect(usage.tokens).toMatchObject({ input: 120, output: 30 });
  });
});
