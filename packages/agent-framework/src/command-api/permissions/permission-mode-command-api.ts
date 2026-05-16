import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { ICommand } from '../types.js';
import type { ICommandHostContext } from '../host-context.js';
import type { ICommandPermissionModeAdapter } from '../host-adapters.js';

export const PERMISSION_MODE_COMMAND_DESCRIPTION = 'Show/change permission mode';
export const PERMISSION_MODE_ARGUMENT_HINT = 'plan | default | acceptEdits | bypassPermissions';
export const PERMISSIONS_COMMAND_DESCRIPTION = 'Show/change permission mode and permission rules';

export interface IPermissionsCommandState {
  readonly mode: TPermissionMode;
  readonly sessionAllowed: readonly string[];
}
export const VALID_PERMISSION_MODES: readonly TPermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'bypassPermissions',
];

export function buildPermissionModeSubcommands(source = 'mode'): ICommand[] {
  return [
    { name: 'plan', description: 'Plan only, no execution', source },
    { name: 'default', description: 'Ask before risky actions', source },
    { name: 'acceptEdits', description: 'Auto-approve file edits', source },
    { name: 'bypassPermissions', description: 'Skip all permission checks', source },
  ];
}

export function parsePermissionModeArgument(args: string): string | undefined {
  const mode = args.trim().split(/\s+/)[0];
  return mode !== undefined && mode.length > 0 ? mode : undefined;
}

export function isPermissionMode(value: string): value is TPermissionMode {
  return (VALID_PERMISSION_MODES as readonly string[]).includes(value);
}

export function formatInvalidPermissionModeMessage(): string {
  return `Invalid mode. Valid: ${VALID_PERMISSION_MODES.join(' | ')}`;
}

export function resolvePermissionModeAdapter(
  context: ICommandHostContext,
): ICommandPermissionModeAdapter {
  const adapter = context.getCommandHostAdapters?.().permissionMode;
  if (adapter !== undefined) {
    return adapter;
  }

  const runtime = context.getSession();
  return {
    getPermissionMode: () => runtime.getPermissionMode(),
    setPermissionMode: (mode) => runtime.setPermissionMode(mode),
    listSessionAllowedTools: () => runtime.getSessionAllowedTools(),
  };
}

export function readCommandPermissionMode(context: ICommandHostContext): TPermissionMode {
  return resolvePermissionModeAdapter(context).getPermissionMode();
}

export function writeCommandPermissionMode(
  context: ICommandHostContext,
  mode: TPermissionMode,
): void {
  resolvePermissionModeAdapter(context).setPermissionMode(mode);
}

export function listCommandSessionAllowedTools(context: ICommandHostContext): readonly string[] {
  return resolvePermissionModeAdapter(context).listSessionAllowedTools();
}

export function readCommandPermissionsState(
  context: ICommandHostContext,
): IPermissionsCommandState {
  return {
    mode: readCommandPermissionMode(context),
    sessionAllowed: listCommandSessionAllowedTools(context),
  };
}

export function formatCommandPermissionsMessage(state: IPermissionsCommandState): string {
  const lines = [`Permission mode: ${state.mode}`];
  if (state.sessionAllowed.length > 0) {
    lines.push(`Session-approved tools: ${state.sessionAllowed.join(', ')}`);
  } else {
    lines.push('No session-approved tools.');
  }
  return lines.join('\n');
}
