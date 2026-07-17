/**
 * Slash-command smoke E2E (CLI-074 TC-06).
 *
 * Registry-driven: the command list is read from the product's own /help
 * output, then every listed command is executed through print mode with the
 * json envelope. The contract is "no throw, valid envelope" — commands may
 * legitimately report success:false (e.g. ones needing interactive context),
 * but they must never crash the CLI or emit a non-envelope.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-transport/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../../cli.js';

import type { IScriptedProvider } from '@robota-sdk/agent-transport/testing';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const TMP_BASE = join(tmpdir(), `robota-slash-smoke-${process.pid}`);
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;

function writeScriptedSettings(projectDir: string): void {
  const settingsDir = join(projectDir, '.robota');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(
    join(settingsDir, 'settings.json'),
    JSON.stringify({
      currentProvider: 'scripted',
      providers: { scripted: { type: 'scripted', model: 'scripted-model' } },
    }),
    'utf8',
  );
}

function scriptedDefinition(scripted: IScriptedProvider): IProviderDefinition {
  return {
    type: 'scripted',
    defaults: { model: 'scripted-model' },
    requiresApiKey: false,
    createProvider: () => scripted.provider,
  };
}

async function runPrintJson(prompt: string): Promise<{ exitCode: number; stdout: string }> {
  // Generous script: session-execution commands fall through to the model.
  const scripted = createScriptedProvider([
    { text: 'smoke ok' },
    { text: 'smoke ok' },
    { text: 'smoke ok' },
  ]);
  process.argv = [
    'node',
    'robota',
    '-p',
    prompt,
    '--output-format',
    'json',
    '--no-session-persistence',
  ];
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  let exitCode = -1;
  try {
    await startCli({ providerDefinitions: [scriptedDefinition(scripted)] });
    throw new Error('startCli returned without process.exit');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /^process\.exit:(\d+)$/.exec(message);
    if (!match) throw error;
    exitCode = Number(match[1]);
  } finally {
    vi.mocked(process.stdout.write).mockRestore();
    vi.mocked(process.stderr.write).mockRestore();
  }
  return { exitCode, stdout: chunks.join('') };
}

describe('slash-command smoke through print mode (CLI-074 TC-06)', () => {
  let project: string;

  beforeEach(() => {
    project = join(TMP_BASE, `project-${Math.random().toString(36).slice(2)}`);
    mkdirSync(project, { recursive: true });
    writeScriptedSettings(project);
    process.env.HOME = join(TMP_BASE, 'home');
    vi.spyOn(process, 'cwd').mockReturnValue(project);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${String(code ?? 0)}`);
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = ORIGINAL_ARGV;
    process.env.HOME = ORIGINAL_HOME;
    rmSync(TMP_BASE, { recursive: true, force: true });
  });

  it('TC-06: every command listed by /help executes to a valid json envelope', async () => {
    const help = await runPrintJson('/help');
    expect(help.exitCode).toBe(0);
    const helpEnvelope = JSON.parse(help.stdout.trim()) as { result?: string };
    const helpText = helpEnvelope.result ?? '';
    const commands = [...new Set([...helpText.matchAll(/\(\/([a-z][\w-]*)\)/g)].map((m) => m[1]))];
    // Registry sanity: the product must advertise a real command set.
    expect(commands.length).toBeGreaterThanOrEqual(10);

    const crashed: string[] = [];
    const malformed: string[] = [];
    for (const command of commands) {
      try {
        const run = await runPrintJson(`/${command}`);
        const lastLine = run.stdout.trim().split('\n').at(-1) ?? '';
        const parsed = JSON.parse(lastLine) as { type?: string };
        if (parsed.type !== 'result') malformed.push(command);
      } catch (error) {
        crashed.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(crashed, `commands crashed the CLI: ${crashed.join('; ')}`).toEqual([]);
    expect(malformed, `commands emitted non-envelope output: ${malformed.join(', ')}`).toEqual([]);
  }, 120_000);

  // SELFHOST-002 user-execution: draft a plan through the real CLI product surface (print mode).
  it('SELFHOST-002: /plan <objective> drafts a reviewable plan via the CLI', async () => {
    const run = await runPrintJson('/plan draft the release notes');
    expect(run.exitCode).toBe(0);
    const lastLine = run.stdout.trim().split('\n').at(-1) ?? '{}';
    const envelope = JSON.parse(lastLine) as { type?: string; result?: string };
    expect(envelope.type).toBe('result');
    expect(envelope.result ?? '').toContain('/plan approve'); // drafted, read-only until approved
  }, 60_000);

  it('SELFHOST-002: /plan status reports no active plan in a fresh session', async () => {
    const run = await runPrintJson('/plan status');
    expect(run.exitCode).toBe(0);
    const lastLine = run.stdout.trim().split('\n').at(-1) ?? '{}';
    const envelope = JSON.parse(lastLine) as { type?: string; result?: string };
    expect(envelope.result ?? '').toContain('No plan is active.');
  }, 60_000);
});
