/**
 * TERM-004: `/editor` — compose a message/prompt in `$EDITOR` via the terminal-handoff capability,
 * then return the saved text. The temp file is pre-filled with any args and removed afterward.
 *
 * The buffer is the composed message, so it is owner-only: a directory only the owner can enter,
 * holding a `0600` file. A relative prefix puts that directory under the operating-system temporary
 * directory; an absolute prefix names a host-owned location instead (`<directory>/<name prefix>`), which
 * a host that keeps no conversation content in shared directories supplies.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

import {
  createProcessScopedDirectory,
  removeDirectoryOnProcessExit,
} from '@robota-sdk/agent-core/node';

import { resolveEditor } from './resolve-editor.js';
import { spawnInherited } from '../shell/spawn-inherited.js';

import type {
  ICommandHostTerminalHandoff,
  ICommandHostWorkspace,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

export const EDITOR_COMMAND_DESCRIPTION =
  'Compose a message in $EDITOR (optionally pre-filled with `/editor <text>`), then return it.';
export const DEFAULT_EDITOR_TEMPORARY_DIRECTORY_PREFIX = 'agent-editor-';

function createEditorDirectory(prefix: string): string {
  if (isAbsolute(prefix)) return createProcessScopedDirectory(dirname(prefix), basename(prefix));
  return mkdtempSync(join(tmpdir(), prefix));
}

export async function executeEditorCommand(
  context: ICommandHostTerminalHandoff & ICommandHostWorkspace,
  args: string,
  temporaryDirectoryPrefix: string = DEFAULT_EDITOR_TEMPORARY_DIRECTORY_PREFIX,
): Promise<ICommandResult> {
  if (!context.canHandoffTerminal()) {
    return {
      message: 'An editor is unavailable here (no interactive terminal).',
      success: false,
    };
  }

  const editor = resolveEditor();
  const dir = createEditorDirectory(temporaryDirectoryPrefix);
  // A hangup or interrupt while the editor is open ends the process without reaching `finally`.
  const cancelExitRemoval = removeDirectoryOnProcessExit(dir);
  const file = join(dir, 'message.md');

  try {
    writeFileSync(file, args ?? '', { encoding: 'utf8', mode: 0o600 });
    const exitCode = await context.runWithTerminal(async () =>
      spawnInherited(editor.command, [...editor.args, file], context.getCwd()),
    );
    if (exitCode !== 0) {
      return {
        message: `Editor exited without saving (code ${exitCode}).`,
        success: false,
        data: { exitCode },
      };
    }
    const content = readFileSync(file, 'utf8').replace(/\s+$/u, '');
    if (content.length === 0) {
      return { message: 'Editor closed with empty content; nothing composed.', success: false };
    }
    return { message: content, success: true, data: { content } };
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    cancelExitRemoval();
  }
}
