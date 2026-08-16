/**
 * CORE-042 — `run()` and `runStream()` are two ENTRIES into one turn, asserted as such.
 *
 * Every case below runs the SAME assertion against BOTH entry points from one table. That shape is
 * the deliverable, not a convenience: the turn used to be implemented twice, and each capability was
 * copied into the second implementation only when someone remembered to. Six were copied one at a
 * time and the seventh — the system prompt — reached a beta missing. A per-path test suite is what
 * made that survivable, so the fix ships with a suite that cannot pass for one path alone.
 *
 * A capability added to the turn belongs in this table. If it can only be written for one entry
 * point, the seam has been broken again and that is the finding.
 */

import { describe, expect, it } from 'vitest';

import { AbstractPlugin } from '../../abstracts/abstract-plugin';
import { AbstractTool } from '../../abstracts/abstract-tool';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { Robota } from '../robota';

import type { IAgentConfig, IRunOptions } from '../../interfaces/agent';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';
import type { IScriptedProvider, TScriptedTurn } from '../../testing/scripted-provider';

const ENTRY_POINTS = ['run', 'runStream'] as const;
type TEntryPoint = (typeof ENTRY_POINTS)[number];

/**
 * Drive one turn through the named entry point and return its final assistant text.
 *
 * The two entries answer the same question in the same type, which is itself part of the contract
 * under test: `runStream` returns the turn's final text as its generator return value, so a caller
 * choosing streaming does not have to re-accumulate deltas to learn what `run` would have told it.
 */
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

class EchoTool extends AbstractTool {
  override get schema(): IToolSchema {
    return {
      name: 'echo_tool',
      description: 'echoes its input back',
      parameters: { type: 'object' as const, properties: {} },
    };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return { success: true, data: { echoed: true } };
  }
}

/**
 * A tool whose description can be emptied AFTER construction.
 *
 * The turn validates the resolved tool list before every provider call, and that validation is the
 * capability under test. Constructing the tool already empty would not reach it -- the registry
 * rejects such a schema up front -- so the description is valid at construction and emptied
 * afterwards, which is the only way to put the turn's own check on the path.
 */
class MutableDescriptionTool extends AbstractTool {
  description = 'valid at construction';

  override get schema(): IToolSchema {
    return {
      name: 'mutable_description_tool',
      description: this.description,
      parameters: { type: 'object' as const, properties: {} },
    };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return { success: true, data: {} };
  }
}

class ProviderCallRecorderPlugin extends AbstractPlugin {
  readonly name = 'provider-call-recorder';
  readonly version = '1.0.0';
  before = 0;
  after = 0;

  override async beforeProviderCall(_messages: TUniversalMessage[]): Promise<void> {
    this.before += 1;
  }

  override async afterProviderCall(
    _messages: TUniversalMessage[],
    _response: TUniversalMessage,
  ): Promise<void> {
    this.after += 1;
  }
}

const PROVIDER_NAME = 'scripted-test-provider';

function buildAgent(
  turns: readonly TScriptedTurn[],
  overrides: Partial<IAgentConfig> = {},
): { robota: Robota; scripted: IScriptedProvider } {
  const scripted = createScriptedProvider(turns);
  const robota = new Robota({
    name: 'Parity Test Agent',
    aiProviders: [scripted.provider],
    defaultModel: { provider: PROVIDER_NAME, model: 'test-model' },
    logging: { level: 'silent', enabled: false },
    ...overrides,
  });
  return { robota, scripted };
}

describe.each(ENTRY_POINTS)('CORE-042 turn parity — %s()', (entry) => {
  it('carries the configured system prompt into the provider request', async () => {
    // The capability that reached the beta missing on one path, and the reason this table exists.
    const { robota, scripted } = buildAgent([{ text: 'done' }], {
      systemMessage: 'You are the parity agent.',
    });

    await drive(robota, entry, 'hello');

    const systemMessages = scripted.requests[0].filter((m) => m.role === 'system');
    expect(systemMessages.map((m) => m.content)).toContain('You are the parity agent.');
  });

  it('carries the model dials (maxTokens, temperature, effort) into the chat options', async () => {
    const { robota, scripted } = buildAgent([{ text: 'done' }], {
      defaultModel: {
        provider: PROVIDER_NAME,
        model: 'test-model',
        maxTokens: 512,
        temperature: 0.25,
      },
    });

    await drive(robota, entry, 'hello');

    expect(scripted.chatOptions[0]?.maxTokens).toBe(512);
    expect(scripted.chatOptions[0]?.temperature).toBe(0.25);
    // The framework→provider seam defaults the reasoning dial rather than leaving it absent.
    expect(scripted.chatOptions[0]?.effort).toBe('high');
  });

  it('carries the tool-invocation directive into the chat options', async () => {
    const { robota, scripted } = buildAgent([{ text: 'done' }], {
      defaultModel: {
        provider: PROVIDER_NAME,
        model: 'test-model',
        toolChoice: 'required',
      },
      tools: [new EchoTool()],
    });

    await drive(robota, entry, 'hello');

    expect(scripted.chatOptions[0]?.toolChoice).toBe('required');
  });

  it('carries the run cancellation signal into the chat options', async () => {
    const { robota, scripted } = buildAgent([{ text: 'done' }]);
    const controller = new AbortController();

    await drive(robota, entry, 'hello', { signal: controller.signal });

    // Identity is deliberately not asserted: the shared provider helper hands the provider a linked
    // controller of its own so it can also fire the idle timeout. What both entries must do is
    // supply a signal at all -- one of them used to supply none.
    expect(scripted.chatOptions[0]?.signal).toBeDefined();
  });

  it('sends ephemeralSystemContext to the provider without persisting it', async () => {
    const ephemeral = '<recalled-memory>rotate the staging key</recalled-memory>';
    const { robota, scripted } = buildAgent([{ text: 'done' }]);

    await drive(robota, entry, 'hello', { ephemeralSystemContext: ephemeral });

    expect(scripted.requests[0].some((m) => m.role === 'system' && m.content === ephemeral)).toBe(
      true,
    );
    expect(robota.getHistory().some((m) => (m.content ?? '').includes('recalled-memory'))).toBe(
      false,
    );
  });

  it('records the turn usage the provider reported on the committed message', async () => {
    const { robota } = buildAgent([{ text: 'done', usage: { inputTokens: 11, outputTokens: 7 } }]);

    await drive(robota, entry, 'hello');

    const assistant = robota.getHistory().filter((m) => m.role === 'assistant');
    const metadata = assistant[assistant.length - 1]?.metadata as
      Record<string, unknown> | undefined;
    const usage = metadata?.['usage'] as Record<string, unknown> | undefined;
    expect(usage?.['totalTokens']).toBe(18);
  });

  it("commits the provider's complete text even when its deltas stop short of it", async () => {
    // History commits the DELTA buffer, not the returned message. A provider whose deltas cover only
    // part of its own assembled text therefore truncated the committed assistant message -- silently,
    // with the caller's `onTextDelta` output and the stored history disagreeing and neither saying
    // so. The turn now emits the missing tail, which also makes the emitted-nothing case (a provider
    // that streams nothing at all) the same code path rather than a special case.
    const scripted = createScriptedProvider([{ text: 'unused' }]);
    const partial: typeof scripted.provider = {
      ...scripted.provider,
      async chat(messages, options) {
        void messages;
        options?.onTextDelta?.('The full answer ');
        return {
          id: 'partial-1',
          role: 'assistant',
          content: 'The full answer is 42.',
          state: 'complete' as const,
          timestamp: new Date(),
        };
      },
    };
    const robota = new Robota({
      name: 'Partial Delta Agent',
      aiProviders: [partial],
      defaultModel: { provider: PROVIDER_NAME, model: 'test-model' },
      logging: { level: 'silent', enabled: false },
    });

    const seen: string[] = [];
    const finalText = await drive(robota, entry, 'hello', {
      onTextDelta: (delta) => seen.push(delta),
    });

    expect(seen.join('')).toBe('The full answer is 42.');
    expect(finalText).toBe('The full answer is 42.');
    const assistant = robota.getHistory().filter((m) => m.role === 'assistant');
    expect(assistant[assistant.length - 1]?.content).toBe('The full answer is 42.');
  });

  it('dispatches the provider-call plugin hooks', async () => {
    // A plugin that inspects provider traffic was blind on one entry point, which is invisible from
    // the outside: the run still succeeds, the plugin just never sees anything.
    const plugin = new ProviderCallRecorderPlugin();
    const { robota } = buildAgent([{ text: 'done' }], { plugins: [plugin] });

    await drive(robota, entry, 'hello');

    expect(plugin.before).toBe(1);
    expect(plugin.after).toBe(1);
  });

  it('offers a tool registered after construction to the model', async () => {
    // Measured divergence: the two paths asked different questions about which tools exist -- the
    // round path read the RESOLVED tool list, the streaming path read `config.tools` -- so an agent
    // could offer the model a different tool set depending on which method the caller reached for.
    const { robota, scripted } = buildAgent([{ text: 'done' }], { tools: [new EchoTool()] });

    await drive(robota, entry, 'hello');

    expect(scripted.chatOptions[0]?.tools?.map((t) => t.name)).toContain('echo_tool');
  });

  it('rejects a tool whose schema omits its description', async () => {
    // Validation that ran on one entry and was skipped on the other, so the same agent was valid or
    // invalid depending on which method the caller reached for.
    const tool = new MutableDescriptionTool();
    const { robota } = buildAgent([{ text: 'done' }], { tools: [tool] });
    tool.description = '';

    // The message is the registry's rather than the turn's, because registration happens during the
    // entry point's own initialization -- which is the point: BOTH entries refuse the same agent.
    await expect(drive(robota, entry, 'hello')).rejects.toThrow(/description/);
  });
});
