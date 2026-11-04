/**
 * Opens a file in the user's editor on the real terminal: `$VISUAL`, then `$EDITOR`, then `vi`, spawned
 * with the terminal inherited and resolving with the editor's exit code. The Node host's
 * `TOpenFileInEditor`; `/keybindings` takes it by injection.
 */
import { spawnInherited } from '../shell/spawn-inherited.js';

import { resolveEditor } from './resolve-editor.js';

export function openFileInEditor(path: string, cwd: string): Promise<number> {
  const editor = resolveEditor();
  return spawnInherited(editor.command, [...editor.args, path], cwd);
}
