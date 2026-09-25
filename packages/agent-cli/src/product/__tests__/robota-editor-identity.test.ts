import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRobotaPacks } from '../robota-profile.js';

afterEach(() => vi.unstubAllEnvs());

describe('Robota editor command composition', () => {
  it('keeps the CLI temporary directory identity and cleans it after editing', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'robota-editor-fixture-'));
    const capturePath = join(fixtureDir, 'opened-path');
    const editorPath = join(fixtureDir, 'fake-editor.sh');
    writeFileSync(
      editorPath,
      `#!/bin/sh\nprintf '%s' "$1" > "$EDITOR_CAPTURE_PATH"\nprintf 'composed by CLI' > "$1"\n`,
      'utf8',
    );
    chmodSync(editorPath, 0o755);

    try {
      vi.stubEnv('VISUAL', undefined);
      vi.stubEnv('EDITOR', editorPath);
      vi.stubEnv('EDITOR_CAPTURE_PATH', capturePath);
      const editor = createRobotaPacks({ cwd: fixtureDir })
        .flatMap((pack) => pack.commandModules ?? [])
        .flatMap((module) => module.systemCommands ?? [])
        .find((command) => command.name === 'editor');
      expect(editor).toBeDefined();

      const result = await editor!.execute(
        {
          canHandoffTerminal: () => true,
          runWithTerminal: async (run: () => Promise<unknown>) => run(),
          getCwd: () => fixtureDir,
        } as never,
        '',
      );
      const openedPath = readFileSync(capturePath, 'utf8');
      expect(result.message).toBe('composed by CLI');
      expect(basename(dirname(openedPath))).toMatch(/^robota-editor-/);
      expect(existsSync(dirname(openedPath))).toBe(false);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
