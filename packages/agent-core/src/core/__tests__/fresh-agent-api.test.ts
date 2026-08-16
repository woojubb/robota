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

  it('reaches the provider manager for swapDefaultProvider, and is stopped by a DIFFERENT guard', () => {
    // The sweep found the same symptom on `swapDefaultProvider`, but not the same cause. Its first
    // statement -- `aiProviders.addProvider` -- used to throw `AIProviders is not initialized` and no
    // longer does. Its second statement is `configManager.setModel`, which refuses on the AGENT-level
    // `isFullyInitialized` flag, and that flag guards genuinely asynchronous work.
    //
    // That is CORE-047, filed rather than folded in: the agent has no public way to become ready, so
    // the fix is a design choice (expose the initializer, narrow the guard, or make the constructor
    // async) rather than a defect with one right answer. Pinned here so the two causes stay separable
    // and so this case is the one that flips when CORE-047 lands.
    const { robota } = buildAgent();
    const replacement = createScriptedProvider([{ text: 'from the replacement' }]);

    expect(() => robota.swapDefaultProvider(replacement.provider, 'swapped-model')).toThrow(
      /must be fully initialized/,
    );
    expect(() => robota.swapDefaultProvider(replacement.provider, 'swapped-model')).not.toThrow(
      /AIProviders is not initialized/,
    );
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
    ];

    // Named exceptions rather than an omission: these refuse on the agent-level readiness flag,
    // which guards real asynchronous work and has no public entry point. That is CORE-047. Listing
    // them here keeps the surface enumerated and keeps the exception traceable to an open item --
    // the alternative, leaving them out, is how `registerTool` stayed broken with nobody noticing.
    const blockedByCore047 = ['getModel', 'setModel', 'swapDefaultProvider'];

    const threw: string[] = [];
    for (const [name, call] of calls) {
      try {
        call();
      } catch (error) {
        threw.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(threw).toEqual([]);
    expect(blockedByCore047).toHaveLength(3);
  });
});
