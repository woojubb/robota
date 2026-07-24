/**
 * CMD-004 Phase 2 Stage C — TC-10 (/rename persistence proof, TUI half).
 *
 * The spec gates deleting the TUI `renameSession` mutation on a red-first proof that `/rename`
 * (1) persists HOST-side — the session executes the rename, no TUI handler involved — and
 * (2) updates the TUI title via the broadcast `session_renamed` event.
 *
 * Runs the REAL TuiInteractionChannel over a real InteractiveSession (scripted provider) with a
 * command module mirroring the real `/rename` contract (returns the `session-rename` host action
 * on the split contract — Stage E deleted the legacy effect union).
 *
 * Red-first evidence: against pre-Stage-C code the broadcast half FAILED (the TUI only reacted to
 * the legacy effect, which Stage B strips after host execution — so the title never updated).
 */

import { Text } from 'ink';
import { render } from 'ink-testing-library';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createScriptedProvider } from '@robota-sdk/agent-transport/testing';
import { useSideEffects } from '../hooks/useSideEffects.js';
import { TuiCliAdapterProvider } from '../tui-cli-adapter-context.js';
import { TuiInteractionChannel } from '../TuiInteractionChannel.js';

import type { IUseSideEffectsOptions } from '../hooks/side-effects-types.js';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import type { ICommandModule } from '@robota-sdk/agent-framework';

const READY_DEADLINE_MS = 10_000;
const POLL_MS = 25;

async function waitUntil(predicate: () => boolean, deadlineMs = READY_DEADLINE_MS): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  expect(predicate()).toBe(true);
}

/** Mirrors the real session-command `/rename` contract: NO mutation in the command, host action only. */
const renameModule: ICommandModule = {
  name: 'stage-c-rename-proof',
  systemCommands: [
    {
      name: 'rename',
      description: 'Rename the session (test mirror of the real /rename contract)',
      requiresPermission: false,
      execute: (_context, args) => ({
        success: true,
        message: `Session renamed to "${args}".`,
        hostActions: [{ type: 'session-rename', name: args }],
      }),
    },
  ],
};

function fakeCliAdapter(): ITuiCliAdapter {
  return {
    getUserSettingsPath: () => '/tmp/fake-settings.json',
    readSettings: () => ({}),
    reloadPluginCommandSource: vi.fn(),
    applyActiveModelChange: vi.fn().mockReturnValue({ applied: true }),
    getGitBranch: vi.fn().mockReturnValue(undefined),
    getProviderDisplayName: vi.fn((type: string) => type),
  } as unknown as ITuiCliAdapter;
}

describe('TC-10 — /rename persists host-side and the TUI title follows the broadcast', () => {
  let channel: TuiInteractionChannel | undefined;

  afterEach(async () => {
    await channel?.stop();
    channel = undefined;
  });

  it('host executes the rename; the TUI updates its title from session_renamed only', async () => {
    const scripted = createScriptedProvider([{ text: 'unused in this test' }]);
    channel = new TuiInteractionChannel({
      cwd: process.cwd(),
      provider: scripted.provider,
      sessionName: 'Before Rename',
      commandModules: [renameModule],
    });
    await channel.start();
    const session = channel.getSession();
    await waitUntil(() => {
      try {
        session.getContextState();
        return true;
      } catch {
        return false; // allow-fallback: session init is asynchronous; poll until it is ready
      }
    });

    const setSessionName = vi.fn();
    const options = {
      cwd: process.cwd(),
      interactiveSession: session,
      commandEffectQueue: {
        enqueueEffects: () => undefined,
        drain: () => undefined,
        clear: () => undefined,
      },
      addEntry: vi.fn(),
      baseHandleSubmit: (input: string) => channel!.handleInput(input),
      setSessionName,
      setStatusLineSettings: vi.fn(),
      refreshStatusLineSettings: vi.fn(),
      showSessionPickerOnStart: false,
    } as unknown as IUseSideEffectsOptions;

    const submitRef: { current: ((input: string) => Promise<void>) | null } = { current: null };
    function Probe(): React.ReactElement {
      const state = useSideEffects(options);
      submitRef.current = state.handleSubmit;
      return <Text>probe</Text>;
    }
    const instance = render(
      <TuiCliAdapterProvider value={fakeCliAdapter()}>
        <Probe />
      </TuiCliAdapterProvider>,
    );
    await waitUntil(() => submitRef.current !== null);

    await submitRef.current!('/rename Stage C Proof');

    // (1) HOST persistence: the session itself performed the rename — no TUI mutation handler.
    expect(session.getName()).toBe('Stage C Proof');

    // (2) Title update via the broadcast `session_renamed` (the dual-carry legacy effect is
    // stripped by the host applier, so this is the ONLY path that can update the title).
    await waitUntil(() => setSessionName.mock.calls.length > 0, 3000);
    expect(setSessionName).toHaveBeenCalledWith('Stage C Proof');

    instance.unmount();
  });
});
