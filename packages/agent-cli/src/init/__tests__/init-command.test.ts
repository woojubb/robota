/**
 * `robota init` prompt-matrix tests (CLI-065).
 *
 * `--yes` (and CI=true) must skip every Y/n prompt and apply the documented
 * defaults: overwrite N (idempotent "Init cancelled."), migrate N, provider
 * setup N. Non-TTY without --yes fails with an error naming the question.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InitPromptUnavailableError, runInitCommand } from '../init-command.js';

import type { ITerminalOutput } from '@robota-sdk/agent-core';

function createTerminal(): { terminal: ITerminalOutput; output(): string } {
  const lines: string[] = [];
  return {
    terminal: {
      writeLine: (text = '') => {
        lines.push(text);
      },
      writeError: (text: string) => {
        lines.push(`[err] ${text}`);
      },
      write: (text: string) => {
        lines.push(text);
      },
    } as unknown as ITerminalOutput,
    output: () => lines.join('\n'),
  };
}

describe('runInitCommand prompt matrix (CLI-065)', () => {
  let cwd: string;
  let promptSpy: ReturnType<typeof vi.fn<[string], Promise<string>>>;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'robota-init-test-'));
    promptSpy = vi.fn<[string], Promise<string>>(async () => 'y');
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function seedExistingFiles(): { agentsMd: string; settings: string } {
    const agentsMd = join(cwd, 'AGENTS.md');
    const settingsDir = join(cwd, '.robota');
    mkdirSync(settingsDir, { recursive: true });
    const settings = join(settingsDir, 'settings.json');
    writeFileSync(agentsMd, '# existing agents file\n', 'utf8');
    writeFileSync(settings, '{"existing":true}\n', 'utf8');
    return { agentsMd, settings };
  }

  it('TC-01: yes + existing files → no prompt, "Init cancelled.", files untouched', async () => {
    const { agentsMd, settings } = seedExistingFiles();
    const { terminal, output } = createTerminal();

    await runInitCommand(cwd, terminal, {
      yes: true,
      promptFn: promptSpy as never,
      isTTY: false,
      ci: false,
    });

    expect(promptSpy).not.toHaveBeenCalled();
    expect(output()).toContain('Init cancelled.');
    expect(readFileSync(agentsMd, 'utf8')).toBe('# existing agents file\n');
    expect(readFileSync(settings, 'utf8')).toBe('{"existing":true}\n');
  });

  it('TC-02: yes + .claude present in clean dir → migration skipped, plain template written', async () => {
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(
      join(cwd, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(*)'] } }),
      'utf8',
    );
    const { terminal } = createTerminal();

    await runInitCommand(cwd, terminal, {
      yes: true,
      promptFn: promptSpy as never,
      isTTY: false,
      ci: false,
    });

    expect(promptSpy).not.toHaveBeenCalled();
    const written = JSON.parse(readFileSync(join(cwd, '.robota', 'settings.json'), 'utf8')) as {
      permissions: { allow: string[] };
    };
    // Migration default is N: the Claude allowlist entry must NOT be imported.
    expect(written.permissions.allow).not.toContain('Bash(*)');
  });

  it('TC-03: CI=true behaves like --yes (defaults, no prompts)', async () => {
    seedExistingFiles();
    const { terminal, output } = createTerminal();

    await runInitCommand(cwd, terminal, {
      promptFn: promptSpy as never,
      isTTY: false,
      ci: true,
    });

    expect(promptSpy).not.toHaveBeenCalled();
    expect(output()).toContain('Init cancelled.');
  });

  it('TC-04: non-TTY without yes → error names the question and suggests --yes', async () => {
    seedExistingFiles();
    const { terminal } = createTerminal();

    let thrown: unknown;
    try {
      await runInitCommand(cwd, terminal, {
        promptFn: promptSpy as never,
        isTTY: false,
        ci: false,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InitPromptUnavailableError);
    const message = (thrown as Error).message;
    expect(message).toContain('Overwrite existing files?');
    expect(message).toContain('--yes');
    expect(message).not.toContain('API key');
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('TC-05: TTY without yes → prompts fire as before (interactive regression)', async () => {
    seedExistingFiles();
    const { terminal, output } = createTerminal();
    promptSpy.mockResolvedValueOnce('n');

    await runInitCommand(cwd, terminal, {
      promptFn: promptSpy as never,
      isTTY: true,
      ci: false,
    });

    expect(promptSpy).toHaveBeenCalledTimes(1);
    expect(String(promptSpy.mock.calls[0]?.[0])).toContain('Overwrite existing files?');
    expect(output()).toContain('Init cancelled.');
  });

  it('TC-05: TTY overwrite y + migrate n imports nothing and recreates files', async () => {
    seedExistingFiles();
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    writeFileSync(
      join(cwd, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(*)'] } }),
      'utf8',
    );
    const { terminal, output } = createTerminal();
    promptSpy.mockResolvedValueOnce('y'); // overwrite
    promptSpy.mockResolvedValueOnce('n'); // migrate

    await runInitCommand(cwd, terminal, {
      promptFn: promptSpy as never,
      isTTY: true,
      ci: false,
    });

    expect(promptSpy).toHaveBeenCalledTimes(2);
    expect(output()).toContain('Initialization complete.');
    const written = JSON.parse(readFileSync(join(cwd, '.robota', 'settings.json'), 'utf8')) as {
      permissions: { allow: string[] };
    };
    expect(written.permissions.allow).not.toContain('Bash(*)');
  });

  it('provider setup prompt is skipped with yes (default N)', async () => {
    const { terminal } = createTerminal();
    const onProviderSetup = vi.fn(async () => {});

    await runInitCommand(cwd, terminal, {
      yes: true,
      onProviderSetup,
      promptFn: promptSpy as never,
      isTTY: false,
      ci: false,
    });

    expect(onProviderSetup).not.toHaveBeenCalled();
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('provider setup prompt skips with a notice on non-TTY instead of failing a completed init', async () => {
    const { terminal, output } = createTerminal();
    const onProviderSetup = vi.fn(async () => {});

    await runInitCommand(cwd, terminal, {
      onProviderSetup,
      promptFn: promptSpy as never,
      isTTY: false,
      ci: false,
    });

    expect(onProviderSetup).not.toHaveBeenCalled();
    expect(output()).toContain('Initialization complete.');
  });
});
