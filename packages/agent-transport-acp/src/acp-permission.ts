/** How a session permission prompt becomes an ACP permission request and its answer becomes a decision. */

import { acpToolTitle } from './acp-tool-mapping.js';

import type { PermissionOption, RequestPermissionOutcome } from '@agentclientprotocol/sdk';
import type { TToolArgs } from '@robota-sdk/agent-core';
import type {
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
  const title = acpToolTitle(event.toolName, event.diffFile ?? summaryArg(event.toolArgs));
  return event.requester ? `${event.requester.label}: ${title}` : title;
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
