/**
 * The `/editor` buffer is the message being composed. A terminal that hangs up while the editor is
 * open ends the process without reaching the command's own cleanup, and the buffer must still go.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const editorModule = pathToFileURL(
  fileURLToPath(new URL('../editor-command.ts', import.meta.url)),
).href;

let base: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'editor-signal-')));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe.skipIf(process.platform === 'win32')('/editor when the terminal hangs up', () => {
  it('removes the open buffer and the process still dies by the hangup', () => {
    const hostParent = join(base, 'state', 'editor');
    const script = [
      "import { join } from 'node:path';",
      `import { executeEditorCommand } from ${JSON.stringify(editorModule)};`,
      'const host = {',
      '  canHandoffTerminal: () => true,',
      '  getCwd: () => process.cwd(),',
      // Like a real editor child, something keeps the event loop alive while the buffer is open.
      '  runWithTerminal: async () => {',
      '    setInterval(() => {}, 1000);',
      "    process.kill(process.pid, 'SIGHUP');",
      '    await new Promise(() => {});',
      '  },',
      '};',
      "await executeEditorCommand(host, 'an unsent draft', join(process.argv[1], 'product-editor-'));",
    ].join('\n');

    const child = spawnSync(
      process.execPath,
      ['--import', tsx, '--conditions=source', '--input-type=module', '-e', script, hostParent],
      { encoding: 'utf8', timeout: 30_000, env: { ...process.env, VISUAL: '', EDITOR: 'true' } },
    );

    expect(child.signal).toBe('SIGHUP');
    expect(existsSync(hostParent)).toBe(true);
    expect(readdirSync(hostParent)).toEqual([]);
  }, 30_000);
});
