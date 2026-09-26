#!/usr/bin/env node
/**
 * GUI-002 e2e fixture — a deterministic "robota" sidecar (no LLM / API key).
 *
 * The web e2e and `dev:web --scripted` start it directly; the desktop app's smoke test has Electron
 * spawn it via `ROBOTA_GUI_SIDECAR_CMD`. Either way it gets `ROBOTA_WS_TOKEN` + `ROBOTA_WS_PORT` in the
 * env exactly as the real CLI would. It stands up the **REAL**
 * `WsTransport` (so the GUI-002 T5 loopback-auth — reject-before-emit on a bad/missing token — is
 * exercised for real against the token the GUI presents) and attaches a **scripted** EventEmitter session
 * that replies deterministically, so the headless e2e can assert connect → render → submit → permission.
 * A fake session directory lists a few stored sessions and switches between them; a switch while a
 * scripted turn is still running ("stay busy" until "all done") is refused with the host's reason.
 *
 * Run as `daemon start --json` (how the desktop app attaches) it plays the CLI's daemon starter instead: it
 * reuses the daemon recorded in `$ROBOTA_E2E_DAEMON_STATE` while that process lives, or starts itself
 * detached as a new one, and prints the `{id,url}` line. `ROBOTA_E2E_DAEMON_FAIL=1` makes it refuse the way
 * an untrusted workspace does.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

import { WsTransport } from '@robota-sdk/agent-transport-ws';


/** One line of output (scripts write to the streams directly). */
const line = (text) => `${text}\n`;

/** Ask the OS for a free loopback port. */
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port: free } = server.address();
      server.close(() => resolve(free));
    });
  });

/** Whether something accepts a TCP connection on the loopback port. */
const accepts = (target) =>
  new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: target });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(400, () => done(false));
  });

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** `daemon start --json`: reuse the recorded live daemon, or start one detached, then print its line. */
async function daemonStart() {
  if (process.env.ROBOTA_E2E_DAEMON_FAIL === '1') {
    process.stderr.write(line('Workspace is not trusted. Run: robota trust --yes'));
    process.exit(1);
  }
  const statePath = process.env.ROBOTA_E2E_DAEMON_STATE;
  if (!statePath) {
    process.stderr.write(line('scripted-sidecar: ROBOTA_E2E_DAEMON_STATE required for daemon start'));
    process.exit(1);
  }
  if (existsSync(statePath)) {
    const recorded = JSON.parse(readFileSync(statePath, 'utf8'));
    if (Number.isInteger(recorded.pid) && isAlive(recorded.pid)) {
      process.stdout.write(line(JSON.stringify({ id: recorded.id, url: recorded.url })));
      process.exit(0);
    }
  }
  const daemonToken = randomBytes(32).toString('hex');
  const daemonPort = await freePort();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ROBOTA_WS_TOKEN: daemonToken, ROBOTA_WS_PORT: String(daemonPort) },
  });
  child.unref();
  const deadline = Date.now() + 15_000;
  while (!(await accepts(daemonPort))) {
    if (Date.now() >= deadline || child.exitCode !== null) {
      process.stderr.write(line('scripted-sidecar: the daemon did not come up'));
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const url = `ws://127.0.0.1:${daemonPort}?token=${daemonToken}`;
  writeFileSync(statePath, JSON.stringify({ pid: child.pid, id: 'scripted-daemon', url }));
  process.stdout.write(line(JSON.stringify({ id: 'scripted-daemon', url })));
  process.exit(0);
}

const argv = process.argv.slice(2);
if (argv.join(' ') === 'daemon start --json') await daemonStart();

const token = process.env.ROBOTA_WS_TOKEN;
const port = Number.parseInt(process.env.ROBOTA_WS_PORT ?? '0', 10);
if (!token || !port) {
  process.stderr.write(line('scripted-sidecar: ROBOTA_WS_TOKEN + ROBOTA_WS_PORT required'));
  process.exit(1);
}

/** Yield a macrotask so the renderer's streaming-text React state/ref flushes between emits. */
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

/** The stored sessions the fake directory holds; the first is current at start. */
const storedSessions = [
  { id: 'scripted-session', name: 'Scripted e2e session', updatedAt: minutesAgo(1), messages: [] },
  {
    id: 'earlier-session',
    updatedAt: minutesAgo(180),
    messages: [
      { role: 'user', content: 'What did we decide about the parser?' },
      { role: 'assistant', content: 'We kept the recursive-descent parser.' },
    ],
  },
  {
    id: 'oldest-session',
    updatedAt: minutesAgo(3 * 24 * 60),
    messages: [{ role: 'user', content: 'Set up the release checklist' }],
  },
];
const unreadableSessionIds = ['damaged-session'];

/** A scripted IInteractiveSession: EventEmitter for on/off/emit, deterministic submit + permission. */
class ScriptedSession extends EventEmitter {
  #pendingPermission = null;
  #mode = 'default';
  #current = storedSessions[0];
  #busy = false;

  get currentId() {
    return this.#current.id;
  }
  isBusy() {
    return this.#busy;
  }
  /** Make another stored session current: its conversation replaces this one's. */
  becomeSession(stored) {
    this.#current = stored;
    this.#pendingPermission = null;
    this.emit('session_switched', { sessionId: stored.id });
  }
  #record(role, content) {
    this.#current.messages.push({ role, content });
    this.#current.updatedAt = new Date().toISOString();
  }
  #complete(content) {
    this.#record('assistant', content);
    this.emit('complete', { success: true, content });
  }

  getMessages() {
    return this.#current.messages.map((message) => ({ ...message }));
  }
  getExecutionWorkspaceSnapshot() {
    return { entries: [] };
  }
  getContextState() {
    return { usedPercentage: 0, usedTokens: 0, maxTokens: 200000 };
  }
  getPendingPrompt() {
    return this.#pendingPermission ? 'permission' : null;
  }
  isExecuting() {
    return false;
  }
  getActiveDriverId() {
    return null;
  }
  getPendingCount() {
    return 0;
  }

  async submit(input) {
    // Echo the user's turn, then reply. A prompt containing "permission" raises a gated tool prompt.
    // Space the emits across ticks: a real LLM streams `text_delta` over time BEFORE `complete`, so the
    // renderer's streaming-text ref is populated by the time `complete` moves it into a message. Emitting
    // synchronously would race that React state update (a fixture artifact, not an app bug).
    this.emit('user_message', input);
    this.#record('user', String(input));
    const lower = String(input).toLowerCase();
    if (lower.includes('stay busy')) {
      // A turn that keeps running until "all done" — a switch meanwhile is refused.
      this.#busy = true;
      await tick();
      this.emit('thinking', true);
      this.emit('text_delta', 'Working on it...');
      return;
    }
    if (lower.includes('all done')) {
      this.#busy = false;
      await tick();
      this.emit('thinking', false);
      this.#complete('Working on it... finished.');
      return;
    }
    if (String(input).toLowerCase().includes('permission')) {
      this.#pendingPermission = 'perm-1';
      await tick();
      this.emit('permission_request', {
        id: 'perm-1',
        toolName: 'write_file',
        toolArgs: { path: 'x' },
      });
      return;
    }
    if (String(input).toLowerCase().includes('read')) {
      await tick();
      this.emit('tool_start', { toolName: 'Read', firstArg: 'src/a.ts', isRunning: true });
      await tick();
      this.emit('tool_end', { toolName: 'Read', firstArg: 'src/a.ts', isRunning: false });
      this.emit('text_delta', 'Read the file.');
      await tick();
      this.#complete('Read the file.');
      return;
    }
    if (String(input).toLowerCase().includes('fail')) {
      await tick();
      this.emit('thinking', true);
      this.emit('text_delta', 'Partial reply before failure.');
      await tick();
      this.emit('error', new Error('Scripted provider failure'));
      return;
    }
    await tick();
    this.emit('thinking', true);
    this.emit('text_delta', 'Hello from the scripted agent.');
    await tick();
    this.emit('thinking', false);
    this.#complete('Hello from the scripted agent.');
  }

  resolvePermission(id, result) {
    if (id !== this.#pendingPermission) return;
    this.#pendingPermission = null;
    this.emit('prompt_resolved', { id });
    // After the owner allows, the "tool" completes (spaced across ticks, as above).
    void (async () => {
      await tick();
      this.emit('text_delta', result ? 'Wrote the file.' : 'Denied.');
      await tick();
      this.#complete(result ? 'Wrote the file.' : 'Denied.');
    })();
  }

  resolveAsk() {}
  executeCommand(name) {
    if (name === 'help') {
      const lines = Array.from({ length: 30 }, (_, i) => `Command ${i + 1} (/c${i + 1}) — does thing ${i + 1}`);
      return Promise.resolve({ message: ['Available commands:', ...lines].join('\n'), success: true });
    }
    if (name === 'mode') {
      this.#mode = 'acceptEdits';
      return Promise.resolve({ message: 'Permission mode: acceptEdits', success: true });
    }
    if (name === 'resume') {
      this.emit('ui_intent', { intent: { type: 'show-session-picker' } });
      return Promise.resolve({ message: 'Opening session picker...', success: true });
    }
    if (name === 'settings') {
      this.emit('ui_intent', { intent: { type: 'show-settings' } });
      return Promise.resolve({ message: 'Opening settings...', success: true });
    }
    return Promise.resolve({ message: 'ok', success: true });
  }
  listCommands() {
    return [
      { name: 'help', description: 'Show available commands', modelInvocable: false },
      { name: 'mode', description: 'Show or change the permission mode', modelInvocable: false },
      { name: 'settings', description: 'Open settings', modelInvocable: false },
      { name: 'resume', description: 'Resume another session', modelInvocable: false },
    ];
  }
  listSkills() {
    return [
      { name: 'parity-demo', description: 'Replies with a fixed phrase', source: 'project', modelInvocable: true, userInvocable: true },
    ];
  }
  getStatusSnapshot() {
    return {
      sessionId: this.#current.id,
      model: 'scripted-model',
      permissionMode: this.#mode,
      effort: 'auto',
      context: { usedPercentage: 12, usedTokens: 24000, maxTokens: 200000, remainingPercentage: 88 },
      goal: null,
    };
  }
  abort() {}
  cancelQueue() {}
}

const session = new ScriptedSession();

/** The fake host's session directory: lists, starts and switches the stored sessions above. */
let newSessionCount = 0;
const sessionDirectory = {
  listSessions() {
    return {
      currentSessionId: session.currentId,
      sessions: [...storedSessions]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ id, name, updatedAt, messages }) => ({
          id,
          ...(name ? { name } : {}),
          cwd: '/scripted/workspace',
          updatedAt,
          messageCount: messages.length,
          preview: messages[0]?.content ?? '',
        })),
      unreadableSessionIds,
    };
  },
  async switchSession(sessionId) {
    if (session.isBusy()) throw new Error('Stop the running turn first.');
    const stored = storedSessions.find((candidate) => candidate.id === sessionId);
    if (!stored) throw new Error(`Session ${sessionId} could not be read.`);
    session.becomeSession(stored);
  },
  async newSession() {
    if (session.isBusy()) throw new Error('Stop the running turn first.');
    newSessionCount += 1;
    const stored = { id: `new-session-${newSessionCount}`, updatedAt: new Date().toISOString(), messages: [] };
    storedSessions.push(stored);
    session.becomeSession(stored);
  },
};
const usageBySource = {
  sessionId: 'usage-e2e-session',
  totalTokens: 42,
  promptTokens: 30,
  completionTokens: 12,
  costUsd: 0.0042,
  costExact: false,
  bySource: [],
  timeline: [
    { turnIndex: 0, source: { scope: 'main' }, label: 'main', spans: [], totalDurationMs: 0 },
  ],
};
const transport = new WsTransport({
  token,
  port,
  maxRetries: 0,
  allowedOrigins: ['file://'],
  personalUsageReporter: ({ period, timezone }) => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      period,
      timezone,
      interval: { startDate: today, endDate: today },
      totals: {
        sessions: 1,
        turns: 1,
        promptTokens: 30,
        completionTokens: 12,
        totalTokens: 42,
        costUsd: 0.0042,
        costStatus: 'estimated',
      },
      daily: [
        {
          date: today,
          partial: true,
          sessionIds: ['usage-e2e-session'],
          totals: {
            sessions: 1,
            turns: 1,
            promptTokens: 30,
            completionTokens: 12,
            totalTokens: 42,
            costUsd: 0.0042,
            costStatus: 'estimated',
          },
        },
      ],
      byModel: [
        {
          key: 'scripted-model',
          label: 'scripted-model',
          turns: 1,
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
          costUsd: 0.0042,
          costStatus: 'estimated',
          sessionIds: ['usage-e2e-session'],
        },
      ],
      byProvider: [
        {
          key: 'unknown',
          label: 'unknown',
          turns: 1,
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
          costUsd: 0.0042,
          costStatus: 'estimated',
          sessionIds: ['usage-e2e-session'],
        },
      ],
      bySurface: [
        {
          key: 'desktop-app',
          label: 'desktop-app',
          turns: 1,
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
          costUsd: 0.0042,
          costStatus: 'estimated',
          sessionIds: ['usage-e2e-session'],
        },
      ],
      bySource: [],
      byActivity: [{ key: 'tool:Read', label: 'Read', kind: 'tool', count: 2 }],
      sessionIds: ['usage-e2e-session'],
      coverage: {
        validSessions: 1,
        corruptSessions: 0,
        unsupportedSessions: 0,
        duplicateObservations: 0,
        legacyObservations: 0,
        unknownModelObservations: 0,
        unknownProviderObservations: 0,
        unknownSurfaceObservations: 0,
        corruptSessionIds: [],
        unsupportedSessionIds: [],
      },
    };
  },
  usageReporter: () => usageBySource,
  storedSessionUsageReporter: () => usageBySource,
  sessionDirectory,
});
transport.attach(session);
await transport.start();
process.stderr.write(line(`scripted-sidecar: listening on 127.0.0.1:${port} (token-gated)`));

// Graceful shutdown when the harness (or the e2e's cleanup) stops it.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    void transport.stop().finally(() => process.exit(0));
  });
}
