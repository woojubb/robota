/**
 * A failed forced summary fails the run with the provider's own error — issue #3209.
 *
 * When the round cap ends the loop on a tool round, one more call asks the model for a summary. Its
 * failure was logged and dropped, so the run threw the generic `[STRICT-POLICY]` error instead: no
 * class, status or code to decide a retry on, and a message that reads like an SDK bug. An aborted
 * summary call must end the turn the way an aborted round does: resolved as interrupted.
 *
 * Every case runs against both entry points: they are two entries into one turn (CORE-042).
 */

import { describe, expect, it } from 'vitest';

import { AbstractTool } from '../../abstracts/abstract-tool';
import { Robota } from '../robota';

import type { IRunOptions } from '../../interfaces/agent';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IAIProvider, IChatOptions } from '../../interfaces/provider';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';

const ENTRY_POINTS = ['run', 'runStream'] as const;
type TEntryPoint = (typeof ENTRY_POINTS)[number];

const PROVIDER_NAME = 'forced-summary-test-provider';

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

class HttpStatusError extends Error {
  override readonly name = 'HttpStatusError';
  constructor(readonly status: number) {
    super(`request rejected with ${status}`);
  }
}

class RecordDecisionTool extends AbstractTool {
  override get schema(): IToolSchema {
    return {
      name: 'record_decision',
      description: 'records the decision',
      parameters: { type: 'object' as const, properties: {} },
    };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return { success: true, data: { recorded: true } };
  }
}

/** Calls the tool on the first request; answers the forced summary request with `summary`. */
function toolThenSummaryProvider(
  summary: (options: IChatOptions | undefined) => Promise<TUniversalMessage>,
): IAIProvider {
  let calls = 0;
  return {
    name: PROVIDER_NAME,
    version: 'test',
    async chat(_messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
      calls += 1;
      if (calls > 1) return summary(options);
      return {
        id: 'tool-round',
        role: 'assistant',
        content: null,
        state: 'complete',
        timestamp: new Date(),
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'record_decision', arguments: '{}' },
          },
        ],
      };
    },
    async generateResponse() {
      return { content: '' };
    },
    supportsTools: () => true,
    validateConfig: () => true,
  };
}

function buildAgent(provider: IAIProvider): Robota {
  return new Robota({
    name: 'Forced Summary Agent',
    aiProviders: [provider],
    defaultModel: { provider: PROVIDER_NAME, model: 'test-model' },
    tools: [new RecordDecisionTool()],
    logging: { level: 'silent', enabled: false },
  });
}

describe.each(ENTRY_POINTS)('forced summary failure — %s()', (entry) => {
  it("rejects with the summary call's own error", async () => {
    const rejected = new HttpStatusError(400);
    const robota = buildAgent(toolThenSummaryProvider(() => Promise.reject(rejected)));

    const outcome = await drive(robota, entry, 'decide', { maxExecutionRounds: 1 }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(outcome).toBe(rejected);
    expect((outcome as HttpStatusError).status).toBe(400);
  });

  it('announces the failure record it adds to history', async () => {
    const robota = buildAgent(
      toolThenSummaryProvider(() => Promise.reject(new HttpStatusError(503))),
    );
    const appended: Array<Record<string, unknown>> = [];

    await drive(robota, entry, 'decide', {
      maxExecutionRounds: 1,
      onExecutionEvent: (event, data) => {
        if (event === 'history_mutation') appended.push(data);
      },
    }).catch(() => undefined);

    const last = appended.at(-1);
    expect(last?.['providerError']).toBe(true);
    expect(last?.['forcedSummary']).toBe(true);
    expect((last?.['message'] as TUniversalMessage | undefined)?.content).toBe(
      'Request failed: request rejected with 503',
    );
  });

  it.each([
    ['the run is cancelled during the summary call', true],
    ['the provider reports an abort of its own', false],
  ])('resolves as interrupted when %s', async (_case, cancelRun) => {
    const controller = new AbortController();
    const robota = buildAgent(
      toolThenSummaryProvider(() => {
        if (cancelRun) controller.abort();
        return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }),
    );

    const answer = await drive(robota, entry, 'decide', {
      maxExecutionRounds: 1,
      signal: controller.signal,
    });

    expect(answer).toBe('');
  });
});
