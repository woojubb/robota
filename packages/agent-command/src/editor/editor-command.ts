/**
 * TERM-004: `/editor` — compose a message/prompt in `$EDITOR` via the terminal-handoff capability,
 * then return the saved text. The temp file is pre-filled with any args and removed afterward.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveEditor } from './resolve-editor.js';
import { spawnInherited } from '../shell/spawn-inherited.js';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

export const EDITOR_COMMAND_DESCRIPTION =
  'Compose a message in $EDITOR (optionally pre-filled with `/editor <text>`), then return it.';

export async function executeEditorCommand(
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  if (context.canHandoffTerminal?.() !== true || context.runWithTerminal === undefined) {
    return {
      message: 'An editor is unavailable here (no interactive terminal).',
      success: false,
    };
  }

  const editor = resolveEditor();
  const dir = mkdtempSync(join(tmpdir(), 'robota-editor-'));
  const file = join(dir, 'message.md');
  writeFileSync(file, args ?? '', 'utf8');

  try {
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
  }
}
