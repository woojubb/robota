/**
 * `/cd`: everything the session decides before a move, in one place (issue #3081).
 *
 * A move is a NEW session in the target directory, composed by the host the way it composes any
 * session there; this session only decides whether it may leave, where to, and what conversation
 * travels. It never mutates its own workspace (ARCH-043).
 */
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

import { evaluatePermission } from '@robota-sdk/agent-core';

import { buildForkedSessionRecord } from './interactive-session-fork-record.js';

import type { TForkSourceSession } from './interactive-session-fork-record.js';
import type { IWorkspaceMoveRequest } from '../command-api/host-adapters.js';
import type { IWorkspacePolicy } from '../workspace-trust/index.js';
import type { TPermissionMode } from '@robota-sdk/agent-core';

export interface IPrepareWorkspaceMoveInput {
  /** The path as the user typed it: absolute, relative to the current directory, or `~`-rooted. */
  readonly requestedPath: string;
  readonly workspace: IWorkspacePolicy;
  /** A turn is running: a move now would straddle a tool call. */
  readonly executing: boolean;
  /** Background tasks that have not finished; they belong to this session and would not survive. */
  readonly liveBackgroundTasks: number;
  readonly permissionMode: TPermissionMode;
  readonly rules: {
    readonly allow: readonly string[];
    readonly deny: readonly string[];
    readonly ask: readonly string[];
  };
  readonly source: TForkSourceSession;
  readonly sessionName: string;
  readonly homeDirectory?: string;
}

function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`;
  return path;
}

/** Check a `/cd` and build what the host needs to carry it out; throws the reason to refuse. */
export function prepareWorkspaceMove(input: IPrepareWorkspaceMoveInput): IWorkspaceMoveRequest {
  if (input.executing) {
    throw new Error('Finish or cancel the current turn before moving to another directory.');
  }
  if (input.liveBackgroundTasks > 0) {
    throw new Error(
      `${input.liveBackgroundTasks} background task(s) are still running in this directory and ` +
        'would not survive the move. Wait for them or cancel them first.',
    );
  }
  const requested = input.requestedPath.trim();
  if (requested === '') throw new Error('Usage: /cd <directory>');
  const expanded = expandHome(requested, input.homeDirectory ?? homedir());
  const absolute = isAbsolute(expanded) ? expanded : resolve(input.workspace.cwd, expanded);
  let targetCwd: string;
  try {
    targetCwd = realpathSync(absolute);
  } catch {
    throw new Error(`No such directory: ${absolute}`);
  }
  if (!statSync(targetCwd).isDirectory()) throw new Error(`Not a directory: ${targetCwd}`);
  if (targetCwd === realpathSync(input.workspace.cwd)) {
    throw new Error(`Already in ${targetCwd}.`);
  }
  // The user asked for this move themselves, so only a DENY refuses it; an ask rule is answered by
  // the command itself.
  const decision = evaluatePermission('Cd', { path: targetCwd }, input.permissionMode, input.rules);
  if (decision === 'deny') {
    throw new Error(`Moving to ${targetCwd} is denied by a permission rule.`);
  }
  return {
    fromCwd: input.workspace.cwd,
    targetCwd,
    record: buildForkedSessionRecord({
      source: input.source,
      name: input.sessionName,
      cwd: targetCwd,
    }),
    restricted: input.workspace.projectAccess.status === 'restricted',
  };
}

/** The instructions a move's target loaded, as `IContextFileEntry` carries them. */
export interface IWorkspaceMoveInstructions {
  readonly filePath: string;
  readonly content: string;
}

/**
 * The one message a `/cd` target appends. The system prompt is kept as recorded — rebuilding it
 * would cost every provider's prompt cache — so this message is what tells the model the directory
 * changed and which project instructions now apply. It is a user-role message: a system-role one
 * is folded into the system prompt by some providers, which is exactly the rebuild it avoids.
 */
export function buildWorkspaceMoveNotice(input: {
  readonly fromCwd: string;
  readonly toCwd: string;
  readonly restricted: boolean;
  readonly instructions: readonly IWorkspaceMoveInstructions[];
}): string {
  const lines = [
    '<workspace-move>',
    `The working directory has moved from ${input.fromCwd} to ${input.toCwd}. This supersedes the ` +
      'working directory stated earlier in this conversation and in the system prompt; tools now ' +
      `resolve paths against ${input.toCwd}.`,
  ];
  if (input.restricted) {
    lines.push(
      'This project is not trusted, so no project instructions, settings or skills were loaded ' +
        'for it. Instructions loaded for the previous directory no longer apply.',
    );
  } else if (input.instructions.length === 0) {
    lines.push(
      `No project instructions were found for ${input.toCwd}. Instructions loaded for the ` +
        'previous directory no longer apply.',
    );
  } else {
    lines.push(
      `Project instructions for ${input.toCwd}, which replace any loaded for the previous directory:`,
    );
    for (const file of input.instructions) lines.push('', `## ${file.filePath}`, file.content.trim());
  }
  lines.push('</workspace-move>');
  return lines.join('\n');
}
