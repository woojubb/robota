/**
 * `allowToolOnlyCompletion` with a round that answers with neither a tool call nor text
 *
 * `allowToolOnlyCompletion` only WIDENS what counts as a valid finish: a round may end in a tool
 * call alone, with no final text after it. It must never make an ordinary, non-empty text-only
 * completion fail — that case already resolves normally (asserted below as a contrast). But a round
 * that produces NEITHER a tool call NOR any text is genuinely unanswered: without the flag it is
 * recovered by one more provider call (`forceSummaryCall`), and the flag is exactly what turns that
 * rescue off. Before the fix, that combination reached `robotaRun`'s CORE-020 invariant — "every
 * failed result must carry its error" — with no error attached, and threw the internal
 * `[STRICT-POLICY]` message instead of a typed, catchable error.
 *
 * Every case below runs through the public `Robota` API only (`run`/`runStream`), the same surface
 * an external consumer (e.g. a tool-calling decision agent) uses.
 */

import { describe, expect, it } from 'vitest';

import { EmptyCompletionError } from '../../utils/errors';
import { AbstractTool } from '../../abstracts/abstract-tool';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { Robota } from '../robota';

import type { IAgentConfig, IRunOptions } from '../../interfaces/agent';
import type { IExecutionJournal } from '../../interfaces/execution-journal';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';

const PROVIDER_NAME = 'scripted-test-provider';
const ENTRY_POINTS = ['run', 'runStream'] as const;
type TEntryPoint = (typeof ENTRY_POINTS)[number];

class NoopTool extends AbstractTool {
  override get schema(): IToolSchema {
    return {
      name: 'noop_tool',
      description: 'does nothing',
      parameters: { type: 'object' as const, properties: {} },
    };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return { success: true, data: {} };
  }
}

async function drive(
  robota: Robota,
  entry: TEntryPoint,
  input: string,
  options?: IRunOptions,
): Promise<string> {
  if (entry === 'run') return robota.run(input, options);
  const stream = robota.runStream(input, options);
  for (;;) {
    const next = await stream.next();
    if (next.done === true) return next.value;
  }
}

function buildAgent(text: string): {
  robota: Robota;
  scripted: ReturnType<typeof createScriptedProvider>;
} {
  const scripted = createScriptedProvider([{ text }]);
  const config: IAgentConfig = {
    name: 'Decision Agent',
    aiProviders: [scripted.provider],
    defaultModel: { provider: PROVIDER_NAME, model: 'test-model' },
    logging: { level: 'silent', enabled: false },
    tools: [new NoopTool()],
  };
  return { robota: new Robota(config), scripted };
}

function discardingJournal(): IExecutionJournal {
  return { append: async () => {} };
}

describe.each(ENTRY_POINTS)('allowToolOnlyCompletion, empty round — %s()', (entry) => {
  it('rejects with a typed EmptyCompletionError, not the internal [STRICT-POLICY] message', async () => {
    const { robota } = buildAgent('   ');

    const outcome = await drive(robota, entry, 'decide', {
      maxExecutionRounds: 1,
      allowToolOnlyCompletion: true,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(EmptyCompletionError);
    expect((outcome as EmptyCompletionError).message).not.toContain('STRICT-POLICY');
    expect((outcome as EmptyCompletionError).code).toBe('EMPTY_COMPLETION');
  });

  it('rejects the same way through the execution journal path', async () => {
    const { robota } = buildAgent('   ');

    const outcome = await drive(robota, entry, 'decide', {
      maxExecutionRounds: 1,
      allowToolOnlyCompletion: true,
      executionJournal: discardingJournal(),
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(EmptyCompletionError);
  });
});

describe('allowToolOnlyCompletion, ordinary text-only reply (contrast)', () => {
  it.each(ENTRY_POINTS)(
    'still completes normally with the reply text and no forced follow-up call — %s()',
    async (entry) => {
      const { robota, scripted } = buildAgent('just text, no tool call');

      const answer = await drive(robota, entry, 'decide', {
        maxExecutionRounds: 1,
        allowToolOnlyCompletion: true,
      });

      expect(answer).toBe('just text, no tool call');
      expect(scripted.requests).toHaveLength(1);
      const history = robota.getHistory();
      expect(history.at(-1)).toMatchObject({
        role: 'assistant',
        content: 'just text, no tool call',
      });
    },
  );
});
