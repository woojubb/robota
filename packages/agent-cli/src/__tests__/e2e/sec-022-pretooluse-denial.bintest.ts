/**
 * SEC-022 (issue #2225): the provider-free route to a real `PreToolUse` denial, through the CLI.
 *
 * SEC-016's TC-11 concluded from `--output-format stream-json` carrying no tool event that the
 * recorded tool call was never dispatched. It IS dispatched. Three separate things were true:
 * `stream-json` has no tool event in its vocabulary at all, the scenario passed
 * `--no-session-persistence` (removing the one surface that records the denial), and it expected the
 * failure kind `spawn-failure` where a `command` hook at a nonexistent path yields `nonzero-exit`.
 *
 * **The mutant this suite exists to kill.** A test that spawns the binary, sees exit 0 and asserts on
 * stdout would pass whether or not the hook ever fired — stdout is byte-identical between the denied
 * and allowed arms apart from session ids and uuids. So every assertion here reads the **persisted
 * session record**, and it reads **both arms**: one arm alone is explainable by the fixture, the pair
 * is not.
 *
 * No API key and no network: `--session-log` swaps the replay provider in before a key is read.
 *
 * Build-gated (`*.bintest.ts`, `test:bin` project): requires `pnpm --filter @robota-sdk/agent-cli build`.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createBinaryAgentDriver } from '../../testing/binary-agent-driver.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', '..', '..', 'bin', 'robota.cjs');
/** The fixture SEC-016 committed for whoever resolved its blocker; until now no test read it. */
const FIXTURE = join(HERE, 'fixtures', 'sec-016-tool-call.jsonl');
const PROBE_NAME = 'SEC-016-PROBE.txt';
const PROBE_CONTENT = 'SEC-016 probe MARKER_XYZ';
/** A path that does not exist, so the `command` hook's shell exits 127 → kind `nonzero-exit`. */
const MISSING_HOOK = '/nonexistent/sec-016-hook';

interface IRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
}

interface IRecordedMessage {
  readonly role?: string;
  readonly name?: string;
  readonly content?: unknown;
}

function providerSettings(withHook: boolean): string {
  return JSON.stringify({
    currentProvider: 'anthropic',
    // A provider profile must exist even for replay (config-loader requires `currentProvider`);
    // `--session-log` swaps in the replay provider, so this key is never used.
    providers: {
      anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'sec022-dummy-key' },
    },
    // The two arms differ ONLY by this key: the provider profile survives in both, so a difference
    // between them cannot be explained by a broken configuration.
    ...(withHook
      ? {
          hooks: {
            PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: MISSING_HOOK }] }],
          },
        }
      : {}),
  });
}

function writeSettings(homeDir: string, withHook: boolean): void {
  const dir = join(homeDir, '.robota');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), providerSettings(withHook), 'utf8');
}

function runCli(homeDir: string, projectDir: string): Promise<IRunResult> {
  return new Promise<IRunResult>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        CLI,
        '-p',
        'read the probe file',
        '--output-format',
        'stream-json',
        // Session persistence is left ON deliberately: the persisted record is the only surface
        // that carries the denial, and removing it is what made SEC-016 see nothing.
        '--session-log',
        FIXTURE,
      ],
      {
        cwd: projectDir,
        env: { PATH: process.env['PATH'] ?? '', HOME: homeDir },
      },
    );
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout });
    });
  });
}

/** The session id the run reported on its own stream — not a newest-file guess. */
function readSessionId(stdout: string): string {
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // allow-fallback: stream-json emits one JSON object per line; non-JSON noise is not the id
      continue;
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const id = (parsed as Record<string, unknown>)['session_id'];
      if (typeof id === 'string' && id.length > 0) return id;
    }
  }
  throw new Error(`no session_id on the run's stream-json output:\n${stdout}`);
}

/** The `tool` message the run persisted — the surface that carries the denial. */
function readToolMessageContent(homeDir: string, sessionId: string): string {
  const file = join(homeDir, '.robota', 'sessions', `${sessionId}.json`);
  const envelope = JSON.parse(readFileSync(file, 'utf8')) as {
    record?: { messages?: readonly IRecordedMessage[] };
  };
  const messages = envelope.record?.messages ?? [];
  const toolMessage = messages.find((message) => message.role === 'tool');
  if (toolMessage === undefined) {
    throw new Error(`the persisted record at ${file} carries no tool message`);
  }
  expect(toolMessage.name).toBe('Read');
  return String(toolMessage.content ?? '');
}

describe('SEC-022: the provider-free route to a PreToolUse denial (issue #2225)', () => {
  let homeDir: string;
  let projectDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'robota-sec022-home-'));
    projectDir = mkdtempSync(join(tmpdir(), 'robota-sec022-proj-'));
    writeFileSync(join(projectDir, PROBE_NAME), `${PROBE_CONTENT}\n`, 'utf8');
  });

  afterEach(() => {
    for (const dir of [homeDir, projectDir]) rmSync(dir, { recursive: true, force: true });
  });

  it('records the denial with its kind, its source executor and the hook path, and the allowed arm without them (TC-01, TC-02, TC-03)', async () => {
    // ── Denied arm: a PreToolUse command hook at a path that does not exist ────────────────
    writeSettings(homeDir, true);
    const denied = await runCli(homeDir, projectDir);
    const deniedContent = readToolMessageContent(homeDir, readSessionId(denied.stdout));

    // TC-01 — all four markers, on the record, not on stdout.
    expect(deniedContent).toContain('"blocked":true');
    expect(deniedContent).toContain('nonzero-exit');
    expect(deniedContent).toContain('source: command');
    expect(deniedContent).toContain(MISSING_HOOK);

    // ── Allowed arm: the SAME settings minus the `hooks` key ───────────────────────────────
    writeSettings(homeDir, false);
    const allowed = await runCli(homeDir, projectDir);
    const allowedContent = readToolMessageContent(homeDir, readSessionId(allowed.stdout));

    // TC-02 — the tool ran, and none of the denial markers is present.
    expect(allowedContent).toContain('"success":true');
    expect(allowedContent).toContain(PROBE_CONTENT);
    expect(allowedContent).not.toContain('blocked');
    expect(allowedContent).not.toContain('nonzero-exit');
    expect(allowedContent).not.toContain('source: command');

    // TC-03 — the tool CALL is denied; the SESSION is not. A non-zero exit is a behaviour this
    // boundary does not deliver, so it is asserted rather than assumed.
    expect(denied.exitCode).toBe(0);
    expect(allowed.exitCode).toBe(0);
  });

  it('reports the tool call that ran through the binary fidelity of IAgentDriver (TC-05)', async () => {
    writeSettings(homeDir, false);
    const driver = createBinaryAgentDriver({
      cwd: projectDir,
      sessionLog: FIXTURE,
      env: { PATH: process.env['PATH'] ?? '', HOME: homeDir },
    });
    await driver.start();
    await driver.send('read the probe file');
    await driver.stop();

    // Before SEC-022 this was `[]` — the binary fidelity disagreed with the in-process one by
    // returning an empty array rather than failing, for a run whose tool demonstrably executed.
    const calls = driver.toolCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('Read');
    expect(calls[0]?.args).toEqual({ filePath: PROBE_NAME });
  });
});
