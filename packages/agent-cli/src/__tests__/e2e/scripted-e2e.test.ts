/**
 * Deterministic agent-loop E2E suites (CLI-074 TC-02..TC-05).
 *
 * A scripted provider replays declared turns through the REAL stack: startCli
 * print mode → agent loop → builtin tools → permission gate → session
 * persistence → output transports. No model, no network, fully deterministic.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-transport/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../../cli.js';

import type { IScriptedProvider, TScriptedTurn } from '@robota-sdk/agent-transport/testing';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const TMP_BASE = join(tmpdir(), `robota-scripted-e2e-${process.pid}`);
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

interface IRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runScripted(
  project: string,
  argv: string[],
  scripted: IScriptedProvider,
): Promise<IRunResult> {
  process.argv = ['node', 'robota', ...argv];
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as never);
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
  return { exitCode, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
}

function sessionFiles(project: string): string[] {
  try {
    return readdirSync(join(project, '.robota', 'sessions')).filter((f) => f.endsWith('.json'));
  } catch {
    // allow-fallback: no sessions dir means zero persisted sessions — a valid assertion state
    return [];
  }
}

describe('scripted agent-loop E2E (CLI-074)', () => {
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

  function editScript(target: string): TScriptedTurn[] {
    return [
      { toolCalls: [{ name: 'Read', args: { filePath: target } }] },
      {
        toolCalls: [
          { name: 'Edit', args: { filePath: target, oldString: 'Hello', newString: 'Goodbye' } },
        ],
      },
      { toolCalls: [{ name: 'Bash', args: { command: `cat ${JSON.stringify(target)}` } }] },
      { text: 'edit verified' },
    ];
  }

  it('TC-02: scripted Read→Edit→Bash turns mutate a real file through print mode', async () => {
    const target = join(project, 'greet.txt');
    writeFileSync(target, 'Hello, world\n', 'utf8');
    const scripted = createScriptedProvider(editScript(target));

    const result = await runScripted(project, ['-p', 'change the greeting'], scripted);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('edit verified');
    expect(readFileSync(target, 'utf8')).toBe('Goodbye, world\n');
    // The Bash cat result must round-trip into the provider request that follows it.
    const lastRequest = scripted.requests.at(-1) ?? [];
    const toolContents = lastRequest
      .filter((message) => message.role === 'tool')
      .map((message) => String(message.content));
    expect(toolContents.some((content) => content.includes('Goodbye, world'))).toBe(true);
  });

  it('TC-03: --dry-run blocks the Edit and leaves the file untouched', async () => {
    const target = join(project, 'greet.txt');
    writeFileSync(target, 'Hello, world\n', 'utf8');
    const scripted = createScriptedProvider([
      {
        toolCalls: [
          { name: 'Edit', args: { filePath: target, oldString: 'Hello', newString: 'Goodbye' } },
        ],
      },
      { text: 'attempted edit' },
    ]);

    const result = await runScripted(project, ['-p', 'edit it', '--dry-run'], scripted);

    expect(result.exitCode).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe('Hello, world\n');
  });

  it('TC-03: --denied-tools Edit surfaces the denial in the tool result', async () => {
    const target = join(project, 'greet.txt');
    writeFileSync(target, 'Hello, world\n', 'utf8');
    const scripted = createScriptedProvider([
      {
        toolCalls: [
          { name: 'Edit', args: { filePath: target, oldString: 'Hello', newString: 'Goodbye' } },
        ],
      },
      { text: 'attempted edit' },
    ]);

    const result = await runScripted(
      project,
      ['-p', 'edit it', '--denied-tools', 'Edit'],
      scripted,
    );

    expect(result.exitCode).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe('Hello, world\n');
    const followUp = scripted.requests.at(-1) ?? [];
    const toolContents = followUp
      .filter((message) => message.role === 'tool')
      .map((message) => String(message.content).toLowerCase());
    expect(toolContents.some((content) => /denied|permission|not allowed/.test(content))).toBe(
      true,
    );
  });

  it('TC-04: -c resume feeds the prior conversation into the next scripted request', async () => {
    const first = createScriptedProvider([{ text: 'noted: 42' }]);
    const firstRun = await runScripted(project, ['-p', 'Remember the number 42'], first);
    expect(firstRun.exitCode).toBe(0);
    expect(sessionFiles(project)).toHaveLength(1);

    const second = createScriptedProvider([{ text: 'it was 42' }]);
    const secondRun = await runScripted(project, ['-p', 'What number?', '-c'], second);

    expect(secondRun.exitCode).toBe(0);
    const request = second.requests[0] ?? [];
    const contents = request.map((message) => String(message.content));
    expect(contents.some((content) => content.includes('Remember the number 42'))).toBe(true);
    expect(contents.some((content) => content.includes('noted: 42'))).toBe(true);
    expect(sessionFiles(project)).toHaveLength(1);
  });

  it('TC-05: output contracts — text, json, stream-json, --bare', async () => {
    const textRun = await runScripted(
      project,
      ['-p', 'say it', '--no-session-persistence'],
      createScriptedProvider([{ text: 'CONTRACT_TEXT' }]),
    );
    expect(textRun.exitCode).toBe(0);
    expect(textRun.stdout).toContain('CONTRACT_TEXT');

    const jsonRun = await runScripted(
      project,
      ['-p', 'say it', '--output-format', 'json', '--no-session-persistence'],
      createScriptedProvider([{ text: 'CONTRACT_JSON' }]),
    );
    expect(jsonRun.exitCode).toBe(0);
    const envelope = JSON.parse(jsonRun.stdout.trim()) as Record<string, unknown>;
    expect(envelope).toMatchObject({
      type: 'result',
      result: 'CONTRACT_JSON',
      subtype: 'success',
    });
    expect(typeof envelope['session_id']).toBe('string');

    const streamRun = await runScripted(
      project,
      ['-p', 'say it', '--output-format', 'stream-json', '--no-session-persistence'],
      createScriptedProvider([{ text: 'CONTRACT_STREAM' }]),
    );
    expect(streamRun.exitCode).toBe(0);
    const lines = streamRun.stdout.split('\n').filter((line) => line.trim().length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const final = JSON.parse(lines.at(-1) ?? '{}') as Record<string, unknown>;
    expect(final).toMatchObject({ type: 'result', subtype: 'success' });

    const bareRun = await runScripted(
      project,
      ['-p', 'say it', '--bare', '--no-session-persistence'],
      createScriptedProvider([{ text: 'CONTRACT_BARE' }]),
    );
    expect(bareRun.exitCode).toBe(0);
    expect(bareRun.stdout.trim()).toBe('CONTRACT_BARE');
  });
});
