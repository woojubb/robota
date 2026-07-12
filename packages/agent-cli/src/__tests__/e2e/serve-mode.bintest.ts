/**
 * RUNTIME-001 — black-box e2e for the real `robota --serve` headless runtime host.
 *
 * This is the agent-runnable proof of the production user scenario that the GUI drives (apps/agent-app spawns
 * `robota --serve` as a loopback sidecar): a real CLI process serves the shared `startRuntimeHost` over an
 * authenticated loopback WS, a client connects with the launch nonce, runs one turn end-to-end, and the
 * process shuts down cleanly on SIGTERM. It is deliberately NOT the GUI e2e (which substitutes a scripted
 * sidecar) and NOT the in-process `runtime-host.test.ts` — here the ACTUAL built binary is spawned and driven
 * over the wire, exactly as apps/agent-app does in production.
 *
 * Coverage (each a scenario the owner would otherwise verify by hand):
 *   TC-A  the token gate rejects an unauthenticated connection BEFORE any session data is emitted;
 *   TC-B  an authenticated client submits a turn and observes the recorded reply end-to-end;
 *   TC-C  SIGTERM shuts the runtime host down cleanly (graceful exit, no hang).
 *
 * Determinism comes from `--session-log` (the replay provider): no model key is used. The client speaks the
 * raw WS protocol with the Node global `WebSocket` — the same wire a browser client uses — so this test takes
 * no dependency on any presentation package.
 *
 * Build-gated (`*.bintest.ts`, `test:bin` project): requires `pnpm --filter @robota-sdk/agent-cli build`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The built CLI entry (same bin the binary-agent-driver spawns). */
const ROBOTA_BIN = fileURLToPath(new URL('../../../bin/robota.cjs', import.meta.url));
/** Reuse the cross-fidelity replay log — its recorded reply is `CROSS_FIDELITY_OK`. */
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cross-fidelity.jsonl');
const RECORDED_REPLY = 'CROSS_FIDELITY_OK';

// Time budgets (named to keep the harness self-documenting and lint-clean).
const READY_BUDGET_MS = 20_000; // how long the serve host may take to start listening
const TCP_PROBE_MS = 500; // per TCP readiness probe
const POLL_INTERVAL_MS = 200; // gap between readiness probes
const AUTH_REJECT_MS = 3_000; // a rejected socket must close well within this
const TURN_MS = 20_000; // submit → complete round-trip budget
const SHUTDOWN_MS = 8_000; // SIGTERM → graceful exit budget
const BEFORE_ALL_MS = 30_000;
const TC_B_TIMEOUT_MS = 25_000;
const TC_C_TIMEOUT_MS = 12_000;

/** The only server frames this black-box client inspects (subset of the agent-transport-protocol contract). */
interface IServerFrame {
  type: string;
  result?: { response: string };
}
/** The only client frame this test sends. */
interface ISubmitFrame {
  type: 'submit';
  prompt: string;
}

interface IDriveOutcome {
  frames: IServerFrame[];
  timedOut: boolean;
  closed: boolean;
}

/** Find a free loopback port the same way the GUI supervisor does (bind 0 → read → release). */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

/** Write a bootable provider profile; `--session-log` swaps in the replay provider so the key is never used. */
function writeProviderSettings(projectDir: string): void {
  const dir = join(projectDir, '.robota');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      currentProvider: 'anthropic',
      providers: {
        anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'serve-dummy-key' },
      },
    }),
    'utf8',
  );
}

/** Open a WS to the serve host and collect frames until `predicate` is met, the socket closes, or it times out. */
function driveClient(
  url: string,
  onOpen: (send: (frame: ISubmitFrame) => void) => void,
  predicate: (frames: IServerFrame[]) => boolean,
  timeoutMs: number,
): Promise<IDriveOutcome> {
  return new Promise((resolve) => {
    const frames: IServerFrame[] = [];
    const ws = new WebSocket(url);
    let settled = false;
    const finish = (timedOut: boolean, closed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      resolve({ frames, timedOut, closed });
    };
    const timer = setTimeout(() => finish(true, false), timeoutMs);
    ws.onopen = (): void => onOpen((frame) => ws.send(JSON.stringify(frame)));
    ws.onmessage = (ev: MessageEvent): void => {
      try {
        frames.push(JSON.parse(String(ev.data)) as IServerFrame);
      } catch {
        /* ignore non-JSON noise */
      }
      if (predicate(frames)) finish(false, false);
    };
    ws.onclose = (): void => finish(false, true);
  });
}

/** Poll a plain TCP connect until the serve host's WS server is listening (or fail after the budget). */
async function waitForServer(port: number, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = connect({ host: '127.0.0.1', port });
      const done = (v: boolean): void => {
        sock.destroy();
        resolve(v);
      };
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
      sock.setTimeout(TCP_PROBE_MS, () => done(false));
    });
    if (ok) return;
    if (Date.now() >= deadline) throw new Error(`serve host did not come up within ${budgetMs}ms`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

describe('robota --serve black-box runtime host (RUNTIME-001)', () => {
  let binCwd: string;
  let homeDir: string;
  let child: ChildProcess;
  let port: number;
  const token = 'serve-e2e-nonce-0123456789abcdef';
  const url = (t = token): string => `ws://127.0.0.1:${port}?token=${encodeURIComponent(t)}`;

  beforeAll(async () => {
    binCwd = mkdtempSync(join(tmpdir(), 'robota-serve-bin-'));
    homeDir = mkdtempSync(join(tmpdir(), 'robota-serve-home-'));
    writeProviderSettings(binCwd);
    port = await findFreePort();

    child = spawn(
      process.execPath,
      [ROBOTA_BIN, '--serve', '--session-log', FIXTURE, '--no-session-persistence'],
      {
        cwd: binCwd,
        env: {
          PATH: process.env['PATH'] ?? '',
          HOME: homeDir,
          ROBOTA_WS_TOKEN: token,
          ROBOTA_WS_PORT: String(port),
        },
        stdio: 'ignore',
      },
    );

    await waitForServer(port, READY_BUDGET_MS);
  }, BEFORE_ALL_MS);

  afterAll(() => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    for (const d of [binCwd, homeDir]) rmSync(d, { recursive: true, force: true });
  });

  it('TC-A: rejects an unauthenticated connection before emitting any session data', async () => {
    const { frames, closed } = await driveClient(
      url('wrong-token'),
      () => {
        /* send nothing — a rejected socket must never reach a usable state */
      },
      (f) => f.some((m) => m.type === 'messages'),
      AUTH_REJECT_MS,
    );
    // The token gate closes the socket BEFORE the `messages` snapshot the server sends to authed clients.
    expect(closed).toBe(true);
    expect(frames.some((m) => m.type === 'messages')).toBe(false);
  });

  it(
    'TC-B: an authenticated client runs a turn and observes the recorded reply end-to-end',
    async () => {
      const { frames, timedOut } = await driveClient(
        url(),
        (send) => send({ type: 'submit', prompt: 'hello' }),
        (f) => f.some((m) => m.type === 'complete'),
        TURN_MS,
      );
      expect(timedOut).toBe(false);
      // Authed connect immediately yields the session `messages` snapshot...
      expect(frames.some((m) => m.type === 'messages')).toBe(true);
      // ...and the submitted turn completes with the replay-provider's recorded reply.
      const complete = frames.find((m) => m.type === 'complete');
      expect(complete?.result?.response).toBe(RECORDED_REPLY);
    },
    TC_B_TIMEOUT_MS,
  );

  it(
    'TC-C: SIGTERM shuts the runtime host down cleanly (graceful exit, no hang)',
    async () => {
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          child.once('exit', (code, signal) => resolve({ code, signal }));
        },
      );
      child.kill('SIGTERM');
      const race = await Promise.race([
        exited,
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), SHUTDOWN_MS)),
      ]);
      expect(race).not.toBe('timeout');
      // Graceful shutdown path (serve-mode awaits host.shutdown then returns → exit 0), not a SIGKILL/crash.
      const { code, signal } = race as { code: number | null; signal: NodeJS.Signals | null };
      expect(signal).not.toBe('SIGKILL');
      expect(code === 0 || code === null).toBe(true);
    },
    TC_C_TIMEOUT_MS,
  );
});
