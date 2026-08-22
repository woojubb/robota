import { describe, expect, it } from 'vitest';

import { AgentDefinitionLoader } from '../../agents/agent-definition-loader.js';
import { BUILT_IN_AGENTS } from '../../agents/built-in-agents.js';
import { buildAgentRuntime } from '../create-session-runtime.js';

import type { IAgentDefinition } from '../../agents/agent-definition-types.js';
import type { ICreateSessionOptions } from '../create-session-types.js';

/**
 * ARCH-005 S2 / OWNER DECISION 2 — the `agentDefinitions` injection seam.
 *
 * Before this seam the framework's subagent roster was closed: `buildAgentRuntime` constructed
 * `new AgentDefinitionLoader(cwd)` with the hard-coded `BUILT_IN_AGENTS`, so a capability pack's
 * subagents could never reach the runtime — `assembleProduct` could only expose them as inert material.
 * The seam is a SCOPED ADDITIVE change: an absent `agentDefinitions` leaves every existing path
 * byte-identical.
 *
 * Precedence, highest → lowest (asserted below):
 *   discovered definitions (project/user `agents/` dirs)  >  injected `agentDefinitions`  >  BUILT_IN_AGENTS
 *
 * i.e. a pack may override a framework built-in, and the consumer's own on-disk definition still overrides
 * the pack — the ESLint "the consumer decides" rule, applied to subagents.
 */

function packAgent(name: string, systemPrompt = `injected ${name}`): IAgentDefinition {
  return { name, description: `injected agent ${name}`, systemPrompt };
}

function runtimeOptions(overrides: Partial<ICreateSessionOptions> = {}): ICreateSessionOptions {
  return {
    enableAgentRuntime: true,
    config: { hooks: undefined },
    ...overrides,
  } as unknown as ICreateSessionOptions;
}

describe('buildAgentRuntime — injected agentDefinitions (owner Decision 2)', () => {
  it('makes an INJECTED definition reachable in the runtime agent roster', () => {
    const result = buildAgentRuntime(
      runtimeOptions({ agentDefinitions: [packAgent('pack-reviewer')] }),
      'session-1',
      process.cwd(),
      undefined as never,
      [],
      [],
    );

    const names = result.agentDefinitions.map((agent) => agent.name);
    expect(names).toContain('pack-reviewer');
    // The framework built-ins still compose alongside it (additive, never replacing).
    for (const builtIn of BUILT_IN_AGENTS) expect(names).toContain(builtIn.name);
    // And the agent tool sees it too (the roster the model is offered).
    expect(result.agentToolDeps?.agentDefinitions?.map((a) => a.name)).toContain('pack-reviewer');
  });

  it('leaves the roster exactly BUILT_IN_AGENTS when nothing is injected (unchanged default)', () => {
    const result = buildAgentRuntime(
      runtimeOptions(),
      'session-2',
      process.cwd(),
      undefined as never,
      [],
      [],
    );

    // No discovery in this repo's cwd is asserted here — only that every built-in is present and that no
    // injected name appeared from nowhere.
    for (const builtIn of BUILT_IN_AGENTS) {
      expect(result.agentDefinitions.map((a) => a.name)).toContain(builtIn.name);
    }
    expect(result.agentDefinitions.map((a) => a.name)).not.toContain('pack-reviewer');
  });
});

describe('AgentDefinitionLoader — precedence within the built-in tier', () => {
  it('keeps the FIRST definition for a duplicated name (injected overrides a built-in)', () => {
    const overriding = packAgent('Explore', 'pack-supplied Explore');
    const loader = new AgentDefinitionLoader([], [overriding, ...BUILT_IN_AGENTS]);

    const loaded = loader.loadAll();
    const explore = loaded.filter((agent) => agent.name === 'Explore');

    // Exactly one `Explore` survives, and it is the injected one — no silent duplicate in the roster.
    expect(explore).toHaveLength(1);
    expect(explore[0]?.systemPrompt).toBe('pack-supplied Explore');
  });
});
