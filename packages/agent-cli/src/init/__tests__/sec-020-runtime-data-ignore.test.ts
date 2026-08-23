/**
 * SEC-020 (issue #2021) — `robota init` keeps runtime session data out of Git.
 *
 * The claim is about what GIT does, so the last case asks git rather than reading the file back. A
 * test that asserts the file's TEXT proves the writer wrote what it was told to write, which is the
 * uninteresting half — the interesting half is that `.robota/settings.json` and `.robota/agents/`
 * stay tracked while the transcripts do not.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWorkspaceProjectMutation } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrustedWorkspaceProjectAccess } from '../../__tests__/helpers/trusted-workspace-project-access.js';
import { runInitCommand } from '../init-command.js';

import type { ITerminalOutput } from '@robota-sdk/agent-core';
import type {
  ITrustedWorkspaceProjectAccess,
  IWorkspaceProjectMutation,
} from '@robota-sdk/agent-framework';

const IGNORE_PATH = join('.robota', '.gitignore');

function createTerminal(): { terminal: ITerminalOutput; output(): string } {
  const lines: string[] = [];
  const push = (text = ''): void => {
    lines.push(text);
  };
  return {
    terminal: { writeLine: push, writeError: push, write: push } as unknown as ITerminalOutput,
    output: () => lines.join('\n'),
  };
}

describe('SEC-020 — robota init writes targeted runtime-data ignore rules', () => {
  let cwd: string;
  let projectAccess: ITrustedWorkspaceProjectAccess;
  let projectMutation: IWorkspaceProjectMutation;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'sec-020-init-'));
    projectAccess = await createTrustedWorkspaceProjectAccess(cwd);
    projectMutation = createWorkspaceProjectMutation(projectAccess.authority, {
      status: 'approved',
      purpose: 'initialize test project',
    });
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  async function init(): Promise<string> {
    const { terminal, output } = createTerminal();
    await runInitCommand(terminal, {
      projectAccess,
      projectMutation,
      yes: true,
      promptFn: vi.fn(async () => 'n') as never,
      isTTY: false,
      ci: false,
    });
    return output();
  }

  it('TC-24: creates .robota/.gitignore with the four runtime-data entries', async () => {
    const output = await init();
    const text = readFileSync(join(cwd, IGNORE_PATH), 'utf8');
    for (const entry of ['sessions/', 'logs/', 'checkpoints/', 'settings.local.json']) {
      expect(text).toContain(entry);
    }
    expect(output).toContain('Created: .robota/.gitignore');
  });

  it('TC-25: does NOT ignore project memory, which is a decision rather than an omission', async () => {
    // `.agents/memory/` is checked in by design in this repository and project memory is the same
    // kind of artefact. Ignoring it by default would make that choice for every user of the CLI.
    await init();
    expect(readFileSync(join(cwd, IGNORE_PATH), 'utf8')).not.toContain('memory/');
  });

  it('TC-26: running init twice changes nothing and says so', async () => {
    await init();
    const first = readFileSync(join(cwd, IGNORE_PATH), 'utf8');
    const output = await init();
    expect(readFileSync(join(cwd, IGNORE_PATH), 'utf8')).toBe(first);
    expect(output).toContain('already covers runtime session data');
  });

  it('TC-27: a line the user added by hand survives, and a missing entry is added', async () => {
    await init();
    const path = join(cwd, IGNORE_PATH);
    writeFileSync(path, '# mine\nscratch/\nsessions/\n', 'utf8');
    const output = await init();
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('scratch/');
    expect(text).toContain('# mine');
    expect(text).toContain('logs/');
    expect(output).toContain('Updated: .robota/.gitignore');
  });

  it('TC-28: git itself ignores the transcripts and tracks the reviewable settings', async () => {
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    git('init', '-q', '.');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'test');
    await init();

    mkdirSync(join(cwd, '.robota', 'sessions'), { recursive: true });
    mkdirSync(join(cwd, '.robota', 'logs'), { recursive: true });
    mkdirSync(join(cwd, '.robota', 'agents'), { recursive: true });
    writeFileSync(join(cwd, '.robota', 'sessions', 'a.json'), '{}');
    writeFileSync(join(cwd, '.robota', 'logs', 'a.jsonl'), '{}');
    writeFileSync(join(cwd, '.robota', 'agents', 'a.md'), '# agent');
    writeFileSync(join(cwd, '.robota', 'settings.local.json'), '{}');

    git('add', '-A');
    const staged = git('diff', '--cached', '--name-only').split('\n');

    expect(staged).toContain('.robota/settings.json');
    expect(staged).toContain('.robota/agents/a.md');
    expect(staged).toContain('.robota/.gitignore');
    expect(staged).not.toContain('.robota/sessions/a.json');
    expect(staged).not.toContain('.robota/logs/a.jsonl');
    expect(staged).not.toContain('.robota/settings.local.json');
  });
});
