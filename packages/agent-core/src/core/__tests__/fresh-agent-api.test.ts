/**
 * CORE-045 — the synchronous public API of a freshly constructed agent.
 *
 * `Robota`'s managers were constructed in its constructor but only initialized by the first run, and
 * every guarded manager method refused until then. So `registerTool`, `unregisterTool` and the first
 * statement of `swapDefaultProvider` threw `"Tools is not initialized"` /
 * `"AIProviders is not initialized"` on an agent that had just been built — the exact moment a caller
 * reaches for them.
 *
 * The guard protected nothing at that point: both managers' `doInitialize` only emit a debug log, so
 * there was no asynchronous state to race. What the flag genuinely marks is teardown, which is why
 * the disposed case below still refuses — with a message that says so.
 *
 * Nothing in the repository called these methods, which is why the break survived. The enumeration
 * at the end exists so a future synchronous method cannot join them unnoticed.
 */

import { describe, expect, it } from 'vitest';

import { AbstractTool } from '../../abstracts/abstract-tool';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { Robota } from '../robota';

import type { IAgentConfig } from '../../interfaces/agent';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';

const PROVIDER_NAME = 'scripted-test-provider';

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

function buildAgent(): { robota: Robota; scripted: ReturnType<typeof createScriptedProvider> } {
  const scripted = createScriptedProvider([{ text: 'done' }, { text: 'done again' }]);
  const config: IAgentConfig = {
    name: 'Fresh Agent',
    aiProviders: [scripted.provider],
    defaultModel: { provider: PROVIDER_NAME, model: 'test-model' },
    logging: { level: 'silent', enabled: false },
  };
  return { robota: new Robota(config), scripted };
}

describe('CORE-045 — a freshly constructed agent', () => {
  it('accepts registerTool before any run, and the tool reaches the model', async () => {
    const { robota, scripted } = buildAgent();

    // Threw `Tools is not initialized` here. The second half matters as much as the first: a
    // register that succeeds but never reaches the provider would be the same defect, quieter.
    robota.registerTool(new EchoTool());
    await robota.run('hello');

    expect(scripted.chatOptions[0]?.tools?.map((t) => t.name)).toContain('echo_tool');
  });

  it('accepts unregisterTool before any run', async () => {
    const { robota, scripted } = buildAgent();

    robota.registerTool(new EchoTool());
    robota.unregisterTool('echo_tool');
    await robota.run('hello');

    expect(scripted.chatOptions[0]?.tools ?? []).toHaveLength(0);
  });

  it('swapDefaultProvider works on a fresh agent — the case that flipped when CORE-047 landed', () => {
    // The sweep found the same symptom here as on `registerTool`, but not the same cause. Its first
    // statement -- `aiProviders.addProvider` -- threw `AIProviders is not initialized`, which CORE-045
    // fixed. Its second -- `configManager.setModel` -- refused on the AGENT-level
    // `isFullyInitialized` flag, and that was filed separately as CORE-047 because the flag looked
    // like it guarded real asynchronous work.
    //
    // It did not. The state `setModel` needed -- the provider registry and the current
    // (provider, model) pair -- was established synchronously from already-validated config, merely
    // written inside the async initializer. CORE-047 moved both steps into the constructor, so the
    // guard protected nothing and is gone. Kept as an explicit case rather than folded into the
    // enumeration below, because the two causes reaching one symptom is the thing worth pinning.
    const { robota } = buildAgent();
    const replacement = createScriptedProvider([{ text: 'from the replacement' }]);

    expect(() => robota.swapDefaultProvider(replacement.provider, 'swapped-model')).not.toThrow();
    expect(robota.getModel().provider).toBe(replacement.provider.name);
  });

  it('still refuses after the agent is destroyed, and says THAT rather than "not initialized"', async () => {
    // The flag's real meaning. Reporting teardown as "not initialized" is what sent the original
    // investigation looking for a missing await that did not exist.
    const { robota } = buildAgent();
    await robota.run('hello');
    await robota.destroy();

    expect(() => robota.registerTool(new EchoTool())).toThrow(/disposed/);
  });

  it('every synchronous public method works on an agent that has never run', async () => {
    // The enumeration: nothing in the repository called `registerTool`, which is how a public method
    // stayed broken. A method added to this surface without a caller must at least be exercised here.
    const { robota } = buildAgent();

    const calls: Array<[string, () => unknown]> = [
      ['getConfig', () => robota.getConfig()],
      ['getHistory', () => robota.getHistory()],
      ['getFullHistory', () => robota.getFullHistory()],
      ['getSystemPrompt', () => robota.getSystemPrompt()],
      ['getStats', () => robota.getStats()],
      ['registerTool', () => robota.registerTool(new EchoTool())],
      ['unregisterTool', () => robota.unregisterTool('echo_tool')],
      ['updateSystemPrompt', () => robota.updateSystemPrompt('be brief')],
      // CORE-047: these three were listed as named exceptions here, blocked on the agent-level
      // readiness flag. That flag turned out to guard state the constructor could establish, so they
      // are now part of the enumerated surface rather than an exception to it. The surface has no
      // named exceptions left; if one is ever added again it belongs in a list like the old one, not
      // omitted -- an omission is how `registerTool` stayed broken with nobody noticing.
      ['getModel', () => robota.getModel()],
      ['setModel', () => robota.setModel({ provider: PROVIDER_NAME, model: 'another-model' })],
      [
        'swapDefaultProvider',
        () => robota.swapDefaultProvider(createScriptedProvider([]).provider, 'swapped-model'),
      ],
    ];

    const threw: string[] = [];
    for (const [name, call] of calls) {
      try {
        call();
      } catch (error) {
        threw.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(threw).toEqual([]);
  });
});
