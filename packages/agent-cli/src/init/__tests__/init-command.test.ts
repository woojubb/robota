import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
/**
 * `the product init` prompt-matrix tests.
 *
 * `--yes` (and CI=true) must skip every Y/n prompt and apply the documented
 * defaults: overwrite N (idempotent "Init cancelled."), migrate N, provider
 * setup N. Non-TTY without --yes fails with an error naming the question.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRestrictedWorkspaceProjectAccess,
  createWorkspaceProjectMutation,
  WorkspaceAuthorityRequiredError,
} from '@robota-sdk/agent-framework';

import { createTrustedWorkspaceProjectAccess } from '../../__tests__/helpers/trusted-workspace-project-access.js';
import { InitPromptUnavailableError, runInitCommand } from '../init-command.js';

import type { ITerminalOutput } from '@robota-sdk/agent-core';
import type {
  ITrustedWorkspaceProjectAccess,
  IWorkspaceProjectMutation,
} from '@robota-sdk/agent-framework';

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

describe('runInitCommand prompt matrix', () => {
  let cwd: string;
  let promptSpy: ReturnType<typeof vi.fn<(question: string) => Promise<string>>>;
  let projectAccess: ITrustedWorkspaceProjectAccess;
  let projectMutation: IWorkspaceProjectMutation;

  beforeEach(async () => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-init-test-')));
    promptSpy = vi.fn<(question: string) => Promise<string>>(async () => 'y');
    projectAccess = await createTrustedWorkspaceProjectAccess(cwd);
    projectMutation = createWorkspaceProjectMutation(projectAccess.authority, {
      status: 'approved',
      purpose: 'initialize test project',
    });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function seedExistingFiles(): { agentsMd: string; settings: string } {
    const agentsMd = join(cwd, 'AGENTS.md');
    const settingsDir = join(cwd, '.test-product');
    mkdirSync(settingsDir, { recursive: true });
    const settings = join(settingsDir, 'settings.json');
    writeFileSync(agentsMd, '# existing agents file\n', 'utf8');
    writeFileSync(settings, '{"existing":true}\n', 'utf8');
    return { agentsMd, settings };
  }

  // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'yes + existing files → no prompt, "Init cancelled.", files untouched',
    async () => {
      const { agentsMd, settings } = seedExistingFiles();
      const { terminal, output } = createTerminal();

      await runInitCommand(terminal, {productRuntime: createTestProductRuntime(),
        projectAccess,
        projectMutation,
        yes: true,
        promptFn: promptSpy as never,
        isTTY: false,
        ci: false,
      });

      expect(promptSpy).not.toHaveBeenCalled();
      expect(output()).toContain('Init cancelled.');
      expect(readFileSync(agentsMd, 'utf8')).toBe('# existing agents file\n');
      expect(readFileSync(settings, 'utf8')).toBe('{"existing":true}\n');
    },
  );

  // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'yes + .claude present in clean dir → migration skipped, plain template written',
    async () => {
      mkdirSync(join(cwd, '.claude'), { recursive: true });
      writeFileSync(
        join(cwd, '.claude', 'settings.json'),
        JSON.stringify({ permissions: { allow: ['Bash(*)'] } }),
        'utf8',
      );
      const { terminal } = createTerminal();

      await runInitCommand(terminal, {productRuntime: createTestProductRuntime(),
        projectAccess,
        projectMutation,
        yes: true,
        promptFn: promptSpy as never,
        isTTY: false,
        ci: false,
      });

      expect(promptSpy).not.toHaveBeenCalled();
      const written = JSON.parse(readFileSync(join(cwd, '.test-product', 'settings.json'), 'utf8')) as {
        permissions: { allow: string[] };
      };
      // Migration default is N: the Claude allowlist entry must NOT be imported.
      expect(written.permissions.allow).not.toContain('Bash(*)');
    },
  );

  // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'CI=true behaves like --yes (defaults, no prompts)',
    async () => {
      seedExistingFiles();
      const { terminal, output } = createTerminal();

      await runInitCommand(terminal, {productRuntime: createTestProductRuntime(),
        projectAccess,
        projectMutation,
        promptFn: promptSpy as never,
        isTTY: false,
        ci: true,
      });

      expect(promptSpy).not.toHaveBeenCalled();
      expect(output()).toContain('Init cancelled.');
    },
  );

  // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'non-TTY without yes → error names the question and suggests --yes',
    async () => {
      seedExistingFiles();
      const { terminal } = createTerminal();

      let thrown: unknown;
      try {
        await runInitCommand(terminal, {productRuntime: createTestProductRuntime(),
          projectAccess,
          projectMutation,
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
    },
  );

  // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'TTY without yes → prompts fire as before (interactive regression)',
    async () => {
      seedExistingFiles();
      const { terminal, output } = createTerminal();
      promptSpy.mockResolvedValueOnce('n');

      await runInitCommand(terminal, {productRuntime: createTestProductRuntime(),
        projectAccess,
        projectMutation,
        promptFn: promptSpy as never,
        isTTY: true,
        ci: false,
      });

      expect(promptSpy).toHaveBeenCalledTimes(1);
      expect(String(promptSpy.mock.calls[0]?.[0])).toContain('Overwrite existing files?');
      expect(output()).toContain('Init cancelled.');
    },
  );

  // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'TTY overwrite y + migrate n imports nothing and recreates files',
    async () => {
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

      await runInitCommand(terminal, {productRuntime: createTestProductRuntime(),
        projectAccess,
        projectMutation,
        promptFn: promptSpy as never,
        isTTY: true,
        ci: false,
      });

      expect(promptSpy).toHaveBeenCalledTimes(2);
      expect(output()).toContain('Initialization complete.');
      const written = JSON.parse(readFileSync(join(cwd, '.test-product', 'settings.json'), 'utf8')) as {
        permissions: { allow: string[] };
      };
      expect(written.permissions.allow).not.toContain('Bash(*)');
    },
  );

  // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'provider setup prompt is skipped with yes (default N)',
    async () => {
      const { terminal } = createTerminal();
      const onProviderSetup = vi.fn(async () => {});

      await runInitCommand(terminal, {productRuntime: createTestProductRuntime(),
        projectAccess,
        projectMutation,
        yes: true,
        onProviderSetup,
        promptFn: promptSpy as never,
        isTTY: false,
        ci: false,
      });

      expect(onProviderSetup).not.toHaveBeenCalled();
      expect(promptSpy).not.toHaveBeenCalled();
    },
  );

  // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'provider setup prompt skips with a notice on non-TTY instead of failing a completed init',
    async () => {
      const { terminal, output } = createTerminal();
      const onProviderSetup = vi.fn(async () => {});

      await runInitCommand(terminal, {productRuntime: createTestProductRuntime(),
        projectAccess,
        projectMutation,
        onProviderSetup,
        promptFn: promptSpy as never,
        isTTY: false,
        ci: false,
      });

      expect(onProviderSetup).not.toHaveBeenCalled();
      expect(output()).toContain('Initialization complete.');
    },
  );

  describe('a file that already exists is never replaced without asking, whichever of the two it is', () => {
    const EXISTING_AGENTS_MD = '# existing agents file\n';
    const EXISTING_SETTINGS = '{"existing":true}\n';

    /** Seeds exactly one of the two files and returns it with the path of the one left absent. */
    function seedOnly(which: 'AGENTS.md' | 'settings'): { present: string; absent: string } {
      const agentsMd = join(cwd, 'AGENTS.md');
      const settings = join(cwd, '.test-product', 'settings.json');
      if (which === 'AGENTS.md') {
        writeFileSync(agentsMd, EXISTING_AGENTS_MD, 'utf8');
        return { present: agentsMd, absent: settings };
      }
      mkdirSync(join(cwd, '.test-product'), { recursive: true });
      writeFileSync(settings, EXISTING_SETTINGS, 'utf8');
      return { present: settings, absent: agentsMd };
    }

    // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
    it.runIf(process.platform === 'linux')(
      'only AGENTS.md exists → asked, and declining leaves it untouched and writes no settings',
      async () => {
        const { present, absent } = seedOnly('AGENTS.md');
        const { terminal, output } = createTerminal();
        promptSpy.mockResolvedValueOnce('n');

        await runInitCommand(terminal, {
          productRuntime: createTestProductRuntime(),
          projectAccess,
          projectMutation,
          promptFn: promptSpy as never,
          isTTY: true,
          ci: false,
        });

        expect(promptSpy).toHaveBeenCalledTimes(1);
        expect(String(promptSpy.mock.calls[0]?.[0])).toContain('Overwrite existing files?');
        expect(output()).toContain('AGENTS.md already exists.');
        expect(output()).not.toContain('Both');
        expect(output()).toContain('Init cancelled.');
        expect(readFileSync(present, 'utf8')).toBe(EXISTING_AGENTS_MD);
        expect(existsSync(absent)).toBe(false);
      },
    );

    // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
    it.runIf(process.platform === 'linux')(
      'only settings.json exists → asked, and declining leaves it untouched and writes no AGENTS.md',
      async () => {
        const { present, absent } = seedOnly('settings');
        const { terminal, output } = createTerminal();
        promptSpy.mockResolvedValueOnce('n');

        await runInitCommand(terminal, {
          productRuntime: createTestProductRuntime(),
          projectAccess,
          projectMutation,
          promptFn: promptSpy as never,
          isTTY: true,
          ci: false,
        });

        expect(promptSpy).toHaveBeenCalledTimes(1);
        expect(String(promptSpy.mock.calls[0]?.[0])).toContain('Overwrite existing files?');
        expect(output()).toContain('.test-product/settings.json already exists.');
        expect(output()).not.toContain('Both');
        expect(output()).toContain('Init cancelled.');
        expect(readFileSync(present, 'utf8')).toBe(EXISTING_SETTINGS);
        expect(existsSync(absent)).toBe(false);
      },
    );

    // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
    it.runIf(process.platform === 'linux')(
      'both exist → the sentence names both, and declining leaves both untouched',
      async () => {
        const { agentsMd, settings } = seedExistingFiles();
        const { terminal, output } = createTerminal();
        promptSpy.mockResolvedValueOnce('n');

        await runInitCommand(terminal, {
          productRuntime: createTestProductRuntime(),
          projectAccess,
          projectMutation,
          promptFn: promptSpy as never,
          isTTY: true,
          ci: false,
        });

        expect(promptSpy).toHaveBeenCalledTimes(1);
        expect(output()).toContain('Both AGENTS.md and .test-product/settings.json already exist.');
        expect(output()).toContain('Init cancelled.');
        expect(readFileSync(agentsMd, 'utf8')).toBe(EXISTING_AGENTS_MD);
        expect(readFileSync(settings, 'utf8')).toBe(EXISTING_SETTINGS);
      },
    );

    // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
    it.runIf(process.platform === 'linux')(
      'neither exists → no overwrite question, both files are written',
      async () => {
        const { terminal, output } = createTerminal();

        await runInitCommand(terminal, {
          productRuntime: createTestProductRuntime(),
          projectAccess,
          projectMutation,
          promptFn: promptSpy as never,
          isTTY: true,
          ci: false,
        });

        expect(promptSpy).not.toHaveBeenCalled();
        expect(output()).not.toContain('already exist');
        expect(output()).toContain('Initialization complete.');
        expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(true);
        expect(existsSync(join(cwd, '.test-product', 'settings.json'))).toBe(true);
      },
    );

    // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
    it.runIf(process.platform === 'linux')(
      'only AGENTS.md exists and the person says yes → it is replaced and the settings are written',
      async () => {
        const { present, absent } = seedOnly('AGENTS.md');
        const { terminal, output } = createTerminal();
        promptSpy.mockResolvedValueOnce('y');

        await runInitCommand(terminal, {
          productRuntime: createTestProductRuntime(),
          projectAccess,
          projectMutation,
          promptFn: promptSpy as never,
          isTTY: true,
          ci: false,
        });

        expect(promptSpy).toHaveBeenCalledTimes(1);
        expect(output()).toContain('Initialization complete.');
        expect(readFileSync(present, 'utf8')).not.toBe(EXISTING_AGENTS_MD);
        expect(existsSync(absent)).toBe(true);
      },
    );

    // Project mutation is Linux-only (stable root-anchored host); refused elsewhere.
    it.runIf(process.platform === 'linux')(
      'only AGENTS.md exists under --yes → no prompt, cancelled, untouched',
      async () => {
        const { present, absent } = seedOnly('AGENTS.md');
        const { terminal, output } = createTerminal();

        await runInitCommand(terminal, {
          productRuntime: createTestProductRuntime(),
          projectAccess,
          projectMutation,
          yes: true,
          promptFn: promptSpy as never,
          isTTY: false,
          ci: false,
        });

        expect(promptSpy).not.toHaveBeenCalled();
        expect(output()).toContain('Init cancelled.');
        expect(readFileSync(present, 'utf8')).toBe(EXISTING_AGENTS_MD);
        expect(existsSync(absent)).toBe(false);
      },
    );
  });

  it('does not inspect or mutate project files without trusted access and mutation authority', async () => {
    seedExistingFiles();
    const { terminal, output } = createTerminal();

    await expect(
      runInitCommand(terminal, {productRuntime: createTestProductRuntime(),
        projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
        yes: true,
      }),
    ).rejects.toBeInstanceOf(WorkspaceAuthorityRequiredError);

    expect(output()).toBe('');
  });
});
