import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { ConversationAgent, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import type { IExecutionJournal } from '@robota-sdk/agent-core';
import type { ModelCallIntent, TurnServices, UsageReport } from '@robota-sdk/agent-roundtable';
// Imported from the package's PUBLIC entry, not a relative path: this is the surface a host
// actually gets, not an internal implementation detail.
import { meterJournal } from './index';

afterEach(() => {
  clearRegisteredToolProfiles();
});

function services(): TurnServices & { admitted: ModelCallIntent[]; recorded: UsageReport[] } {
  const admitted: ModelCallIntent[] = [];
  const recorded: UsageReport[] = [];
  return {
    admitted,
    recorded,
    admitModelCall: async (call) => {
      admitted.push(call);
    },
    recordUsage: async (report) => {
      recorded.push(report);
    },
  };
}

/** Never persisted or read back; only `meterJournal`'s own admission/reporting is under test. */
function discardingJournal(): IExecutionJournal {
  return { append: async () => {} };
}

describe('meterJournal, exported for a host-defined selector or participant', () => {
  it('records exactly one usage record per provider call a custom selector makes', async () => {
    const scripted = createScriptedProvider([{ text: 'speak: a' }]);
    const agent = new ConversationAgent({
      name: 'host-custom-selector',
      aiProviders: [scripted.provider],
      defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    });
    const svc = services();

    // A host's own selector — no `TurnSelector`/`runtimeSelector` from this package involved, just
    // the exported metering helper wrapping the journal handed to a plain `ConversationAgent#run`.
    async function customSelect(prompt: string): Promise<string> {
      const metered = meterJournal(discardingJournal(), svc);
      const response = await agent.run(prompt, {
        signal: new AbortController().signal,
        executionJournal: metered,
      });
      return response as string;
    }

    const reply = await customSelect('who should speak next?');

    expect(reply).toBe('speak: a');
    expect(scripted.requests).toHaveLength(1);
    expect(svc.admitted).toHaveLength(1);
    expect(svc.recorded).toHaveLength(1);
    expect(svc.recorded[0]).toMatchObject({ outcome: 'completed' });
  });
});
