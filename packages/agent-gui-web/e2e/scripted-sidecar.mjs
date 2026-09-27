#!/usr/bin/env node
/**
 * GUI-002 e2e fixture — a deterministic "robota" sidecar (no LLM / API key).
 *
 * The web e2e and `gui:dev --scripted` start it directly; the desktop app's smoke test has Electron
 * spawn it via `ROBOTA_GUI_SIDECAR_CMD`. Either way it gets `ROBOTA_WS_TOKEN` + `ROBOTA_WS_PORT` in the
 * env exactly as the real CLI would. It stands up the **REAL**
 * `WsTransport` (so the GUI-002 T5 loopback-auth — reject-before-emit on a bad/missing token — is
 * exercised for real against the token the GUI presents) and attaches a **scripted** EventEmitter session
 * that replies deterministically, so the headless e2e can assert connect → render → submit → permission.
 * A fake session directory lists a few stored sessions and switches between them; a switch while a
 * scripted turn is still running ("stay busy" until "all done") is refused with the host's reason,
 * which the transport answers as `session_change_failed`. Its rows say which sessions are live and
 * how many clients are on each, as a daemon that keeps several sessions live does. It also renames
 * and deletes a stored session (#3289 §1), and its status snapshot carries a workspace folder.
 *
 * Run as `daemon start --json` (how the desktop app attaches) it plays the CLI's daemon starter instead: it
 * reuses the daemon recorded in `$ROBOTA_E2E_DAEMON_STATE` while that process lives, or starts itself
 * detached as a new one, and prints the `{id,url}` line. `ROBOTA_E2E_DAEMON_FAIL=1` makes it refuse the way
 * an untrusted workspace does, as does the file `$ROBOTA_E2E_DAEMON_FAIL_FILE` once it exists (so a start
 * the app asks for later can fail while the first succeeded). With `$ROBOTA_E2E_TRUST_FILE` set it also
 * plays `trust status --json` (askable until the file says `trusted`) and `trust --yes` (writes it), and a
 * `daemon start --json --restricted-workspace` records that choice in the daemon state.
 *
 * With `ROBOTA_E2E_SETUP_REQUIRED=1` (issue #3282 §3) the session starts as a served runtime with no
 * provider configured would: `getStatusSnapshot()` reports `setupRequired: true` and `submit()` refuses,
 * until `/provider add` (the GUI setup panel's one button) runs, asks one question the same way the
 * real wizard does, and clears the flag on an answer — proving the setup panel, its docked ask, and the
 * composer's return all work over the real wire, without a real provider or settings file.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AuthenticationError } from '@robota-sdk/agent-core';
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
async function daemonStart(restricted) {
  const failFile = process.env.ROBOTA_E2E_DAEMON_FAIL_FILE;
  if (process.env.ROBOTA_E2E_DAEMON_FAIL === '1' || (failFile && existsSync(failFile))) {
    process.stderr.write(line('Workspace is not trusted. Run: robota trust --yes'));
    process.exit(1);
  }
  const statePath = process.env.ROBOTA_E2E_DAEMON_STATE;
  if (!statePath) {
    process.stderr.write(line('scripted-sidecar: ROBOTA_E2E_DAEMON_STATE required for daemon start'));
    process.exit(1);
  }
  // Read directly rather than after an existence check: a missing state file is the only error
  // that means "no daemon recorded yet".
  let recorded;
  try {
    recorded = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (recorded && Number.isInteger(recorded.pid) && isAlive(recorded.pid)) {
    process.stdout.write(line(JSON.stringify({ id: recorded.id, url: recorded.url })));
    process.exit(0);
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
  // The URL carries the daemon's token, so a state file this creates is owner-only.
  writeFileSync(statePath, JSON.stringify({ pid: child.pid, id: 'scripted-daemon', url, restricted }), {
    mode: 0o600,
  });
  process.stdout.write(line(JSON.stringify({ id: 'scripted-daemon', url })));
  process.exit(0);
}

/** `trust status --json` / `trust --yes`, when the test gives the folder's trust a file to live in. */
function trust(command) {
  const trustFile = process.env.ROBOTA_E2E_TRUST_FILE;
  if (!trustFile) {
    process.stderr.write(line('scripted-sidecar: ROBOTA_E2E_TRUST_FILE required for trust'));
    process.exit(1);
  }
  if (command === 'trust --yes') {
    writeFileSync(trustFile, 'trusted');
    process.stdout.write(line('Workspace trust: trusted'));
    process.exit(0);
  }
  const trusted = existsSync(trustFile) && readFileSync(trustFile, 'utf8') === 'trusted';
  const workspace = process.cwd();
  process.stdout.write(
    line(
      JSON.stringify(
        trusted
          ? { state: 'trusted', workspace, askable: false, loads: [] }
          : {
              state: 'untrusted',
              workspace,
              askable: true,
              loads: ['  [file] AGENTS.md — Agent instructions'],
            },
      ),
    ),
  );
  process.exit(0);
}

const argv = process.argv.slice(2);
const command = argv.join(' ');
if (command === 'daemon start --json') await daemonStart(false);
if (command === 'daemon start --json --restricted-workspace') await daemonStart(true);
if (command === 'trust status --json' || command === 'trust --yes') trust(command);

const token = process.env.ROBOTA_WS_TOKEN;
const port = Number.parseInt(process.env.ROBOTA_WS_PORT ?? '0', 10);
// #3282 §4d: the composer resolves a picked/dropped file's path against `getStatusSnapshot().workspace.path`.
// A real absolute directory only when a test needs a real on-disk file to attach; the placeholder
// otherwise, matching the fake `cwd` the session-directory listing already uses below.
const workspaceCwd = process.env.ROBOTA_E2E_WORKSPACE_CWD ?? '/scripted/workspace';
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
  // The personal-usage report itself is content-free; the dashboard names this session from this
  // workspace's own local directory listing (its `name`), never from the report (#3289 §4).
  { id: 'usage-e2e-session', name: 'Usage e2e session', updatedAt: minutesAgo(2), messages: [] },
];
const unreadableSessionIds = ['damaged-session'];

/**
 * #3288 §1: the Agents panel's two fixture entries, appearing only once "show background work" is
 * sent (so every other scenario's session starts, and stays, with none — never interfering with an
 * unrelated selector elsewhere in this file, e.g. the composer's own "Stop" button). One is an
 * ordinary background task; the other is a `/loop`-managed entry (carries `loopId`), so the e2e can
 * exercise BOTH Stop routes — `cancel-background-task` and `/loop stop <id>`.
 */
function backgroundTaskEntry() {
  return {
    id: 'task:e2e-task-1',
    sourceId: 'e2e-task-1',
    kind: 'background_task',
    origin: { kind: 'tool_call', sessionId: 'scripted-session' },
    taskKind: 'agent',
    status: 'running',
    title: 'Reviewing the auth module',
    // Deliberately distinct from the transcript records below: the detail sheet shows this AND
    // the transcript together, and a real host would never hand both the same text.
    headline: { kind: 'activity', text: 'Checking the auth module for issues' },
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: new Date().toISOString(),
    controls: ['select', 'cancel'],
    state: 'working',
  };
}
function loopEntry() {
  return {
    id: 'task:loop-e2e-1',
    sourceId: 'loop-e2e-1',
    kind: 'background_task',
    origin: { kind: 'slash_command', sessionId: 'scripted-session', commandName: 'loop' },
    taskKind: 'scheduled',
    status: 'sleeping',
    title: 'Loop: check the deploy',
    // Deliberately distinct from the transcript records below (see the task entry's own note).
    headline: { kind: 'activity', text: 'Waiting to check the deploy again' },
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: new Date().toISOString(),
    controls: ['select', 'cancel'],
    state: 'working',
    loopId: 'loop-e2e-1',
  };
}
const executionDetailRecords = {
  'task:e2e-task-1': [
    { id: 'r1', kind: 'message', text: 'Reviewing packages/auth/login.ts' },
    { id: 'r2', kind: 'tool_activity', text: 'Read login.ts' },
  ],
  'task:loop-e2e-1': [{ id: 'l1', kind: 'message', text: 'check the deploy' }],
};

/** #3282 §2 (part 2): the two models the status row's model control switches between. */
const SCRIPTED_MODELS = [
  { id: 'scripted-model', label: 'Scripted Model' },
  { id: 'scripted-model-2', label: 'Scripted Model 2' },
];

/** A scripted IInteractiveSession: EventEmitter for on/off/emit, deterministic submit + permission. */
// #3282 §4 part b-3: the agent switcher's roster — name, one-line description, plain-words location.
const scriptedAgentDefinitions = [
  { name: 'general-purpose', description: 'General-purpose task execution agent.', definedIn: 'Built-in' },
  { name: 'Explore', description: 'Read-only codebase exploration agent.', definedIn: 'Built-in' },
];

class ScriptedSession extends EventEmitter {
  #pendingPermission = null;
  #pendingAsk = null;
  #mode = 'default';
  // #3282 §2 (part 2): the model the status row's model control switches between.
  #model = 'scripted-model';
  #current = storedSessions[0];
  #busy = false;
  #setupRequired = process.env.ROBOTA_E2E_SETUP_REQUIRED === '1';
  #pendingSetupAsk = null;
  #resolveSetupCommand = null;
  #executionWorkspaceEntries = [];
  // #3282 §4 part b-3: the agent switcher's current selection — `/agent <name>` (bare) sets it.
  #defaultAgentType = 'general-purpose';
  // #3282 §4 part b-3: the Agents panel's Scheduled group — one recurring schedule, cancellable.
  #schedules = [
    {
      id: 'sched_1',
      kind: 'scheduled',
      label: 'Scheduled: check the nightly build',
      status: 'sleeping',
      mode: 'background',
      parentSessionId: this.currentId,
      depth: 0,
      cwd: workspaceCwd,
      updatedAt: new Date().toISOString(),
      unread: false,
      nextFireAt: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString(),
      schedule: { cronExpression: '0 9 * * 1-5', agentInstruction: 'check the nightly build' },
    },
  ];
  // #3282 §4 part b-3: the current goal (`/goal`) — null until a scripted turn sets one (a submit
  // containing "set a goal"), so every OTHER e2e scenario sees exactly what it saw before this
  // feature — no goal bar/row unless the scenario asks for one. Cancel goal runs `/goal cancel`.
  #goal = null;

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
    // #3288 §2: `display` mirrors what the REAL server's `getMessagesDisplay()` projects from stored
    // history — a text segment per role-run, plus one 'tool' segment per finished call (recorded by
    // `#recordToolEnd`, below, at the same point a real `tool_end` would be persisted). Kept beside
    // `messages`, never derived from it — `messages` alone cannot tell a Read from an Edit.
    this.#current.display ??= [];
    if (content) this.#current.display.push({ type: 'text', role, content });
    this.#current.updatedAt = new Date().toISOString();
  }
  #recordToolEnd(state) {
    this.#current.display ??= [];
    this.#current.display.push({ type: 'tool', tool: { ...state, isRunning: false } });
  }
  #complete(content) {
    this.#record('assistant', content);
    this.emit('complete', { success: true, content });
  }

  getMessages() {
    return this.#current.messages.map((message) => ({ ...message }));
  }
  /** #3288 §2: a reload/reconnect replay renders THIS — the same projection the real server sends. */
  getMessagesDisplay() {
    if (this.#current.display) {
      return this.#current.display.map((segment) =>
        segment.type === 'tool' ? { type: 'tool', tool: { ...segment.tool } } : { ...segment },
      );
    }
    // A session whose transcript is fixture SEED DATA (module-scope `storedSessions`, never touched
    // by `#record`/`#recordToolEnd`) has no `display` array yet. None of the seed data includes a
    // tool call, so a straight text-segment map is exact, not an approximation — and avoids keeping
    // two parallel copies of the same seed content in sync by hand.
    return this.#current.messages.map((m) => ({ type: 'text', role: m.role, content: m.content }));
  }
  getExecutionWorkspaceSnapshot() {
    return {
      sessionId: this.#current.id,
      updatedAt: new Date().toISOString(),
      entries: this.#executionWorkspaceEntries,
    };
  }
  #emitExecutionWorkspaceUpdated() {
    this.emit('execution_workspace_event', {
      type: 'execution_workspace_updated',
      cause: 'background_task',
      snapshot: this.getExecutionWorkspaceSnapshot(),
    });
  }
  readExecutionWorkspaceDetail(entryId) {
    const records = executionDetailRecords[entryId];
    if (!records) return Promise.reject(new Error(`Unknown execution entry: ${entryId}`));
    return Promise.resolve({ entryId, records });
  }
  getContextState() {
    return { usedPercentage: 0, usedTokens: 0, maxTokens: 200000 };
  }
  // #3280 §2: the QUEUED-MESSAGE the host has taken but not yet run (a submit behind a running turn)
  // — unrelated to a pending PERMISSION prompt (`#pendingPermission`, above). This fixture never queues
  // a second submit behind a running one, so there is never a next prompt to report.
  getPendingPrompt() {
    return null;
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
    // #3282 §3: a backstop, unreachable through the GUI itself — the composer is hidden while setup is
    // required, exactly like the real InteractiveSession.submit() guard this mirrors.
    if (this.#setupRequired) {
      throw new Error('Connect a model provider to start.');
    }
    // Echo the user's turn, then reply. A prompt containing "permission" raises a gated tool prompt.
    // Space the emits across ticks: a real LLM streams `text_delta` over time BEFORE `complete`, so the
    // renderer's streaming-text ref is populated by the time `complete` moves it into a message. Emitting
    // synchronously would race that React state update (a fixture artifact, not an app bug).
    this.emit('user_message', input);
    this.#record('user', String(input));
    const lower = String(input).toLowerCase();
    // #3288 §1: populate the Agents panel's two fixture entries (a background task and a loop) —
    // only on this explicit trigger, so every other scenario's session keeps none, ever.
    if (lower.includes('show background work')) {
      this.#executionWorkspaceEntries = [backgroundTaskEntry(), loopEntry()];
      this.#emitExecutionWorkspaceUpdated();
      await tick();
      this.emit('thinking', true);
      this.emit('text_delta', 'Started background work.');
      await tick();
      this.emit('thinking', false);
      this.#complete('Started background work.');
      return;
    }
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
    if (lower.includes('set a goal')) {
      // #3282 §4 part b-3: puts an active goal in `getStatusSnapshot()` — the GUI's own `get-status`
      // refresh after this turn completes is what the Agents panel's Goal row picks it up from.
      this.#goal = {
        id: 'goal_1',
        objective: 'Land the release notes',
        status: 'active',
        iterations: 2,
        maxIterations: 25,
        startedAt: new Date().toISOString(),
        progress: [],
      };
      await tick();
      this.emit('thinking', true);
      this.emit('text_delta', 'Goal set — pursuing autonomously.');
      await tick();
      this.emit('thinking', false);
      this.#complete('Goal set — pursuing autonomously.');
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
    if (String(input).toLowerCase().includes('duplicate')) {
      // A free-text ask (#3280 §3), mirroring `/provider` → a profile → Duplicate.
      this.#pendingAsk = 'ask-1';
      await tick();
      this.emit('ask_request', {
        id: 'ask-1',
        request: {
          id: 'ask-1',
          title: 'Duplicate anthropic as',
          allowFreeText: true,
          placeholder: 'anthropic-copy',
        },
      });
      return;
    }
    if (lower.includes('long reply')) {
      // #3289 §2 — many chunks over real time, long enough to scroll several screens: the e2e wheel-
      // scrolls up mid-stream and checks the view stays put, then uses "Jump to latest". Kept short
      // per paragraph and to a bounded count on purpose: `AgentMarkdown` re-parses every settled
      // message on each later render, so a needlessly large one here would slow down every scenario
      // that follows it, not just this one.
      this.#busy = true;
      await tick();
      this.emit('thinking', true);
      let acc = '';
      for (let i = 1; i <= 20; i += 1) {
        const chunk = `Paragraph ${i} of the long reply, on its own line so there is real distance to scroll.\n\n`;
        acc += chunk;
        this.emit('text_delta', chunk);
        await tick(60);
      }
      this.#busy = false;
      this.emit('thinking', false);
      this.#complete(acc);
      return;
    }
    if (lower.includes('show code')) {
      // #3289 §2 — a fenced code block, for the copy-code e2e.
      await tick();
      this.emit('thinking', true);
      const code = ['function greet(name) {', "  return `Hello, ${name}!`;", '}'].join('\n');
      const reply = ['Here you go:', '', '```js', code, '```'].join('\n');
      this.emit('text_delta', reply);
      await tick();
      this.emit('thinking', false);
      this.#complete(reply);
      return;
    }
    if (String(input).toLowerCase().includes('read')) {
      await tick();
      this.emit('tool_start', { toolName: 'Read', firstArg: 'src/a.ts', isRunning: true });
      await tick();
      const readEnd = { toolName: 'Read', firstArg: 'src/a.ts', isRunning: false };
      this.emit('tool_end', readEnd);
      this.#recordToolEnd(readEnd);
      this.emit('text_delta', 'Read the file.');
      await tick();
      this.#complete('Read the file.');
      return;
    }
    // #3288: an Edit call carries a server-built diff, and a Shell call carries its output + exit
    // status — the e2e drives both through to the GUI's expandable tool rows.
    if (String(input).toLowerCase().includes('edit')) {
      await tick();
      this.emit('tool_start', {
        toolName: 'Edit',
        firstArg: '/workspace/src/task-title.ts',
        isRunning: true,
        executionId: 'exec-edit-1',
        // The real server sets `displayPath` at tool_start (it's a start-time argument, resolved
        // relative to cwd before execution) — never re-set at tool_end.
        displayPath: 'src/task-title.ts',
      });
      await tick();
      const editEnd = {
        toolName: 'Edit',
        firstArg: '/workspace/src/task-title.ts',
        isRunning: false,
        result: 'success',
        executionId: 'exec-edit-1',
        diffFile: 'src/task-title.ts',
        diffLines: [
          { type: 'hunk', text: '@@ -1,2 +1,2 @@', lineNumber: 1 },
          { type: 'remove', text: "const title = 'old';", lineNumber: 1 },
          { type: 'add', text: "const title = 'new';", lineNumber: 1 },
        ],
      };
      this.emit('tool_end', editEnd);
      // #3288 §2: the LIVE `tool_end` never repeats `displayPath` (see the `tool_start` comment
      // above — real servers set it only once, at start), but a REPLAYED row has no earlier
      // `tool_start` frame to have kept it from — the real projector (`interactive-session-history-
      // projection.ts`) recomputes it fresh from the call's own `file_path` argument and the
      // session's cwd, every time. This fixture has no such argument/cwd machinery, so it captures
      // the SAME value here instead, for the one thing `#recordToolEnd` needs it to survive.
      this.#recordToolEnd({ ...editEnd, displayPath: 'src/task-title.ts' });
      this.emit('text_delta', 'Edited the title.');
      await tick();
      this.#complete('Edited the title.');
      return;
    }
    if (String(input).toLowerCase().includes('run tests')) {
      await tick();
      this.emit('tool_start', {
        toolName: 'Bash',
        firstArg: 'pnpm test',
        isRunning: true,
        executionId: 'exec-shell-1',
      });
      await tick();
      const shellEnd = {
        toolName: 'Bash',
        firstArg: 'pnpm test',
        isRunning: false,
        result: 'success',
        executionId: 'exec-shell-1',
        toolResultData: JSON.stringify({
          success: true,
          output: 'Test Files  1 passed (1)\nTests  3 passed (3)',
          exitCode: 0,
        }),
      };
      this.emit('tool_end', shellEnd);
      this.#recordToolEnd(shellEnd);
      this.emit('text_delta', 'Tests passed.');
      await tick();
      this.#complete('Tests passed.');
      return;
    }
    if (String(input).toLowerCase().includes('fail')) {
      // #3289 §3: a real provider failure (an AuthenticationError, same as the built-in providers
      // now throw), not a bare Error — the GUI is expected to say what happened in plain words.
      await tick();
      this.emit('thinking', true);
      this.emit('text_delta', 'Partial reply before failure.');
      await tick();
      this.emit('error', new AuthenticationError('Scripted provider failure: invalid API key', 'anthropic'));
      return;
    }
    await tick();
    this.emit('thinking', true);
    // #3282 §2 (part 2): names the model that answered, so an e2e that switches models via the
    // status row's model control can confirm the NEXT reply actually used the new one.
    const reply = `Hello from the scripted agent. (model: ${this.#model})`;
    this.emit('text_delta', reply);
    await tick();
    this.emit('thinking', false);
    this.#complete(reply);
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

  resolveAsk(id, response) {
    if (id === this.#pendingSetupAsk) {
      // #3282 §3: the setup wizard's one question, answered — a real provider profile now "exists",
      // so the panel's job is done and the composer is the way in again.
      this.#pendingSetupAsk = null;
      this.#setupRequired = false;
      this.emit('prompt_resolved', { id });
      const model = response.type === 'answer' && response.text ? response.text : 'scripted-model';
      this.#resolveSetupCommand?.({ message: `Provider configured (${model}).`, success: true });
      this.#resolveSetupCommand = null;
      return;
    }
    if (id !== this.#pendingAsk) return;
    this.#pendingAsk = null;
    this.emit('prompt_resolved', { id });
    const outcome =
      response.type === 'answer' ? `Duplicated as ${response.text ?? ''}.` : 'Duplicate cancelled.';
    void (async () => {
      await tick();
      this.emit('text_delta', outcome);
      await tick();
      this.#complete(outcome);
    })();
  }
  executeCommand(name, args = '') {
    if (name === 'provider' && args.trim() === 'add') {
      // #3282 §3: mirrors the real `/provider add` wizard closely enough for the e2e — it asks (at
      // least) one question through the same ask channel any other command uses, and does not
      // resolve until it is answered, exactly like the real setup flow's own blocking prompt.
      return new Promise((resolve) => {
        this.#resolveSetupCommand = resolve;
        this.#pendingSetupAsk = 'setup-ask-provider';
        void tick().then(() => {
          this.emit('ask_request', {
            id: 'setup-ask-provider',
            request: {
              id: 'setup-ask-provider',
              title: 'Provider model',
              allowFreeText: true,
              placeholder: 'scripted-model',
            },
          });
        });
      });
    }
    if (name === 'context') {
      // #3282 §4e: `/help` is now the GUI's own Help sheet and never reaches this scripted sidecar —
      // `/context` stands in for it here, purely to exercise the folded-long-output card.
      const lines = Array.from({ length: 30 }, (_, i) => `Command ${i + 1} (/c${i + 1}) — does thing ${i + 1}`);
      return Promise.resolve({ message: ['Available commands:', ...lines].join('\n'), success: true });
    }
    if (name === 'mode') {
      this.#mode = 'acceptEdits';
      return Promise.resolve({ message: 'Permission mode: acceptEdits', success: true });
    }
    // #3282 §2 (part 2): the model control sends `/model <id>` directly (no picker round trip) —
    // mirrors the real command's shape closely enough for the e2e to switch models and check the
    // next reply used the new one.
    if (name === 'model') {
      const id = args.trim();
      const found = SCRIPTED_MODELS.find((candidate) => candidate.id === id);
      if (!found) {
        return Promise.resolve({
          message: `Unknown model "${id}". Run /model to see the choices.`,
          success: false,
        });
      }
      this.#model = found.id;
      return Promise.resolve({ message: `Model: ${found.label}`, success: true });
    }
    if (name === 'resume') {
      this.emit('ui_intent', { intent: { type: 'show-session-picker' } });
      return Promise.resolve({ message: 'Opening session picker...', success: true });
    }
    if (name === 'settings') {
      this.emit('ui_intent', { intent: { type: 'show-settings' } });
      return Promise.resolve({ message: 'Opening settings...', success: true });
    }
    // #3288 §1: `/loop stop <id>` — a loop always stops this way, never cancel-background-task
    // (its own disposable wake timer, when it has one, is not the loop itself).
    if (name === 'loop') {
      const stopMatch = /^stop\s+(\S+)$/.exec(args);
      if (stopMatch) {
        const loopId = stopMatch[1];
        const before = this.#executionWorkspaceEntries.length;
        // A stopped loop does not linger — it leaves the list on the next snapshot (#3288 §1).
        this.#executionWorkspaceEntries = this.#executionWorkspaceEntries.filter(
          (entry) => entry.loopId !== loopId,
        );
        if (this.#executionWorkspaceEntries.length === before) {
          return Promise.resolve({ success: false, message: `Active loop not found: ${loopId}` });
        }
        this.#emitExecutionWorkspaceUpdated();
        return Promise.resolve({
          success: true,
          message: `Loop stopped: ${loopId}. An already-running turn may finish.`,
        });
      }
    }
    if (name === 'rename') {
      // #3289 §1: renaming the CURRENT session goes through this command (not the directory's
      // `renameSession`) so the live session's own name and the sidebar row update together, exactly
      // as the real `InteractiveSession` does (`setName` + a `session_renamed` broadcast).
      const newName = args.trim();
      if (newName === '') return Promise.resolve({ message: 'Usage: /rename <name>', success: false });
      this.#current.name = newName;
      this.emit('session_renamed', { name: newName });
      return Promise.resolve({ message: `Session renamed to "${newName}".`, success: true });
    }
    // #3282 §4 part b-2: `/plugin` opens the Settings screen's Plugins section.
    if (name === 'plugin') {
      this.emit('ui_intent', { intent: { type: 'show-plugin-manager' } });
      return Promise.resolve({ message: 'Opening plugin manager...', success: true });
    }
    if (name === 'agent') {
      const trimmed = args.trim();
      if (trimmed === '') {
        this.emit('ui_intent', { intent: { type: 'show-agent-switcher' } });
        return Promise.resolve({ message: '', success: true });
      }
      // #3282 §4 part b-3: a bare known name selects the default — the same path choosing a row in
      // the switcher sheet runs.
      if (scriptedAgentDefinitions.some((agent) => agent.name === trimmed)) {
        this.#defaultAgentType = trimmed;
        return Promise.resolve({
          message: `Default agent: ${trimmed}`,
          success: true,
          data: { agentType: trimmed },
        });
      }
      return Promise.resolve({ message: `Unknown agent type: ${trimmed}`, success: false });
    }
    if (name === 'schedule') {
      const [verb, id] = args.trim().split(/\s+/);
      const found = this.#schedules.find((task) => task.id === id);
      if (verb === 'pause' && found) {
        found.status = 'paused';
        return Promise.resolve({ message: `Schedule paused: ${id}`, success: true });
      }
      if (verb === 'resume' && found) {
        found.status = 'sleeping';
        return Promise.resolve({ message: `Schedule resumed: ${id}`, success: true });
      }
      return Promise.resolve({ message: `Unknown schedule: ${id}`, success: false });
    }
    if (name === 'goal') {
      if (args.trim() === 'cancel') {
        if (!this.#goal || this.#goal.status !== 'active') {
          return Promise.resolve({ message: 'No active goal to cancel.', success: false });
        }
        this.#goal = { ...this.#goal, status: 'stopped', stopReason: 'cancelled' };
        return Promise.resolve({
          message: `Goal cancelled: ${this.#goal.objective}`,
          success: true,
        });
      }
      return Promise.resolve({ message: 'No goal is set.', success: true });
    }
    return Promise.resolve({ message: 'ok', success: true });
  }
  // #3282 §4 part b-3: the agent switcher's roster, with `definedIn` (a discovered file's path, or
  // "Built-in") — a plain-words location a person picking an agent can read.
  listAgentDefinitions() {
    return scriptedAgentDefinitions.map((agent) => ({ ...agent }));
  }
  getDefaultAgentType() {
    return this.#defaultAgentType;
  }
  // #3282 §4 part b-3: the Agents panel's Scheduled group reads through the SAME generic
  // `get-background-tasks` path a real host answers, filtered to `kind: 'scheduled'`.
  listBackgroundTasks(filter) {
    if (filter?.kind && filter.kind !== 'scheduled') return [];
    return this.#schedules.map((task) => ({ ...task }));
  }
  getBackgroundTask(taskId) {
    const found = this.#schedules.find((task) => task.id === taskId);
    return found ? { ...found } : undefined;
  }
  // #3288 §1: a task's own Stop — never a loop's (that always goes through /loop stop <id> above,
  // even for a loop's own disposable wake timer, which this fixture never separately models).
  // #3282 §4 part b-3: also the Agents panel's schedule Delete — a schedule IS a background task,
  // and cancelling one is permanent, exactly like the real `BackgroundTaskManager.cancel()`.
  async cancelBackgroundTask(taskId) {
    const entry = this.#executionWorkspaceEntries.find((candidate) => candidate.sourceId === taskId);
    if (entry) {
      if (entry.loopId !== undefined) {
        throw new Error(`No stoppable task: ${taskId}`);
      }
      entry.status = 'cancelled';
      entry.updatedAt = new Date().toISOString();
      // Terminal now — 'cancel' is no longer offered (a stopped task does not still offer Stop).
      entry.controls = ['select', 'close'];
      this.#emitExecutionWorkspaceUpdated();
      return;
    }
    const schedule = this.#schedules.find((task) => task.id === taskId);
    if (!schedule) throw new Error(`Unknown background task: ${taskId}`);
    schedule.status = 'cancelled';
  }
  listCommands() {
    return [
      { name: 'help', description: 'Show available commands', modelInvocable: false, runner: 'runtime' },
      { name: 'mode', description: 'Show or change the permission mode', modelInvocable: false, runner: 'runtime' },
      { name: 'settings', description: 'Open settings', modelInvocable: false, runner: 'runtime' },
      { name: 'plugin', description: 'Manage plugins', modelInvocable: false, runner: 'runtime' },
      { name: 'resume', description: 'Resume another session', modelInvocable: false, runner: 'runtime' },
      { name: 'context', description: 'Show context window usage', modelInvocable: false, runner: 'runtime' },
      { name: 'theme', description: 'Change the terminal colour theme', modelInvocable: false, runner: 'client', surfaces: ['terminal'] },
      // A command the terminal runs itself: the GUI's menu marks it rather than running it.
      {
        name: 'shell',
        description: 'Open an interactive shell',
        modelInvocable: false,
        runner: 'client',
        surfaces: ['terminal'],
      },
    ];
  }
  listSkills() {
    return [
      { name: 'parity-demo', description: 'Replies with a fixed phrase', source: 'project', modelInvocable: true, userInvocable: true },
    ];
  }
  // #3282 §2 (part 2): backs `list-models` -> `model_list`, the model control's pop-up menu.
  listModels() {
    return {
      groups: [{ profileName: 'scripted', providerLabel: 'Scripted', models: SCRIPTED_MODELS }],
      currentProfile: 'scripted',
      currentModel: this.#model,
    };
  }
  getStatusSnapshot() {
    return {
      sessionId: this.#current.id,
      model: this.#setupRequired ? 'setup-required' : this.#model,
      permissionMode: this.#mode,
      effort: 'auto',
      context: { usedPercentage: 12, usedTokens: 24000, maxTokens: 200000, remainingPercentage: 88 },
      goal: this.#goal,
      // Absent (never `false`) once set up, exactly like the real ISessionStatusSnapshot field.
      ...(this.#setupRequired ? { setupRequired: true } : {}),
      // #3289 §1: the folder the title bar and document.title show; #3282 §4d resolves attached
      // files' paths against it, so it defaults to the same '/scripted/workspace' but can be pointed
      // at a real temp directory via ROBOTA_E2E_WORKSPACE_CWD.
      workspace: { name: basename(workspaceCwd), path: workspaceCwd },
    };
  }
  // #3280 §2: Stop (button or Esc) sends `abort` — end a "stay busy" turn the same way a real one
  // interrupts: the partial reply already streamed (`text_delta`) stays, as `interrupted` keeps it.
  abort() {
    if (!this.#busy) return;
    this.#busy = false;
    this.#record('assistant', 'Working on it...');
    this.emit('thinking', false);
    this.emit('interrupted', { success: false, content: 'Working on it...' });
  }
  cancelQueue() {}

  // #3282 §4c: the Project panel — one modified file's status, its diff on request, and project
  // memory (unavailable in this fixture, the common case: off by default).
  readProjectStatus() {
    return Promise.resolve({
      kind: 'status',
      branch: 'main',
      unborn: false,
      files: [{ path: 'src/task-title.ts', status: 'Modified', added: 1, removed: 1 }],
      truncated: false,
    });
  }
  readProjectDiff(path) {
    if (path !== 'src/task-title.ts') {
      return Promise.resolve({ kind: 'failed', message: `Unknown path: ${path}` });
    }
    return Promise.resolve({
      kind: 'diff',
      diffLines: [
        { type: 'hunk', text: '@@ -1,2 +1,2 @@', lineNumber: 1 },
        { type: 'remove', text: "const title = 'old';", lineNumber: 1 },
        { type: 'add', text: "const title = 'new';", lineNumber: 1 },
      ],
      truncated: false,
    });
  }
  readProjectMemory() {
    return Promise.resolve({
      kind: 'unavailable',
      message: "Project memory isn't available for this folder.",
    });
  }
}

const session = new ScriptedSession();

/**
 * A refusal the transport recognises, so it answers `session_change_failed` with this code (the shape
 * `isSessionChangeRefusal` in agent-interface-session checks).
 */
const refusal = (code, message) => Object.assign(new Error(message), { name: 'SessionChangeRefusal', code });

/**
 * Sessions live in the fake host besides the current one, with the clients on them: another terminal
 * is on the oldest session, so its row shows one other client.
 */
const liveElsewhere = new Map([['oldest-session', 1]]);

/** The fake host's session directory: lists, starts and switches the stored sessions above. */
let newSessionCount = 0;
const sessionDirectory = {
  listSessions() {
    return {
      currentSessionId: session.currentId,
      sessions: [...storedSessions]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ id, name, updatedAt, messages }) => {
          // The e2e page is the one client on the current session.
          const clients = id === session.currentId ? 1 : (liveElsewhere.get(id) ?? 0);
          // #3289 §1: a stable title from the first user message — `preview` (the last reply) stays
          // beside it unchanged, for a consumer that still wants that.
          const firstUser = messages.find((message) => message.role === 'user');
          return {
            id,
            ...(name ? { name } : {}),
            cwd: '/scripted/workspace',
            updatedAt,
            messageCount: messages.length,
            preview: messages[0]?.content ?? '',
            ...(firstUser ? { title: firstUser.content } : {}),
            live: clients > 0,
            clients,
          };
        }),
      unreadableSessionIds,
    };
  },
  async switchSession(sessionId) {
    if (session.isBusy()) throw refusal('failed', 'Stop the running turn first.');
    const stored = storedSessions.find((candidate) => candidate.id === sessionId);
    if (!stored) throw refusal('unknown_session', `Session ${sessionId} could not be read.`);
    session.becomeSession(stored);
  },
  async newSession() {
    if (session.isBusy()) throw refusal('failed', 'Stop the running turn first.');
    newSessionCount += 1;
    const stored = { id: `new-session-${newSessionCount}`, updatedAt: new Date().toISOString(), messages: [] };
    storedSessions.push(stored);
    session.becomeSession(stored);
  },
  // #3289 §1: rename any stored session — current or not — by writing its record directly, as the
  // real directory does for a row that is not the one this client is on.
  async renameSession(sessionId, name) {
    const stored = storedSessions.find((candidate) => candidate.id === sessionId);
    if (!stored) throw new Error(`No session ${sessionId} in this workspace.`);
    stored.name = name;
  },
  // #3289 §1: delete a stored session; deleting the current one switches away first, exactly like
  // the real directory.
  async deleteSession(sessionId) {
    const index = storedSessions.findIndex((candidate) => candidate.id === sessionId);
    if (index === -1) {
      throw Object.assign(new Error(`No session ${sessionId} in this workspace.`), {
        name: 'SessionDeleteRefusal',
        code: 'unknown_session',
      });
    }
    const isCurrent = sessionId === session.currentId;
    storedSessions.splice(index, 1);
    if (isCurrent) {
      const next = storedSessions[0];
      if (next) {
        session.becomeSession(next);
      } else {
        newSessionCount += 1;
        const fresh = {
          id: `new-session-${newSessionCount}`,
          updatedAt: new Date().toISOString(),
          messages: [],
        };
        storedSessions.push(fresh);
        session.becomeSession(fresh);
      }
    }
  },
};
/**
 * #3282 §4a: an in-memory settings document the Settings screen reads and writes, the same way
 * `storedSessions` gives the session-directory scenarios durable, in-process state a test can
 * observe across a close-then-reopen. `scope: 'user'` matches the one writable store the real CLI
 * wires for the demo settings this fixture models.
 */
const scriptedSettings = { language: 'en', outputStyle: 'default', preset: 'default', permissionMode: 'default', sandboxEnabled: true };
const OUTPUT_STYLES = [
  { id: 'default', label: 'Default', description: 'The ordinary response style.' },
  { id: 'concise', label: 'Concise', description: 'Shorter, to-the-point replies.' },
];
const PRESETS = [
  { id: 'default', label: 'Default', description: 'Neutral baseline — no overrides.' },
  { id: 'careful-reviewer', label: 'Careful Reviewer', description: 'Ask-first, review-oriented posture.' },
];
const PERMISSION_MODE_CHOICES = [
  { id: 'default', label: 'Ask first', description: 'Ask before risky actions' },
  { id: 'acceptEdits', label: 'Accept edits', description: 'Auto-approve file edits' },
  { id: 'bypassPermissions', label: 'Skip all checks', description: 'Skip all permission checks' },
];
let permissionRules = [
  { scope: 'user', source: '~/.robota/settings.json', kind: 'allow', pattern: 'Bash(git status:*)' },
];
/** #3282 §4 part b-2: the MCP Servers and Plugins sections' in-memory, scripted state. */
let scriptedMcpServers = [
  {
    id: 'docs',
    name: 'docs',
    scopeLabel: 'This project',
    status: 'connected',
    toolNames: ['search_docs', 'read_doc'],
    enabled: true,
  },
];
let scriptedPlugins = [
  { id: 'formatter@robota', name: 'formatter@robota', description: 'Formats code on save.', enabled: true },
];

function buildSettingsSnapshot() {
  return {
    language: {
      current: scriptedSettings.language,
      recommended: [
        { id: 'ko', label: 'Korean', description: 'ko' },
        { id: 'en', label: 'English', description: 'en' },
        { id: 'ja', label: 'Japanese', description: 'ja' },
      ],
      appliesNote: 'Takes effect the next time Robota starts — changing it here never restarts it.',
    },
    outputStyle: { current: scriptedSettings.outputStyle, choices: OUTPUT_STYLES },
    preset: { current: scriptedSettings.preset, choices: PRESETS, skipsAllChecksPresetIds: [] },
    permissionMode: {
      current: scriptedSettings.permissionMode,
      choices: PERMISSION_MODE_CHOICES,
      skipsAllChecksMode: 'bypassPermissions',
    },
    permissionRules: permissionRules.map((rule) => ({
      id: `${rule.scope}:${rule.kind}:${rule.pattern}`,
      ...rule,
      removable: true,
    })),
    sandbox: {
      enabled: scriptedSettings.sandboxEnabled,
      available: true,
      description: 'Confines shell commands to the workspace and temp directories, without a prompt for each one.',
    },
    mcp: { servers: scriptedMcpServers },
    plugins: { plugins: scriptedPlugins, canInstall: true },
  };
}

const settingsReporter = {
  getSettings: () => buildSettingsSnapshot(),
  updateSettings: (_session, patch) => {
    switch (patch.field) {
      case 'language':
        scriptedSettings.language = patch.language;
        break;
      case 'outputStyle':
        if (!OUTPUT_STYLES.some((choice) => choice.id === patch.styleId)) {
          return { ok: false, code: 'invalid', message: `Unknown output style "${patch.styleId}".` };
        }
        scriptedSettings.outputStyle = patch.styleId;
        break;
      case 'preset':
        if (!PRESETS.some((choice) => choice.id === patch.presetId)) {
          return { ok: false, code: 'invalid', message: `Unknown preset "${patch.presetId}".` };
        }
        scriptedSettings.preset = patch.presetId;
        break;
      case 'permissionMode':
        if (!PERMISSION_MODE_CHOICES.some((choice) => choice.id === patch.mode)) {
          return { ok: false, code: 'invalid', message: `Unknown permission mode "${patch.mode}".` };
        }
        scriptedSettings.permissionMode = patch.mode;
        break;
      case 'sandbox':
        scriptedSettings.sandboxEnabled = patch.enabled;
        break;
      case 'removePermissionRule': {
        const before = permissionRules.length;
        permissionRules = permissionRules.filter(
          (rule) =>
            !(rule.scope === patch.scope && rule.kind === patch.kind && rule.pattern === patch.pattern),
        );
        if (permissionRules.length === before) {
          return { ok: false, code: 'invalid', message: 'That rule was already gone.' };
        }
        break;
      }
      case 'mcpServerEnabled': {
        const server = scriptedMcpServers.find((s) => s.id === patch.serverId);
        if (!server) return { ok: false, code: 'invalid', message: `Unknown MCP server "${patch.serverId}".` };
        scriptedMcpServers = scriptedMcpServers.map((s) =>
          s.id === patch.serverId
            ? { ...s, enabled: patch.enabled, status: patch.enabled ? 'connected' : 'disabled' }
            : s,
        );
        break;
      }
      case 'reloadMcpServers':
        // Scripted: nothing to reconnect, but the round trip must still succeed.
        break;
      case 'pluginEnabled': {
        const plugin = scriptedPlugins.find((p) => p.id === patch.pluginId);
        if (!plugin) return { ok: false, code: 'invalid', message: `Unknown plugin "${patch.pluginId}".` };
        scriptedPlugins = scriptedPlugins.map((p) =>
          p.id === patch.pluginId ? { ...p, enabled: patch.enabled } : p,
        );
        break;
      }
      case 'reloadPlugins':
        break;
      case 'installPlugin':
        scriptedPlugins = [
          ...scriptedPlugins,
          { id: patch.pluginId, name: patch.pluginId, description: 'Installed in this scripted session.', enabled: true },
        ];
        break;
      case 'uninstallPlugin':
        scriptedPlugins = scriptedPlugins.filter((p) => p.id !== patch.pluginId);
        break;
      default:
        return { ok: false, code: 'invalid', message: 'Unknown settings field.' };
    }
    return { ok: true, settings: buildSettingsSnapshot() };
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
      // The report carries no name for this session — the dashboard reads "Usage e2e session" from
      // this workspace's own local session-directory listing above, never from the report (#3289 §4).
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
  settingsReporter,
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
