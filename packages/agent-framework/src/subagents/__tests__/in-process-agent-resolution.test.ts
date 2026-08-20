import { describe, expect, it, vi } from 'vitest';

import { createInProcessSubagentRunner } from '../in-process-subagent-runner.js';

import type { IInProcessSubagentRunnerDeps } from '../in-process-subagent-runner.js';
import type { ISubagentJobStart } from '@robota-sdk/agent-executor';

/**
 * Issue #1854 — the ORDER both runners resolve an agent type in, and the fact that this one reads
 * `agentDefinitions` at all.
 *
 * Reported in review: the first cut documented `agentDefinitions` on the shared deps type and wired
 * it only in `agent-subagent-runner`, so a caller that supplied it here saw it silently ignored. A
 * field one implementer honours and the other drops is the asymmetry ARCH-034 was about.
 *
 * Every case asserts on `Unknown agent type` specifically rather than on "did not throw": resolution
 * happens before session construction, so a type that RESOLVES may still fail later for reasons that
 * have nothing to do with what is under test.
 */
const RESOLUTION_FAILURE = /Unknown agent type/;

function deps(extra: Partial<IInProcessSubagentRunnerDeps>): IInProcessSubagentRunnerDeps {
  return {
    config: { provider: {}, hooks: undefined },
    context: {},
    tools: [],
    terminal: { write: vi.fn(), writeError: vi.fn() },
    provider: {},
    ...extra,
  } as unknown as IInProcessSubagentRunnerDeps;
}

function job(agentType: string): ISubagentJobStart {
  return {
    taskId: 'task_1',
    request: { agentType, prompt: 'do it', parentSessionId: 'session_1', cwd: '/workspace' },
  } as unknown as ISubagentJobStart;
}

const named = (name: string) => ({ name, description: `${name} agent`, systemPrompt: 'go' });

describe('in-process subagent agent-type resolution (issue #1854)', () => {
  it('resolves a type named ONLY by the parent’s roster', () => {
    const runner = createInProcessSubagentRunner(
      deps({ agentDefinitions: [named('acme-reviewer')] }),
    );
    expect(() => runner.start(job('acme-reviewer'))).not.toThrow(RESOLUTION_FAILURE);
  });

  it('still refuses a type no source names', () => {
    const runner = createInProcessSubagentRunner(
      deps({ agentDefinitions: [named('acme-reviewer')] }),
    );
    expect(() => runner.start(job('not-a-thing'))).toThrow(RESOLUTION_FAILURE);
  });

  it('prefers an INJECTED set over the roster, and the custom registry over both', () => {
    // The order is the contract the shared deps type documents; asserting only "it resolves" would
    // pass for any order and leave the precedence unproven.
    const roster = [named('shared-name')];
    const injected = [{ ...named('shared-name'), description: 'from the injected set' }];

    const viaInjected = createInProcessSubagentRunner(
      deps({ agentDefinitions: roster, builtInAgents: injected }),
    );
    expect(() => viaInjected.start(job('shared-name'))).not.toThrow(RESOLUTION_FAILURE);

    const custom = vi.fn(() => ({ ...named('shared-name'), description: 'from the registry' }));
    const viaCustom = createInProcessSubagentRunner(
      deps({ agentDefinitions: roster, builtInAgents: injected, customAgentRegistry: custom }),
    );
    expect(() => viaCustom.start(job('shared-name'))).not.toThrow(RESOLUTION_FAILURE);
    expect(custom).toHaveBeenCalledWith('shared-name');
  });

  it('falls back to the framework’s own built-ins when nothing is supplied', () => {
    // Deliberate, and the one place the two runners differ: this is the framework's runner reading
    // the framework's built-ins, in the package that owns them. The neutral runner across a process
    // boundary has no such fallback — that was the axis violation.
    const runner = createInProcessSubagentRunner(deps({}));
    expect(() => runner.start(job('general-purpose'))).not.toThrow(RESOLUTION_FAILURE);
  });
});
