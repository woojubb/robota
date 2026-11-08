/**
 * `/editor` — framework functional test.
 *
 * Drives the command through a REAL InteractiveSession with an injected fake handoff and a FAKE
 * editor (a tiny script that writes known content to its file arg). Verifies the round-trip: the
 * command opens the editor via `runWithTerminal`, captures the saved text, and cleans up — without a
 * real interactive editor (which is a manual gate).
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createEditorCommandModule } from '../editor-command-module.js';

import type { ITerminalHandoff } from '@robota-sdk/agent-interface-session';

const TEST_TIMEOUT = 20_000;

function fakeHandoff(canHandoff: boolean): ITerminalHandoff {
  return {
    canHandoffTerminal: canHandoff,
    async runWithTerminal<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  };
}

/**
 * Write a fake `$EDITOR`: a program that writes `content` into the file it is given and records that
 * path in `$EDITOR_CAPTURE_PATH`. The editor is spawned directly, with its value split on whitespace.
 */
function installFakeEditor(content: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'agent-test-fake-editor-')));
  if (process.platform === 'win32') {
    // Windows cannot run a shell script as a program, so node runs one instead.
    const script = join(dir, 'fake-editor.cjs');
    writeFileSync(
      script,
      `const { writeFileSync } = require('node:fs');\n` +
        `writeFileSync(process.argv[2], ${JSON.stringify(content)});\n` +
        `if (process.env.EDITOR_CAPTURE_PATH) writeFileSync(process.env.EDITOR_CAPTURE_PATH, process.argv[2]);\n`,
      'utf8',
    );
    return `${process.execPath} ${script}`;
  }
  const script = join(dir, 'fake-editor.sh');
  writeFileSync(
    script,
    `#!/bin/sh\nprintf '%s' '${content}' > "$1"\nif [ -n "$EDITOR_CAPTURE_PATH" ]; then printf '%s' "$1" > "$EDITOR_CAPTURE_PATH"; fi\n`,
    'utf8',
  );
  chmodSync(script, 0o755);
  return script;
}

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
  vi.unstubAllEnvs();
});

describe('/editor command (framework functional)', () => {
  it(
    'opens the editor via the handoff and returns the saved text',
    async () => {
      vi.stubEnv('VISUAL', undefined);
      vi.stubEnv('EDITOR', installFakeEditor('composed in editor'));
      h = scriptedSession({
        turns: [{ text: 'unused' }],
        terminalHandoff: fakeHandoff(true),
        commandModules: [createEditorCommandModule()],
      });

      const result = await h.command('editor', '');

      expect(result?.success).toBe(true);
      expect(result?.message).toBe('composed in editor');
      expect((result?.data as { content: string }).content).toBe('composed in editor');
    },
    TEST_TIMEOUT,
  );

  it(
    'uses a neutral temporary directory and removes it after editing',
    async () => {
      const captureDir = mkdtempSync(join(tmpdir(), 'editor-capture-'));
      const capturePath = join(captureDir, 'opened-path');
      try {
        vi.stubEnv('VISUAL', undefined);
        vi.stubEnv('EDITOR', installFakeEditor('neutral draft'));
        vi.stubEnv('EDITOR_CAPTURE_PATH', capturePath);
        h = scriptedSession({
          turns: [{ text: 'unused' }],
          terminalHandoff: fakeHandoff(true),
          commandModules: [createEditorCommandModule()],
        });

        const result = await h.command('editor', '');
        const openedPath = readFileSync(capturePath, 'utf8');
        expect(result?.message).toBe('neutral draft');
        expect(basename(dirname(openedPath))).toMatch(/^agent-editor-/);
        expect(existsSync(dirname(openedPath))).toBe(false);
      } finally {
        rmSync(captureDir, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT,
  );

  it(
    'is unavailable when there is no interactive terminal',
    async () => {
      vi.stubEnv('EDITOR', installFakeEditor('unused'));
      h = scriptedSession({
        turns: [{ text: 'unused' }],
        commandModules: [createEditorCommandModule()],
      });

      const result = await h.command('editor', '');

      expect(result?.success).toBe(false);
      expect(result?.message).toMatch(/unavailable/i);
    },
    TEST_TIMEOUT,
  );
});
