import { afterEach, describe, expect, it, vi } from 'vitest';

import { runPrintMode } from '../print-mode.js';

import type { IOrgPolicy } from '@robota-sdk/agent-framework';

const seen = vi.hoisted(() => vi.fn());

vi.mock('@robota-sdk/agent-framework', () => ({
  HeadlessInteractionChannel: class {
    constructor(options: unknown) {
      seen(options);
    }

    async run(): Promise<void> {}

    async runGoal(): Promise<void> {}

    getExitCode(): number {
      return 0;
    }
  },
}));

class ExitSentinel extends Error {}

describe('print and goal session-capability projection', () => {
  afterEach(() => {
    seen.mockClear();
    vi.restoreAllMocks();
  });

  it.each([
    { goal: undefined, positional: ['hello'] },
    { goal: 'complete the task', positional: [] },
  ])(
    'forwards policy and response format to the headless channel for $goal',
    async ({ goal, positional }) => {
      const orgPolicy: IOrgPolicy = {
        blockedCommands: ['clear'],
        adminContact: 'ops@example.test',
      };
      const responseFormat = { type: 'json_object' as const };
      const preset = {
        temperature: 0.37,
        maxOutputTokens: 481,
        language: 'ko',
        systemPrompt: 'Preset seed',
        responseFormat,
      };
      vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new ExitSentinel('exit');
      });

      await expect(
        runPrintMode(
          '/work',
          { goal, positional, outputFormat: 'text' } as never,
          {} as never,
          {} as never,
          [],
          {} as never,
          [],
          {},
          [],
          {} as never,
          {},
          preset,
          {},
          undefined,
          orgPolicy,
        ),
      ).rejects.toBeInstanceOf(ExitSentinel);

      expect(seen).toHaveBeenCalledOnce();
      expect(seen.mock.calls[0]?.[0]).toMatchObject({
        orgPolicy,
        temperature: 0.37,
        maxOutputTokens: 481,
        language: 'ko',
        presetSystemPrompt: 'Preset seed',
        responseFormat,
      });
    },
  );
});
