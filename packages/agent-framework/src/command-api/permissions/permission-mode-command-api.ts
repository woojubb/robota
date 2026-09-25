import type { ICommandPermissionModeAdapter, IPermissionRuleLayer } from '../host-adapters.js';
import type { ICommandHostAdapterAccess, ICommandHostSessionAccess } from '../host-roles.js';
import type { ICommand } from '../types.js';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { IPermissionDenial } from '@robota-sdk/agent-session';

export const PERMISSION_MODE_COMMAND_DESCRIPTION = 'Show/change permission mode';
export const PERMISSION_MODE_ARGUMENT_HINT =
  'plan | default | acceptEdits | bypassPermissions | auto';
export const PERMISSIONS_COMMAND_DESCRIPTION = 'Show/change permission mode and permission rules';

export type TPermissionRuleKind = 'deny' | 'ask' | 'allow';

/** The rules the gate reads, grouped under the place each one comes from. */
export interface IPermissionRuleGroup {
  /** A settings file, or {@link RUNTIME_RULE_SOURCE} for rules no settings layer declares. */
  readonly source: string;
  readonly scope?: string;
  readonly deny: readonly string[];
  readonly ask: readonly string[];
  readonly allow: readonly string[];
}

export interface IPermissionsCommandState {
  readonly mode: TPermissionMode;
  readonly sessionAllowed: readonly string[];
  readonly rules: readonly IPermissionRuleGroup[];
  readonly recentDenials: readonly IPermissionDenial[];
}

/** Where a rule the gate reads comes from when no settings layer declares it: a flag, a preset, a command. */
export const RUNTIME_RULE_SOURCE = 'this session (CLI flags, preset, commands)';

const RULE_KINDS: readonly TPermissionRuleKind[] = ['deny', 'ask', 'allow'];
export const VALID_PERMISSION_MODES: readonly TPermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'bypassPermissions',
  'auto',
];

export function buildPermissionModeSubcommands(source = 'mode'): ICommand[] {
  return [
    { name: 'plan', description: 'Plan only, no execution', source },
    { name: 'default', description: 'Ask before risky actions', source },
    { name: 'acceptEdits', description: 'Auto-approve file edits', source },
    { name: 'bypassPermissions', description: 'Skip all permission checks', source },
    { name: 'auto', description: 'A model classifier approves or blocks risky actions', source },
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
  context: ICommandHostAdapterAccess & ICommandHostSessionAccess,
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
    getPermissionRules: () => runtime.getPermissionRules(),
    listRecentDenials: () => runtime.getRecentPermissionDenials(),
    retryDenial: (index) => runtime.retryPermissionDenial(index),
  };
}

export function readCommandPermissionMode(
  context: ICommandHostAdapterAccess & ICommandHostSessionAccess,
): TPermissionMode {
  return resolvePermissionModeAdapter(context).getPermissionMode();
}

export function writeCommandPermissionMode(
  context: ICommandHostAdapterAccess & ICommandHostSessionAccess,
  mode: TPermissionMode,
): void {
  resolvePermissionModeAdapter(context).setPermissionMode(mode);
}

/**
 * Let the call behind a recent classifier denial (1-based, as `/permissions` numbers them) run once
 * when the model tries it again.
 */
export function retryCommandPermissionDenial(
  context: ICommandHostAdapterAccess & ICommandHostSessionAccess,
  position: number,
): IPermissionDenial | undefined {
  if (!Number.isInteger(position) || position < 1) return undefined;
  return resolvePermissionModeAdapter(context).retryDenial(position - 1);
}

export function listCommandSessionAllowedTools(
  context: ICommandHostAdapterAccess & ICommandHostSessionAccess,
): readonly string[] {
  return resolvePermissionModeAdapter(context).listSessionAllowedTools();
}

/**
 * Attribute every rule the gate reads to each settings layer that declares it, in layer order.
 * Only effective rules are listed — a layer's rule the session does not enforce is not shown as if
 * it were — and an effective rule no layer declares is attributed to the session itself.
 */
export function groupPermissionRulesBySource(
  effective: Readonly<Record<TPermissionRuleKind, readonly string[]>>,
  layers: readonly IPermissionRuleLayer[],
): IPermissionRuleGroup[] {
  const attributed = new Set<string>();
  const groups: IPermissionRuleGroup[] = [];
  for (const layer of layers) {
    const pick = (kind: TPermissionRuleKind): string[] =>
      layer[kind].filter((rule) => effective[kind].includes(rule));
    const group = {
      source: layer.source,
      scope: layer.scope,
      deny: pick('deny'),
      ask: pick('ask'),
      allow: pick('allow'),
    };
    for (const kind of RULE_KINDS)
      for (const rule of group[kind]) attributed.add(`${kind}\0${rule}`);
    if (RULE_KINDS.some((kind) => group[kind].length > 0)) groups.push(group);
  }
  const rest = (kind: TPermissionRuleKind): string[] =>
    [...new Set(effective[kind])].filter((rule) => !attributed.has(`${kind}\0${rule}`));
  const runtime = {
    source: RUNTIME_RULE_SOURCE,
    deny: rest('deny'),
    ask: rest('ask'),
    allow: rest('allow'),
  };
  if (RULE_KINDS.some((kind) => runtime[kind].length > 0)) groups.push(runtime);
  return groups;
}

export function readCommandPermissionsState(
  context: ICommandHostAdapterAccess & ICommandHostSessionAccess,
): IPermissionsCommandState {
  const adapter = resolvePermissionModeAdapter(context);
  const layers = context.getCommandHostAdapters?.().permissionRules?.readLayers() ?? [];
  return {
    mode: adapter.getPermissionMode(),
    sessionAllowed: adapter.listSessionAllowedTools(),
    rules: groupPermissionRulesBySource(adapter.getPermissionRules(), layers),
    recentDenials: adapter.listRecentDenials(),
  };
}

const DENIAL_REASON_LABEL: Readonly<Record<IPermissionDenial['reason'], string>> = {
  policy: 'denied by a rule or the mode',
  user: 'declined when asked',
  'no-approver': 'needed approval, none available',
  classifier: 'blocked by the auto-mode classifier',
};

function formatClock(at: number): string {
  const time = new Date(at);
  return [time.getHours(), time.getMinutes(), time.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

export function formatCommandPermissionsMessage(state: IPermissionsCommandState): string {
  const lines = [`Permission mode: ${state.mode}`, ''];
  if (state.rules.length === 0) {
    lines.push('Rules: none configured.');
  } else {
    lines.push('Rules (checked deny, then ask, then allow):');
    for (const group of state.rules) {
      lines.push(`  ${group.source}${group.scope !== undefined ? ` [${group.scope}]` : ''}`);
      for (const kind of RULE_KINDS) {
        if (group[kind].length > 0) lines.push(`    ${kind}: ${group[kind].join(', ')}`);
      }
    }
  }
  lines.push('');
  if (state.sessionAllowed.length > 0) {
    lines.push(`Approved this session ("allow always"): ${state.sessionAllowed.join(', ')}`);
  } else {
    lines.push('No session-approved tools.');
  }
  lines.push('');
  if (state.recentDenials.length === 0) {
    lines.push('Recent denials: none.');
  } else {
    lines.push('Recent denials (most recent first):');
    state.recentDenials.forEach((denial, index) => {
      const call =
        denial.argument !== undefined ? `${denial.toolName}(${denial.argument})` : denial.toolName;
      const why = DENIAL_REASON_LABEL[denial.reason];
      const detail = denial.detail !== undefined ? `: ${denial.detail}` : '';
      lines.push(`  ${index + 1}. ${formatClock(denial.at)}  ${call} — ${why}${detail}`);
    });
    if (state.recentDenials.some((denial) => denial.reason === 'classifier')) {
      lines.push(
        '  To let a blocked call run once when the model retries it: /permissions retry <n>',
      );
    }
  }
  return lines.join('\n');
}
