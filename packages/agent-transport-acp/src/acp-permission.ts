/** How a session permission prompt becomes an ACP permission request and its answer becomes a decision. */

import { resolve } from 'node:path';

import { acpFullToolTitle, acpToolKind } from './acp-tool-mapping.js';

import type {
  PermissionOption,
  RequestPermissionOutcome,
  ToolCallUpdate,
} from '@agentclientprotocol/sdk';
import type { TToolArgs } from '@robota-sdk/agent-core';
import type {
  IDiffLine,
  IPermissionRequestEvent,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-session';

const OPTION = {
  allowOnce: 'allow-once',
  allowSession: 'allow-session',
  allowProject: 'allow-project',
  reject: 'reject',
} as const;

/** The arguments a person recognises a call by, in the order the tools put them first. */
const SUMMARY_ARGS = ['command', 'file_path', 'path', 'url', 'pattern', 'query'] as const;

export function permissionOptions(canPersistProject: boolean): PermissionOption[] {
  return [
    { optionId: OPTION.allowOnce, name: 'Allow once', kind: 'allow_once' },
    { optionId: OPTION.allowSession, name: 'Allow for this session', kind: 'allow_always' },
    ...(canPersistProject
      ? [
          {
            optionId: OPTION.allowProject,
            name: 'Allow for this project',
            kind: 'allow_always' as const,
          },
        ]
      : []),
    { optionId: OPTION.reject, name: 'Reject', kind: 'reject_once' },
  ];
}

function summaryArg(args: TToolArgs): string | undefined {
  for (const key of SUMMARY_ARGS) {
    const value = args[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

export function permissionTitle(event: IPermissionRequestEvent): string {
  const title = acpFullToolTitle(event.toolName, event.diffFile ?? summaryArg(event.toolArgs));
  return event.requester ? `${event.requester.label}: ${title}` : title;
}

/** What the call was asked with, including a shell call's working directory when the session resolved one. */
function permissionRawInput(event: IPermissionRequestEvent): unknown {
  if (event.cwd === undefined || 'cwd' in event.toolArgs) return event.toolArgs;
  return { ...event.toolArgs, cwd: event.cwd };
}

/**
 * The file as it is before and after, rebuilt from the session's diff lines: context lines belong
 * to both sides. A diff with nothing on the old side is a new file, which ACP spells as no old text.
 */
function diffTexts(lines: readonly IDiffLine[]): { oldText?: string; newText: string } {
  const before: string[] = [];
  const after: string[] = [];
  for (const line of lines) {
    if (line.type === 'hunk') continue;
    if (line.type !== 'add') before.push(line.text);
    if (line.type !== 'remove') after.push(line.text);
  }
  return {
    ...(before.length > 0 ? { oldText: before.join('\n') } : {}),
    newText: after.join('\n'),
  };
}

/**
 * The tool call a permission request describes. The editor gets what the terminal shows: the
 * arguments whole, and for an edit the diff and the file it concerns. `cwd` roots a path the
 * session reported relative to the workspace, because ACP paths are absolute.
 */
export function permissionToolCall(
  event: IPermissionRequestEvent,
  toolCallId: string,
  cwd: string,
): ToolCallUpdate {
  const path = event.diffFile === undefined ? undefined : resolve(cwd, event.diffFile);
  return {
    toolCallId,
    title: permissionTitle(event),
    kind: acpToolKind(event.toolName),
    status: 'pending',
    rawInput: permissionRawInput(event),
    ...(path !== undefined && event.diffLines !== undefined
      ? { content: [{ type: 'diff' as const, path, ...diffTexts(event.diffLines) }] }
      : {}),
    ...(path !== undefined ? { locations: [{ path }] } : {}),
  };
}

/**
 * The editor's answer as a session decision. Anything the editor was not offered, or that is not
 * recognised, is a denial: an answer widens permission only by naming an option this request listed.
 */
export function permissionDecision(
  outcome: RequestPermissionOutcome,
  offered: readonly PermissionOption[],
): TPermissionResultValue {
  if (outcome.outcome !== 'selected') return false;
  if (!offered.some((option) => option.optionId === outcome.optionId)) return false;
  switch (outcome.optionId) {
    case OPTION.allowOnce:
      return true;
    case OPTION.allowSession:
      return 'allow-session';
    case OPTION.allowProject:
      return 'allow-project';
    default:
      return false;
  }
}
