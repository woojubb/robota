/**
 * `/sandbox`: see how shell commands are confined and change it (issue #3082).
 *
 * The OS sandbox is live — the choice applies to the next command — and is saved in the user
 * settings so the next session starts the same way.
 */
import { selectAction } from '@robota-sdk/agent-core';

import type {
  ICommandHostAdapterAccess,
  ICommandHostUserInteraction,
  ICommandSandboxStatus,
  TSandboxCommandMode,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

export const SANDBOX_MODES: readonly {
  readonly mode: TSandboxCommandMode;
  readonly description: string;
}[] = [
  { mode: 'auto-allow', description: 'Confine shell commands; confined ones run without a prompt' },
  { mode: 'regular', description: 'Confine shell commands; prompts work as usual' },
  { mode: 'off', description: 'Run shell commands on this machine, unconfined' },
];

function isSandboxMode(value: string): value is TSandboxCommandMode {
  return SANDBOX_MODES.some((entry) => entry.mode === value);
}

export function formatSandboxStatus(status: ICommandSandboxStatus): string {
  const lines = [
    `Sandbox: ${status.mode}${status.backend !== undefined ? ` (${status.backend})` : ''}`,
  ];
  if (status.unavailable !== undefined) {
    lines.push(
      status.mode === 'off'
        ? `Not available here: ${status.unavailable}.`
        : `Cannot run here: ${status.unavailable}. Commands run unconfined.`,
    );
  }
  if (status.mode !== 'off' && status.unavailable === undefined) {
    lines.push(
      'Writes are limited to the workspace and temp directories; settings and git hooks stay read-only.',
      `Network: ${status.network ? 'allowed' : 'blocked'}.`,
    );
    if (status.excludedCommands.length > 0) {
      lines.push(`Run unconfined: ${status.excludedCommands.join(', ')}.`);
    }
  }
  return lines.join('\n');
}

async function askForMode(
  context: ICommandHostUserInteraction,
  current: TSandboxCommandMode,
): Promise<string | undefined> {
  const ui = context.getUserInteraction();
  if (!ui) return undefined;
  const options = SANDBOX_MODES.map(({ mode, description }) => ({
    value: mode,
    label: mode === current ? `${mode} (current)` : mode,
    description,
  }));
  const response = await ui.ask(selectAction('sandbox', 'Sandbox mode', options));
  return response.type === 'answer' ? response.values[0] : undefined;
}

export async function executeSandboxCommand(
  context: ICommandHostAdapterAccess & ICommandHostUserInteraction,
  args: string,
): Promise<ICommandResult> {
  const adapter = context.getCommandHostAdapters?.().sandbox;
  if (adapter === undefined) {
    return { message: 'This host has no OS sandbox.', success: false };
  }
  const before = adapter.status();
  const requested = args.trim().split(/\s+/)[0] || (await askForMode(context, before.mode));
  if (requested === undefined || requested === '') {
    return { message: formatSandboxStatus(before), success: true, data: { ...before } };
  }
  if (!isSandboxMode(requested)) {
    return {
      message: `Unknown sandbox mode "${requested}". Valid: ${SANDBOX_MODES.map((entry) => entry.mode).join(' | ')}`,
      success: false,
    };
  }
  adapter.setMode(requested);
  const after = adapter.status();
  return {
    message: `Sandbox mode set to: ${requested}\n${formatSandboxStatus(after)}`,
    success: true,
    data: { ...after },
  };
}
