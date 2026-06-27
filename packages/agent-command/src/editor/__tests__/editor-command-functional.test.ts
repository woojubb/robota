/**
 * TERM-004: `/editor` — framework functional test.
 *
 * Drives the command through a REAL InteractiveSession with an injected fake handoff and a FAKE
 * editor (a tiny script that writes known content to its file arg). Verifies the round-trip: the
 * command opens the editor via `runWithTerminal`, captures the saved text, and cleans up — without a
 * real interactive editor (which is a manual gate, TERM-002).
 */
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '@robota-sdk/agent-framework/testing';

import { createEditorCommandModule } from '../editor-command-module.js';

import type { ITerminalHandoff } from '@robota-sdk/agent-interface-transport';

const TEST_TIMEOUT = 20_000;

function fakeHandoff(canHandoff: boolean): ITerminalHandoff {
  return {
    canHandoffTerminal: canHandoff,
    async runWithTerminal<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  };
}

/** Write a fake `$EDITOR`: a script that writes `content` into the file it is given as $1. */
function installFakeEditor(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'robota-fake-editor-'));
  const script = join(dir, 'fake-editor.sh');
  writeFileSync(script, `#!/bin/sh\nprintf '%s' '${content}' > "$1"\n`, 'utf8');
  chmodSync(script, 0o755);
  return script;
}

const origEditor = process.env.EDITOR;
const origVisual = process.env.VISUAL;

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
  if (origEditor === undefined) delete process.env.EDITOR;
  else process.env.EDITOR = origEditor;
  if (origVisual === undefined) delete process.env.VISUAL;
  else process.env.VISUAL = origVisual;
});

describe('/editor command (framework functional)', () => {
  it(
    'opens the editor via the handoff and returns the saved text',
    async () => {
      delete process.env.VISUAL;
      process.env.EDITOR = installFakeEditor('composed in editor');
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
    'is unavailable when there is no interactive terminal',
    async () => {
      process.env.EDITOR = installFakeEditor('unused');
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
