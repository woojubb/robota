/**
 * A run answers for ITS turn — issue #3209.
 *
 * The result was read from the whole conversation store. A turn that produced no text therefore
 * either threw a contract-violation error (first turn) or resolved with the PREVIOUS turn's answer
 * (every later turn), and `tokensUsed` re-counted every earlier call on every run. An aborted run
 * resolved `''` while history kept the partial text, and dropped the tools that had already run.
 *
 * Every case runs against both entry points: they are two entries into one turn (CORE-042).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AbstractPlugin } from '../../abstracts/abstract-plugin';
import { AbstractTool } from '../../abstracts/abstract-tool';
import { ExecutionService } from '../../services/execution-service';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { Robota } from '../robota';

import type {
  IPluginExecutionContext,
  IPluginExecutionResult,
} from '../../abstracts/abstract-plugin-types';
import type { IAgentConfig, IRunOptions } from '../../interfaces/agent';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IAIProvider, IChatOptions } from '../../interfaces/provider';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';
import type { ICoreExecutionResult } from '../../services/execution-types';
import type { TScriptedTurn } from '../../testing/scripted-provider';

const ENTRY_POINTS = ['run', 'runStream'] as const;
type TEntryPoint = (typeof ENTRY_POINTS)[number];

const PROVIDER_NAME = 'scripted-test-provider';

async function drive(
  robota: Robota,
  entry: TEntryPoint,
  input: string,
  options?: IRunOptions,
): Promise<string> {
  if (entry === 'run') {
    return robota.run(input, options);
  }
  const stream = robota.runStream(input, options);
  for (;;) {
    const next = await stream.next();
    if (next.done === true) {
      return next.value;
    }
  }
}

class RecordDecisionTool extends AbstractTool {
  calls = 0;

  override get schema(): IToolSchema {
    return {
      name: 'record_decision',
      description: 'records the decision',
      parameters: { type: 'object' as const, properties: {} },
    };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    this.calls += 1;
    return { success: true, data: { recorded: true } };
  }
}

class TokensUsedRecorder extends AbstractPlugin {
  readonly name = 'tokens-used-recorder';
  readonly version = '1.0.0';
  readonly tokensUsed: Array<number | undefined> = [];

  override async afterExecution(
    _context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> {
    this.tokensUsed.push(result.tokensUsed);
  }
}

function buildAgent(provider: IAIProvider, overrides: Partial<IAgentConfig> = {}): Robota {
  return new Robota({
    name: 'Turn Result Agent',
    aiProviders: [provider],
    defaultModel: { provider: PROVIDER_NAME, model: 'test-model' },
    logging: { level: 'silent', enabled: false },
    ...overrides,
  });
}

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

/**
 * Plays `before` as scripted turns, then answers the next call by streaming `partial` and waiting
 * for the run's signal — a model cut off mid-reply.
 */
function partialThenHangProvider(before: readonly TScriptedTurn[] = []): IAIProvider {
  const scripted = createScriptedProvider(before);
  let calls = 0;
  return {
    ...scripted.provider,
    async chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
      calls += 1;
      if (calls <= before.length) return scripted.provider.chat(messages, options);
      options?.onTextDelta?.('partial');
      return new Promise<TUniversalMessage>((_resolve, reject) => {
        const signal = options?.signal;
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      });
    },
  };
}

function lastAssistant(robota: Robota): TUniversalMessage | undefined {
  return [...robota.getHistory()].reverse().find((message) => message.role === 'assistant');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(ENTRY_POINTS)('turn-scoped run result — %s()', (entry) => {
  it('resolves an allowToolOnlyCompletion turn that ends in tool calls with an empty answer', async () => {
    // A real model sends `content: null` beside its tool calls, so the turn has no text at all.
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'record_decision', args: {} }] },
    ]);
    const tool = new RecordDecisionTool();
    const robota = buildAgent(scripted.provider, { tools: [tool] });

    const answer = await drive(robota, entry, 'decide', {
      allowToolOnlyCompletion: true,
      maxExecutionRounds: 1,
    });

    expect(answer).toBe('');
    expect(tool.calls).toBe(1);
    expect(scripted.requests).toHaveLength(1);
  });

  it("does not answer a tool-only turn with the previous turn's text", async () => {
    const scripted = createScriptedProvider([
      { text: 'first answer' },
      { toolCalls: [{ name: 'record_decision', args: {} }] },
    ]);
    const robota = buildAgent(scripted.provider, { tools: [new RecordDecisionTool()] });

    await drive(robota, entry, 'first');
    const second = await drive(robota, entry, 'decide', {
      allowToolOnlyCompletion: true,
      maxExecutionRounds: 1,
    });

    expect(second).toBe('');
  });

  it('counts only its own turn in tokensUsed', async () => {
    const scripted = createScriptedProvider([
      { text: 'one', usage: { inputTokens: 10, outputTokens: 5 } },
      { text: 'two', usage: { inputTokens: 20, outputTokens: 7 } },
    ]);
    const recorder = new TokensUsedRecorder();
    const robota = buildAgent(scripted.provider, { plugins: [recorder] });

    await drive(robota, entry, 'first');
    await drive(robota, entry, 'second');

    expect(recorder.tokensUsed).toEqual([15, 27]);
  });

  it('answers an aborted turn with the text history keeps for it', async () => {
    const controller = new AbortController();
    const robota = buildAgent(partialThenHangProvider());

    const answer = await drive(robota, entry, 'talk', {
      signal: controller.signal,
      onTextDelta: () => controller.abort(),
    });

    const committed = lastAssistant(robota);
    expect(committed?.state).toBe('interrupted');
    expect(committed?.content).toBe('partial');
    expect(answer).toBe('partial');
  });

  it('reports the tools that ran before the abort', async () => {
    const execute = vi.spyOn(ExecutionService.prototype, 'execute');
    const controller = new AbortController();
    const robota = buildAgent(
      partialThenHangProvider([{ toolCalls: [{ name: 'record_decision', args: {} }] }]),
      { tools: [new RecordDecisionTool()] },
    );

    await drive(robota, entry, 'act', {
      signal: controller.signal,
      onTextDelta: () => controller.abort(),
    });

    const result = (await execute.mock.results[0]?.value) as ICoreExecutionResult;
    expect(result.interrupted).toBe(true);
    expect(result.toolsExecuted).toEqual(['record_decision']);
  });
});
