/**
 * TEST-009 Phase 2: conversation + slash-command flows driven through `IAgentDriver`.
 *
 * Exercises the in-process driver (`createProgrammaticAgent`) against the REAL framework loop with the
 * scripted provider: multi-turn context, a slash command producing a `command-result`, and the CMD-004
 * ask seam (a command self-asks via `getUserInteraction()`, pre-answered through `queueUserAction`).
 * All assertions read the shared `InteractionEvent` stream the contract exposes.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { confirmAction, isConfirmed } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgrammaticAgent } from '../../programmatic/index.js';

import type { ICommandModule } from '@robota-sdk/agent-framework';
import type { IAgentDriver, InteractionEvent } from '@robota-sdk/agent-interface-transport';

function commandResults(
  events: readonly InteractionEvent[],
): Array<{ name: string; output: string }> {
  return events
    .filter(
      (e): e is Extract<InteractionEvent, { type: 'command-result' }> =>
        e.type === 'command-result',
    )
    .map((e) => ({ name: e.name, output: e.output }));
}

/** A read-only `/ping` command that returns a fixed result — no host adapters needed. */
const PING_MODULE: ICommandModule = {
  name: 'ping',
  systemCommands: [
    {
      name: 'ping',
      description: 'test ping',
      userInvocable: true,
      safety: 'read-only',
      requiresPermission: false,
      execute: () => ({ message: 'PONG', success: true }),
    },
  ],
};

/** A `/danger` command that self-asks for confirmation via the CMD-004 ask seam. */
const CONFIRM_MODULE: ICommandModule = {
  name: 'danger',
  systemCommands: [
    {
      name: 'danger',
      description: 'requires confirmation',
      userInvocable: true,
      safety: 'read-only',
      requiresPermission: false,
      lifecycle: 'inline',
      execute: async (context) => {
        const ui = context.getUserInteraction?.();
        const response = ui ? await ui.ask(confirmAction('danger', 'Are you sure?')) : undefined;
        if (!response || !isConfirmed(response)) {
          return { message: 'DANGER_CANCELLED', success: true };
        }
        return { message: 'DANGER_RAN', success: true };
      },
    },
  ],
};

describe('IAgentDriver conversation + slash flows (TEST-009 Phase 2)', () => {
  let cwd: string;
  let driver: IAgentDriver | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-flows-'));
  });
  afterEach(async () => {
    await driver?.stop();
    driver = undefined;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('carries multi-turn conversation context across sends', async () => {
    const scripted = createScriptedProvider([{ text: 'NOTED_42' }, { text: 'IT_WAS_42' }]);
    driver = createProgrammaticAgent({ provider: scripted.provider, cwd });
    await driver.start();

    await driver.send('Remember the number 42');
    expect(driver.lastAssistantText()).toBe('NOTED_42');

    await driver.send('What number?');
    expect(driver.lastAssistantText()).toBe('IT_WAS_42');
    expect(driver.assistantReplies()).toEqual(['NOTED_42', 'IT_WAS_42']);

    // The second request must carry the prior turn (real session context).
    const second = (scripted.requests[1] ?? []).map((m) => String(m.content)).join('\n');
    expect(second).toContain('Remember the number 42');
    expect(second).toContain('NOTED_42');
  });

  it('runs a slash command and surfaces a command-result event', async () => {
    const scripted = createScriptedProvider([{ text: 'unused' }]);
    driver = createProgrammaticAgent({
      provider: scripted.provider,
      cwd,
      commandModules: [PING_MODULE],
    });
    await driver.start();

    await driver.send('/ping');
    expect(commandResults(driver.events)).toEqual([{ name: 'ping', output: 'PONG' }]);
  });

  it('drives the ask seam: queueUserAction confirms a self-asking command; empty queue cancels it', async () => {
    const scripted = createScriptedProvider([{ text: 'unused' }, { text: 'unused' }]);
    driver = createProgrammaticAgent({
      provider: scripted.provider,
      cwd,
      commandModules: [CONFIRM_MODULE],
    });
    await driver.start();

    // Confirmed → the command runs (askUser resolved from the pre-supplied queue).
    driver.queueUserAction({ type: 'answer', values: ['yes'] });
    await driver.send('/danger');
    const ranAfterConfirm = commandResults(driver.events).filter(
      (c) => c.output === 'DANGER_RAN',
    ).length;
    expect(ranAfterConfirm).toBe(1);

    // Empty queue → askUser resolves `cancelled` → the command takes its cancel path (does NOT run).
    await driver.send('/danger');
    expect(commandResults(driver.events).filter((c) => c.output === 'DANGER_RAN').length).toBe(
      ranAfterConfirm,
    );
    expect(commandResults(driver.events).some((c) => c.output === 'DANGER_CANCELLED')).toBe(true);
  });
});
