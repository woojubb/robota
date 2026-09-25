/**
 * Issue #3082 — `--safe-mode` starts robota with every customization off, so a misbehaving
 * instruction file, skill, plugin, hook or MCP server can be ruled out in one run.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../../cli.js';
import { createTrustedWorkspaceProjectAccess } from '../helpers/trusted-workspace-project-access.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { IScriptedProvider } from '@robota-sdk/agent-core/testing';

const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;

let base: string;
let home: string;
let project: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'robota-safe-mode-')));
  home = join(base, 'home');
  project = join(base, 'project');
  mkdirSync(join(home, '.robota', 'skills', 'user-skill'), { recursive: true });
  // The provider lives in the user settings: safe mode reads no project settings.
  writeFileSync(
    join(home, '.robota', 'settings.json'),
    JSON.stringify({
      currentProvider: 'scripted',
      providers: { scripted: { type: 'scripted', model: 'scripted-model' } },
    }),
  );
  writeFileSync(
    join(home, '.robota', 'skills', 'user-skill', 'SKILL.md'),
    '---\nname: user-skill\ndescription: a user skill\n---\nDo the thing.\n',
  );
  mkdirSync(project);
  writeFileSync(join(project, 'AGENTS.md'), 'PROJECT-INSTRUCTION-MARKER\n');
  process.env.HOME = home;
  vi.spyOn(process, 'cwd').mockReturnValue(project);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code ?? 0)}`);
  }) as never);
});

afterEach(() => {
  process.argv = ORIGINAL_ARGV;
  process.env.HOME = ORIGINAL_HOME;
  rmSync(base, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function scriptedDefinition(scripted: IScriptedProvider): IProviderDefinition {
  return {
    type: 'scripted',
    defaults: { model: 'scripted-model' },
    requiresApiKey: false,
    createProvider: () => scripted.provider,
  };
}

async function run(
  prompt: string,
  extra: readonly string[],
): Promise<{ stdout: string; stderr: string; scripted: IScriptedProvider }> {
  const scripted = createScriptedProvider([{ text: 'ok' }, { text: 'ok' }]);
  process.argv = [
    'node',
    'robota',
    '-p',
    prompt,
    '--output-format',
    'json',
    '--no-session-persistence',
    ...extra,
  ];
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    err.push(String(chunk));
    return true;
  }) as never);
  try {
    await startCli({
      providerDefinitions: [scriptedDefinition(scripted)],
      projectAccess: await createTrustedWorkspaceProjectAccess(project),
    });
  } catch (error) {
    if (!/^process\.exit:\d+$/.test(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
  } finally {
    vi.mocked(process.stdout.write).mockRestore();
    vi.mocked(process.stderr.write).mockRestore();
  }
  return { stdout: out.join(''), stderr: err.join(''), scripted };
}

function systemPrompt(scripted: IScriptedProvider): string {
  return JSON.stringify(scripted.requests[0]?.filter((message) => message.role === 'system'));
}

describe('--safe-mode', () => {
  it('loads no project instructions and no user skills, and says so', async () => {
    const normal = await run('hello', []);
    expect(systemPrompt(normal.scripted)).toContain('PROJECT-INSTRUCTION-MARKER');
    const normalSkills = await run('/skills', []);
    expect(normalSkills.stdout).toContain('user-skill');

    const safe = await run('hello', ['--safe-mode']);
    expect(systemPrompt(safe.scripted)).not.toContain('PROJECT-INSTRUCTION-MARKER');
    expect(safe.stderr).toContain('Safe mode:');
    const safeSkills = await run('/skills', ['--safe-mode']);
    expect(safeSkills.stdout).not.toContain('user-skill');
  }, 60_000);
});
