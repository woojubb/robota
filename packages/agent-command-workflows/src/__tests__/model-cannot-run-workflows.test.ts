import { describe, expect, it, vi } from 'vitest';

import { createWorkflowsCommandModule } from '../workflows-command-module.js';

import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import type { TCommandInvocationSource } from '@robota-sdk/agent-interface-command';

/**
 * CMD-006 — the per-subcommand `modelInvocable` flag must actually gate the model path.
 *
 * It was DECORATIVE: declared in the registry and read by nothing. The framework gates the model
 * path per TOP-LEVEL command name, and `/workflows` is model-invocable because the model is meant
 * to author workflows — so a model-issued `workflows run <file>` inherited that and executed an
 * arbitrary on-disk DAG (LLM, http and file nodes) with no prompt.
 *
 * These assert the gate on the DISPATCHER, which is where the per-subcommand flag can be read at
 * all — the framework only ever sees `robota_command_workflows` with a free-form args string.
 */
/**
 * The published conformant double, with only the capability under test overridden.
 *
 * A hand-rolled partial cast to the host contract would be a re-implementation nothing checks
 * against the real one — and the contract-cast ratchet says so, which is how the first draft of
 * this file was caught. The return type is inferred rather than annotated with the aggregate, for
 * the reason the aggregate-naming scan gives: naming it takes the whole surface instead of the role
 * actually used.
 */
function hostContext(source: TCommandInvocationSource, cwd = '/w') {
  return createTestCommandHost({ cwd, overrides: { getCommandInvocationSource: () => source } });
}

function systemCommand() {
  const [command] = createWorkflowsCommandModule({}).systemCommands ?? [];
  if (command === undefined) throw new Error('the workflows module registered no system command');
  return command;
}

describe('CMD-006 — a model may not execute an on-disk workflow', () => {
  it.each(['run', 'validate', 'list', 'catalog'])(
    'refuses `workflows %s` from the model',
    async (sub) => {
      const result = await systemCommand().execute(hostContext('model'), `${sub} some.dag.json`);

      expect(result.success).toBe(false);
      expect(result.message).toContain('may not run');
    },
  );

  it('the refusal says WHY, and what to do instead', async () => {
    // A refusal an operator cannot act on is a dead end. This one names the reason (the subcommand
    // executes or inspects an on-disk workflow) and the two ways forward.
    const result = await systemCommand().execute(hostContext('model'), 'run some.dag.json');

    expect(result.message).toContain('LLM, http and');
    expect(result.message).toContain('workflows create');
  });

  it('the model may still AUTHOR — `create` is what it is meant to use', async () => {
    const result = await systemCommand().execute(hostContext('model'), 'create');

    expect(result.message ?? '').not.toContain('may not run');
  });

  it('a user-typed `workflows run` is NOT gated by this', async () => {
    // The gate is about WHO asked, not about what the subcommand does. An operator running their
    // own workflow is the feature.
    const result = await systemCommand().execute(hostContext('user'), 'run missing.dag.json');

    expect(result.message ?? '').not.toContain('may not run');
  });

  it('an unknown subcommand still gets the dispatcher’s own answer, not this gate', async () => {
    // One place decides what exists. A gate that also answered "unknown" would be a second
    // vocabulary to keep in step.
    const result = await systemCommand().execute(hostContext('model'), 'nonsense');

    expect(result.message).toContain('Unknown subcommand');
  });
});
