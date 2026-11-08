/**
 * Nothing the model runs can open the passphrase prompt. In a secure TUI session
 * whose keys are locked, every command the model may invoke and every tool the session gives it is
 * run, and the gate's terminal, the session's terminal handoff and the keys stay untouched.
 *
 * The commands and tools are enumerated from the session itself, so one added later is covered
 * without editing this test. The guarantee is structural (only the terminal UI's action modules can
 * mint a read request, and only the TUI holds the port); this is the backstop for a wiring that
 * would hand the gate to the model's side.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { KeyHolder } from '../../secure/key-holder.js';
import { fixtureKeyring } from '../../secure/__tests__/helpers.js';
import { createKeyringFileStore } from '@robota-sdk/agent-local-host';
import { buildCommandSetup } from '../../startup/command-setup.js';
import { keyCustodyChannelOf, productKeyCustody } from '../key-custody.js';
import { createProductCapabilityPacks, packCommandModuleNames } from '../product-profile.js';
import { overrideProductSecureMode, useProductKeyHolder } from '../session-sealing.js';
import { userPaths } from '../user-paths.js';

import type { IParsedCliArgs } from '../../utils/cli-args.js';
import type { ICommandModule } from '@robota-sdk/agent-framework';
import type { ITerminalHandoff } from '@robota-sdk/agent-interface-session';

const roots: string[] = [];
const harnesses: ScriptedSessionHarness[] = [];
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directory(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

/** A value a tool's schema accepts by type, chosen so nothing it does leaves the workspace. */
function probeValue(name: string, schema: { readonly type?: unknown } | undefined): unknown {
  switch (schema?.type) {
    case 'array':
      return [];
    case 'object':
      return {};
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return false;
    default:
      if (name === 'command') return 'true';
      if (/path/i.test(name)) return '{{cwd}}/probe.txt';
      return 'probe';
  }
}

/** Arguments for one call of `tool`: each required property, with a value of its type. */
function probeArgs(tool: {
  readonly parameters?: {
    readonly required?: readonly string[];
    readonly properties?: Record<string, { readonly type?: unknown }>;
  };
}): Record<string, unknown> {
  return Object.fromEntries(
    (tool.parameters?.required ?? []).map((name) => [
      name,
      probeValue(name, tool.parameters?.properties?.[name]),
    ]),
  );
}

async function secureTuiComposition() {
  const cwd = directory('secure-tui-model-reach-');
  const runtime = createTestProductRuntime('test-product', { HOME: cwd });
  overrideProductSecureMode(runtime, true);
  // The keyring file the gate would unlock exists, so a prompt reached would really open.
  const keyringStore = createKeyringFileStore({
    path: userPaths(runtime).keyring,
    root: runtime.layout.userRoot,
  });
  keyringStore.create((await fixtureKeyring()).keyring);
  const holder = new KeyHolder({ store: keyringStore, policy: { idleMs: 0 } });
  useProductKeyHolder(runtime, holder);
  const openTerminal = vi.fn(() => undefined);
  const custody = productKeyCustody(runtime, { openTerminal });
  if (custody === undefined)
    throw new Error('a secure TUI process with a key holder has a custody');

  const packs = createProductCapabilityPacks({ cwd }, runtime);
  const setup = buildCommandSetup(
    cwd,
    { noUpdateCheck: true } as Partial<IParsedCliArgs> as IParsedCliArgs,
    { productRuntime: runtime },
    '0.0.0-test',
    packCommandModuleNames(packs),
    undefined,
    undefined,
    undefined,
    undefined,
    custody.commands,
  );
  const commandModules: readonly ICommandModule[] = [
    ...setup.baseCommandModules,
    ...setup.fixedCommandModules,
    ...packs.flatMap((pack) => pack.commandModules ?? []),
  ];
  // The session's terminal can be handed over, so a prompt WOULD open if anything reached for it.
  const handovers = vi.fn();
  const terminalHandoff: ITerminalHandoff = {
    canHandoffTerminal: true,
    runWithTerminal: <T>(operation: () => Promise<T>): Promise<T> => {
      handovers();
      return operation();
    },
  };
  return { cwd, holder, custody, openTerminal, handovers, terminalHandoff, commandModules };
}

describe('a locked secure TUI session, driven by the model', () => {
  it('opens no prompt from any command or tool the model can run', async () => {
    const composition = await secureTuiComposition();
    const session = (turns: Parameters<typeof scriptedSession>[0]['turns']) => {
      const harness = scriptedSession({
        turns,
        cwd: composition.cwd,
        commandModules: composition.commandModules,
        terminalHandoff: composition.terminalHandoff,
      });
      harnesses.push(harness);
      composition.custody.setChannel(
        keyCustodyChannelOf({
          getSession: () => harness.session,
          stateManager: { addEntry: () => undefined },
        }),
      );
      return harness;
    };

    // The tools as this session gives them to the model, read from a session built the same way.
    const census = session([{ text: 'listed' }]);
    await census.submit('list your tools');
    const tools = census.session.getSession().getToolSchemas();
    expect(tools.length).toBeGreaterThan(0);

    const driven = session([
      { toolCalls: tools.map((tool) => ({ name: tool.name, args: probeArgs(tool) })) },
      ...Array.from({ length: 20 }, () => ({ text: 'done' })),
    ]);
    await driven.submit('use every tool you have');
    expect(
      driven
        .toolCalls()
        .map((call) => call.name)
        .sort(),
    ).toEqual(tools.map((tool) => tool.name).sort());

    // Every model-invocable command, bare, as the model's command route runs it — and the two
    // credential commands, which the model must not reach at all.
    const offered = new SystemCommandExecutor(
      composition.commandModules.flatMap((module) => [...(module.systemCommands ?? [])]),
    ).listModelInvocableCommands();
    expect(offered.length).toBeGreaterThan(0);
    for (const { name } of offered) await driven.session.executeModelCommand(name, '');
    const credentialAttempts = [
      await driven.session.executeModelCommand('unlock', ''),
      await driven.session.executeModelCommand('lock', ''),
    ];

    expect(composition.handovers).not.toHaveBeenCalled();
    expect(composition.openTerminal).not.toHaveBeenCalled();
    expect(composition.holder.isUnlocked).toBe(false);
    expect(credentialAttempts).toEqual([null, null]);
  }, 60_000);
});
