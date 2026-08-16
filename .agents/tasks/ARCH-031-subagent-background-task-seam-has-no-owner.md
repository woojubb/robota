---
title: 'ARCH-031: the subagent↔background-task request/result seam has no owner — one field family is declared three times and carried by hand-written literals, so every new field is dropped at the hops nobody remembered'
status: todo
created: 2026-08-16
priority: high
urgency: soon
area: packages/agent-interface-transport, packages/agent-executor, packages/agent-framework, packages/agent-subagent-runner
depends_on: []
issue: https://github.com/woojubb/robota/issues/1747
---

# ARCH-031: derive the subagent seam instead of copying it

## Problem

One field family — what a subagent job IS — is declared **three times as independent shapes**:

- `IAgentBackgroundTaskRequest` / `IBackgroundTaskResult` (`agent-interface-transport`, the contract owner);
- `ISubagentSpawnRequest` / `ISubagentJobResult` (`agent-executor`);
- `ISpawnAgentTaskRequest` (`agent-framework/src/background-tasks/execution-workspace-spawner.ts:21-41`).

Roughly six true cross-family projections carry values between them, each a hand-written object literal
over a ~20-key family, **none compiler-checked for totality** — all in
`agent-executor/src/subagents/subagent-manager.ts`: `toBackgroundRequest`, `toSubagentStartRequest`,
`toBackgroundResult`, `toSubagentState`, `wait()`, and the handle literal in
`createSubagentBackgroundRunner`. (Named by symbol, not by line: the first draft cited line numbers that
ARCH-025's own three-line change to `wait()` immediately shifted by nine.)

So a field added to either side must be hand-copied at every hop, and a miss **compiles clean as a silent
no-op**. There is no error, no log, and nothing that tells a caller their field did nothing.

## Why this is foundational — the repeat is measured, three deep

- **TYPE-003** (done 2026-07-25) named this exact cause at
  `agent-interface-transport/src/subagent-contracts.ts:47-50` — _"every field a subagent job shares with
  the background-task SSOT is derived via `Pick` (previously a ~20-field manual mirror that could drift
  silently)"_ — and derived **only the state hop**. That hop is the one hop that has not lost a field since.
- **CORE-025** then repaired a dropped field at two of the remaining mappers and left the evidence in the
  file: `// CORE-025: carry the permission policy through to the runner (previously dropped here → dead
field)`, in `toSubagentStartRequest`.
- **ANALYTICS-001 Phase 2** (`34587800e`) added `usage` to `toBackgroundResult` and missed `wait()`
  **in the same one-line commit**. The field ARCH-025 reports was born dropped by the commit that created it.
- **ARCH-025** is the fourth repair of this class. Its own recommendation gate returned `REJECT` on the
  ground that solving this cause in place is the third option `finding-depth.md` forbids.

## Direction

**Derive the shapes so a drop is unrepresentable**, rather than classifying keys so an unclassified key is a
compile error. Classification is strictly weaker: a key can be classified and still be a silent no-op.
`ISubagentJobState` already proves the treatment works in this very seam.

- Move `ISubagentSpawnRequest` / `ISubagentJobResult` beside `ISubagentJobState` in
  `agent-interface-transport`, and derive them from `IAgentBackgroundTaskRequest` / `IBackgroundTaskResult`
  the way `ISubagentJobState` is derived from `IBackgroundTaskState`. Correct
  `subagent-contracts.ts:1-7`, which currently says spawn requests and results stay in `agent-executor`;
  they are pure data, and the interface-package rule permits the move. `agent-executor` keeps owning the
  SPI (`ISubagentRunner`, `ISubagentManager`).
- Collapse `ISpawnAgentTaskRequest` into the same derivation.
- Extend `agent-interface-transport/src/__tests__/type-ssot-parity.test.ts` — today's only mechanical parity
  check, and state-hop only — to the request and result hops.
- Keep a `satisfies`-checked disposition map **only for the residual non-derivable keys**, and reconcile its
  vocabulary with the already-shipped `TCompositionFieldPolicy`
  (`agent-capability-pack/src/capability-pack-types.ts:47-48`, ARCH-027) rather than inventing a third
  spelling. **Answer deliberately who owns "exhaustive public-key classification" as a concept** —
  `agent-capability-pack` is an odd owner for a domain-free idea, and `agent-executor` cannot depend on it.
- Residual keys and their dispositions: `status: 'paused' → 'sleeping'` (derived narrowing);
  `providerProfile` explicitly-rejected pending ARCH-021; `worktreePath` / `branchName` **runner-produced,
  never caller-supplied** — see the correction below; `parentTaskId` needs a key on both sides and lands here.

## A correction this item exists to prevent being repeated

ARCH-025's rejected recommendation claimed `worktreePath` / `branchName` were caller fields dropped by
`toBackgroundRequest`, and proposed removing
`agent-executor/src/subagents/worktree-subagent-runner.ts:117-122` as a "downstream re-injection workaround".
**That is inverted.** The worktree does not exist at spawn time — `ISubagentWorktreeAdapter.prepare()`
creates it inside `WorktreeSubagentRunner.start()` — and no producer of an `ISubagentSpawnRequest` anywhere
in the repo sets either field. Lines 117-122 are the **only** assignment of them; removing them would sever
the worktree identity from the request the worker sees and kill `subagentExecutionRoot`'s
"the worktree wins when present" branch (`execution-root.ts:20`), which guards a measured containment
breach. The invariant is **runner-produced, not caller-supplied**, and it must be recorded as such rather
than rediscovered by the next reader.

## Test Plan

- Red-first: a field added to a derived source shape fails to compile until every hop carries it.
- `type-ssot-parity.test.ts` extended to the request and result hops.
- `parentTaskId` flows end to end from `execution-workspace-spawner.ts:104` to the runner.
- `pnpm typecheck`, `pnpm build`, `pnpm harness:scan`, `pnpm harness:verify-like-ci`.
- Changesets for every changed public package (all are in one `fixed` group).

## User Execution Test Scenarios

**Applies — two scenarios (S1, S2), both `agent-executable`.** The premise this section replaced was
wrong and is corrected rather than amended: it said "the only behaviour change is `parentTaskId`
beginning to flow" and directed the scenario at the parent-link observable. **`parentTaskId` has no
product-surface observable at all** — the trace is at the end of this section — while the two changes
that DO reach a user are `permissionPolicy` becoming caller-stated (§3) and the worktree identity moving
to the runner envelope with the `request.cwd` override dropped (§2/§9). Both scenarios were written to
those, and both were executed on this machine before this section was committed.

**Credential probe (recorded, not assumed).**
`env | grep -iE 'ANTHROPIC|OPENAI|GEMINI|GOOGLE|BYTEDANCE|API_KEY|ROBOTA|CLAUDE'` returns only
`PATH`/`PWD` and `CLAUDE_CODE_*` harness variables — no provider key; `~/.robota` does not exist. Probed,
not claimed. **Neither scenario needs a credential**: both start a **local mock OpenAI-compatible model
server** inside the driver and point the project's provider profile at its `baseURL`. This was verified
to be a real path, not a hope: `OpenAIProvider` switches to the chat-completions API exactly when a
`baseURL` is set (`agent-provider-openai/src/openai/provider.ts:216`), and the subagent's child process
rebuilds its provider from the parent profile including `baseURL`
(`child-process-subagent-runner.ts:createProviderProfile` → `child-process-subagent-worker.ts:87`). Both
runs below made **exactly 2** model round-trips to `127.0.0.1` and **zero** to the internet.

**Surface preference: level 2 (a fixture the scenario ships), and why not level 1.** Level 1 —
observables the product produces with nothing external — cannot reach this seam: a subagent is only
governed by a permission policy when it actually attempts a tool call, and a tool call only happens when
a model asks for one. `--session-log` (the `ReplayProvider`) is the credential-free level-1 substitute
and it does **not** work here: the CLI always spawns subagents through
`createChildProcessSubagentRunnerFactory` (`agent-cli/src/cli.ts:277`), and a child process rebuilds its
provider from a **serializable profile**, so an in-memory replay provider cannot cross the fork. The
mock model server is the minimum fixture that makes the child's tool call real. Level 3 (live
credentials) is not used and is not needed.

### Why the drivers run the CLI from source (`tsx --conditions=source`) and not `bin/robota.cjs`

Not a convenience. **The built CLI binary cannot spawn a subagent at all today** — a pre-existing defect
unrelated to ARCH-031, found while proving executability, and reproduced rather than inferred:

```
[pid …] argv=…/packages/agent-cli/dist/node/child-process-subagent-worker.js
        UNCAUGHT: Error: Cannot find module '…/packages/agent-cli/dist/node/child-process-subagent-worker.js'
[pid …] EXIT 1
```

`getDefaultSubagentWorkerPath()` (`agent-subagent-runner/src/worker-path-resolver.ts:5`) joins
`child-process-subagent-worker.js` onto its own `import.meta.url` directory. INFRA-028 bundles **all**
`@robota-sdk` workspace code into `agent-cli/dist/node/bin.js`, so that directory becomes agent-cli's
`dist/node/` — and `agent-cli/tsdown.config.ts` declares only the `bin` and `index` entries, so the
worker file is never emitted there. `agent-subagent-runner/tsdown.config.ts:9-14` carries the comment
that names this exact failure (_"Without this entry the file never existed, so the child-process subagent
silently failed from any dist build"_) — the bundling change re-created it one package along. Observed
symptom from the product surface: `/agent run …` reports `Started agent job: agent_1`, then the task
fails with `Subagent worker exited before result: exit code 1`. **This should be filed as its own
backlog item; it is not ARCH-031's to fix,** and it is recorded here so the next reader does not conclude
the source-run is scenario laziness.

### S1 — the subagent's permission policy governs its tool calls, and outranks `bypassPermissions`

**What it proves.** §3 makes `permissionPolicy` required at the spawn boundary and moves the default to
one named constant, so for today's four producers the _value_ is unchanged — S1 is therefore a
**behaviour-preservation scenario over the changed path**, and it passes before the fix as well as after
(baseline recorded below). It is not vacuous, and the reason is specific: the enforcer only applies the
policy gate when the field is **present** (`agent-session/src/permission-enforcer.ts:105`,
`if (this.permissionPolicy)`). If the derivation drops or fails to set `permissionPolicy` at any hop of
the seam — spawn site → `toBackgroundRequest` → `toSubagentStartRequest` → `ISubagentWorkerStartPayload`
→ `createSubagentSession` → `PermissionEnforcer` — the branch is skipped, `evaluatePermission` runs
instead, and under `--permission-mode bypassPermissions` it returns `auto`. **Arm A would then flip from
denied to allowed and write the file.** That is exactly the "compiles clean as a silent no-op" failure
this item exists to eliminate, made visible as a file that does or does not exist. Both arms run under
`bypassPermissions` precisely so that nothing except the policy can produce the difference between them.

- **Executability decision:** `agent-executable`. Non-interactive, no TTY, no provider credentials, no
  network egress, no `better-sqlite3` (`--no-session-persistence` keeps the session store out).
  **Verified by actual execution on this machine before this section was written** (evidence below).
- **Surface:** the real `robota --serve` runtime host — the same authenticated loopback WS the GUI
  (`apps/agent-app`) drives as a sidecar — using the `{ type: 'command', name: 'agent' }` client frame
  and the `command_result` / `background_task_event` / `background_task` server frames
  (`agent-transport-protocol/src/ws-protocol.ts:35,45-46,91,96`). The user-facing command is
  `/agent run general-purpose <prompt>`, which spawns a real child-process subagent.
- **Prerequisite state:**
  - `pnpm install` complete (the driver invokes `node_modules/.bin/tsx`). **No dependency needs to be
    added** — the driver imports only `node:child_process`, `node:fs`, `node:http`, `node:net`,
    `node:os`, `node:path`, `node:url`, and the Node ≥ 22 global `WebSocket`. No CLI build is required.
  - Node ≥ 22 (this machine: v22.14.0). `volta` is not on `PATH`; the plain `node`/`tsx` on `PATH` are
    used.
  - The driver creates everything else itself: a throwaway project dir, a throwaway `HOME` (so no
    `~/.robota` is created or read), a `.robota/settings.json` pointing at its own mock model, and the
    mock model server on a free loopback port. No git repo needed for S1.
- **Exact commands** (run from the repo root):

```bash
mkdir -p scratch/src
cat > scratch/src/arch-031-subagent-permission-policy.mjs <<'A031_S1_EOF'
/**
 * ARCH-031 S1 — the subagent permission policy governs the child's tool calls, end to end.
 *
 * Drives the real `robota --serve` runtime host over its authenticated loopback WS and spawns a
 * REAL child-process subagent with `/agent run`. The model is a local mock OpenAI-compatible
 * server this script starts — no credentials, no network egress.
 *
 * Two arms, identical except for the PARENT allowlist, both under `--permission-mode
 * bypassPermissions` so that the session mode alone would allow everything:
 *   A. permissions.allow = []        -> the subagent's Bash call is DENIED, no file is written
 *   B. permissions.allow = ['Bash']  -> the same call is ALLOWED, the file is written
 * The only thing that can produce that difference is `permissionPolicy: 'inherit-allowlist'`
 * arriving at the child's PermissionEnforcer through the whole spawn seam.
 *
 * Exits 0 when every assertion holds, 1 otherwise.
 */
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives at <repo>/scratch/src/, so the repo root is two levels up.
const TSX = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));
const CLI_SRC = fileURLToPath(new URL('../../packages/agent-cli/src/bin.ts', import.meta.url));

const failures = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      observed: ${got}`);
  if (!ok) failures.push(name);
};

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

async function waitPort(port, budgetMs) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const ok = await new Promise((r) => {
      const sock = connect({ host: '127.0.0.1', port });
      const done = (v) => {
        sock.destroy();
        r(v);
      };
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
      sock.setTimeout(500, () => done(false));
    });
    if (ok) return;
    if (Date.now() >= deadline) throw new Error('robota --serve did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** A local OpenAI-compatible model: round 1 calls Bash, round 2 finishes. */
function startMockModel(port, command) {
  let calls = 0;
  const server = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (String(req.url).includes('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [] }));
        return;
      }
      calls += 1;
      const parsed = (() => {
        try {
          return JSON.parse(body);
        } catch {
          return {};
        }
      })();
      const first = calls === 1;
      const toolCall = {
        id: 'call_1',
        type: 'function',
        function: { name: 'Bash', arguments: JSON.stringify({ command }) },
      };
      if (parsed.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const base = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 1, model: 'mock-model' };
        const delta = first
          ? { role: 'assistant', tool_calls: [{ index: 0, ...toolCall }] }
          : { role: 'assistant', content: 'SUBAGENT_FINISHED' };
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        res.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: first ? 'tool_calls' : 'stop' }] })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const message = first
        ? { role: 'assistant', content: null, tool_calls: [toolCall] }
        : { role: 'assistant', content: 'SUBAGENT_FINISHED' };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: 1,
          model: 'mock-model',
          choices: [{ index: 0, message, finish_reason: first ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, calls: () => calls })));
}

/** Run one arm; resolves { status, toolEvents, markerExists, markerBody, modelCalls }. */
async function runArm(allow) {
  const cwd = mkdtempSync(join(tmpdir(), 'arch031-cwd-'));
  const home = mkdtempSync(join(tmpdir(), 'arch031-home-'));
  const marker = join(cwd, 'BREACH.txt');
  const modelPort = await freePort();
  const mock = await startMockModel(modelPort, `echo BREACHED > ${marker}`);
  mkdirSync(join(cwd, '.robota'), { recursive: true });
  writeFileSync(
    join(cwd, '.robota', 'settings.json'),
    JSON.stringify({
      currentProvider: 'openai',
      providers: {
        openai: { type: 'openai', model: 'mock-model', apiKey: 'mock-key', baseURL: `http://127.0.0.1:${modelPort}/v1` },
      },
      permissions: { allow },
    }),
  );

  const port = await freePort();
  const token = 'arch031-nonce-0123456789abcdef';
  const child = spawn(
    TSX,
    ['--conditions=source', CLI_SRC, '--serve', '--no-session-persistence', '--permission-mode', 'bypassPermissions'],
    {
      cwd,
      env: { PATH: process.env.PATH ?? '', HOME: home, ROBOTA_WS_TOKEN: token, ROBOTA_WS_PORT: String(port) },
      stdio: ['ignore', 'ignore', 'ignore'],
    },
  );

  try {
    await waitPort(port, 90_000);
    const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${encodeURIComponent(token)}`);
    const inbox = [];
    ws.onmessage = (ev) => {
      try {
        inbox.push(JSON.parse(String(ev.data)));
      } catch {
        /* ignore non-JSON */
      }
    };
    await new Promise((r) => {
      ws.onopen = r;
    });
    const send = async (frame, budgetMs, pred) => {
      const before = inbox.length;
      ws.send(JSON.stringify(frame));
      const deadline = Date.now() + budgetMs;
      while (Date.now() < deadline) {
        const hit = inbox.slice(before).find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`no response to ${JSON.stringify(frame)}`);
    };

    const started = await send(
      { type: 'command', name: 'agent', args: 'run general-purpose write the breach marker' },
      60_000,
      (f) => f.type === 'command_result' || f.type === 'protocol_error',
    );
    const taskId = started.data?.agentId;
    let task = null;
    for (let i = 0; i < 150; i += 1) {
      const frame = await send({ type: 'get-background-task', taskId }, 15_000, (f) => f.type === 'background_task');
      task = frame.task;
      if (task && ['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    const toolEvents = inbox
      .filter((f) => f.type === 'background_task_event')
      .map((f) => f.event)
      .filter((e) => String(e.type).startsWith('background_task_tool_'));
    ws.close();
    return {
      status: task?.status,
      output: task?.result?.output,
      error: task?.error?.message,
      toolEvents,
      markerExists: existsSync(marker),
      markerBody: existsSync(marker) ? readFileSync(marker, 'utf8') : '',
      modelCalls: mock.calls(),
    };
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 2000));
    if (child.exitCode === null) child.kill('SIGKILL');
    mock.server.close();
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
}

let exitCode = 1;
try {
  const denied = await runArm([]);
  const allowed = await runArm(['Bash']);
  const endOf = (arm) => arm.toolEvents.find((e) => e.type === 'background_task_tool_end');

  check('A: subagent task completes', denied.status === 'completed', `${denied.status} / ${denied.error ?? 'no error'}`);
  check('A: the subagent really ran two model rounds', denied.modelCalls === 2, String(denied.modelCalls));
  check(
    'A: the Bash call is DENIED under bypassPermissions',
    endOf(denied)?.toolName === 'Bash' && endOf(denied)?.success === false,
    JSON.stringify(denied.toolEvents),
  );
  check('A: no file was written', denied.markerExists === false, `BREACH.txt exists=${denied.markerExists}`);

  check('B: subagent task completes', allowed.status === 'completed', `${allowed.status} / ${allowed.error ?? 'no error'}`);
  check(
    'B: the same Bash call is ALLOWED once the parent allowlist grants it',
    endOf(allowed)?.toolName === 'Bash' && endOf(allowed)?.success === true,
    JSON.stringify(allowed.toolEvents),
  );
  check(
    'B: the file was written',
    allowed.markerExists === true && allowed.markerBody.trim() === 'BREACHED',
    `exists=${allowed.markerExists} body=${JSON.stringify(allowed.markerBody)}`,
  );

  exitCode = failures.length === 0 ? 0 : 1;
  console.log(`\nSCENARIO RESULT: ${exitCode === 0 ? 'PASS' : `FAIL (${failures.join(', ')})`}`);
} catch (err) {
  console.log(`\nSCENARIO RESULT: FAIL (${err instanceof Error ? err.message : String(err)})`);
} finally {
  process.exit(exitCode);
}
A031_S1_EOF

node scratch/src/arch-031-subagent-permission-policy.mjs; echo "EXIT=$?"
```

- **Expected observable result:** exit code `0`, and stdout containing all seven `PASS` lines below,
  then `SCENARIO RESULT: PASS`. The temp-dir path inside arm B's `firstArg` is per-run and is **not**
  part of the expectation; everything else quoted here is.
  - `PASS  A: subagent task completes` — observed `completed / no error`
  - `PASS  A: the subagent really ran two model rounds` — observed `2` (the child genuinely reached the
    mock model twice; a subagent that never started would report `0`)
  - `PASS  A: the Bash call is DENIED under bypassPermissions` — observed exactly
    `[{"type":"background_task_tool_end","toolName":"Bash","success":false,"taskId":"agent_1"}]`, i.e. a
    `tool_end` with `success:false` and **no `background_task_tool_start` at all**, because the policy
    gate refuses before execution begins
  - `PASS  A: no file was written` — observed `BREACH.txt exists=false`
  - `PASS  B: subagent task completes` — observed `completed / no error`
  - `PASS  B: the same Bash call is ALLOWED once the parent allowlist grants it` — observed a
    `background_task_tool_start` for `Bash` followed by `..._tool_end` with `success:true`
  - `PASS  B: the file was written` — observed `exists=true body="BREACHED\n"`
- **Cleanup:** the driver removes both arms' temp project dirs and temp `HOME`s, closes the mock model
  server, and `SIGTERM`s (then `SIGKILL`s) each serve host in a `finally` block, so no process, port or
  file survives a failed run. `~/.robota` is never created or touched — `HOME` is overridden. The only
  residue is `scratch/src/arch-031-subagent-permission-policy.mjs`, which is gitignored
  (`scratch/.gitignore` ignores all of `src/*`) — the sanctioned home for disposable live-verification
  scripts per `backlog-execution.md` § Script home. `rm -f scratch/src/arch-031-subagent-permission-policy.mjs`
  if a clean tree is wanted. **The committed heredoc above, not the file it writes, is the durable
  artifact.**
- **Evidence (2026-08-16, `feat/arch-031-derive-subagent-seam`):** the fenced block above was extracted
  **verbatim** from this file and run. `EXIT=0`, `SCENARIO RESULT: PASS`, all eight assertions green:

  ```
  PASS  A: subagent task completes                          — completed / no error
  PASS  A: the subagent really ran two model rounds         — 2
  PASS  A: the Bash call is DENIED under bypassPermissions  — background_task_tool_end toolName=Bash success=false
  PASS  A: no file was written                              — BREACH.txt exists=false
  PASS  B: subagent task completes                          — completed / no error
  PASS  B: the same Bash call is ALLOWED once the parent allowlist grants it
                                                            — tool_start + tool_end success=true
  PASS  B: the file was written                             — exists=true body="BREACHED\n"
  ```

  The two arms differ only in the parent allowlist, and they genuinely diverge — arm A denies and writes
  nothing while arm B allows and writes the file — so this measures the policy rather than restating that
  the command ran. Both arms made exactly two model round-trips to `127.0.0.1` and none to the internet.
  This is the falsifier for `permissionPolicy` reaching the child: drop the field at any hop of the seam
  and arm A falls through to `evaluatePermission`, which under `bypassPermissions` returns `auto`, so the
  breach file appears.

  Pre-implementation baseline, recorded at authoring time on branch `feat/arch-031-derive-subagent-seam`
  (worktree at `develop`-equivalent, no ARCH-031 code yet): the command block above was extracted
  verbatim and run — `EXIT=0`, all seven `PASS` lines, `SCENARIO RESULT: PASS`. **Matching this baseline
  is the pass condition**, because §3 changes who states the policy, not what it is. A post-fix run that
  differs — in particular arm A reporting `success:true` or `BREACH.txt exists=true` — falsifies §3's
  "the value is unchanged" claim and is a failure, not a new baseline.

### S2 — a worktree-isolated subagent still executes inside its worktree

**What it proves.** §2 moves `worktreePath` off the request onto the runner envelope
(`ISubagentJobStart`), and §9 removes `worktree-subagent-runner.ts:119`'s `cwd: worktree.worktreePath`
override. Those are the only genuinely _runtime_ changes in this item, and they land on the code path
that guards a **measured containment breach** (ARCH-010: the child session and its tools must be told the
same execution root). S2 is the falsifier: if `subagentExecutionRoot` stops resolving to the worktree
because the envelope was not threaded, or if dropping the `cwd` override is not compensated, the child
executes in the **main checkout** and `EXEC_ROOT.txt` appears there instead. It also observes
`branchName` at the surface, which §2 deletes from the request while asserting the UI receives it via
result metadata — so if that claim is wrong, `/agent list` loses `branch=`.

- **Executability decision:** `agent-executable`. Same properties as S1, plus one addition: the driver
  runs `git init` / `git commit` in its own throwaway dir, because worktree isolation needs a git
  repository. `git` is on `PATH` (verified by the recorded run).
- **Surface:** the same `robota --serve` loopback WS, driving `/agent run general-purpose --isolation
worktree …` (the `--isolation` flag is parsed at
  `agent-command/src/agent/agent-command-parser.ts:83-85`), then reading the `background_task` frame and
  the `/agent list` rendering (`agent-command/src/agent/agent-command.ts:64-71`). The final observable is
  a **file on disk**: where the subagent's `pwd` landed.
- **Prerequisite state:** as S1, plus `git` on `PATH`. The driver seeds its own repo (`git init -b main`,
  one commit) and sets `GIT_*` identity env vars so no global git config is required or read.
- **Exact commands** (run from the repo root):

```bash
mkdir -p scratch/src
cat > scratch/src/arch-031-subagent-worktree-root.mjs <<'A031_S2_EOF'
/**
 * ARCH-031 S2 — a worktree-isolated subagent executes INSIDE its worktree, and the worktree
 * identity still reaches the user.
 *
 * Guards the two riskiest runtime moves in ARCH-031: `worktreePath` migrating from the spawn
 * request to the runner envelope (§2), and the removal of `WorktreeSubagentRunner`'s `request.cwd`
 * override (§9). If either lands wrong, `subagentExecutionRoot` no longer resolves to the worktree
 * and the child writes into the MAIN checkout — the containment breach ARCH-010 exists to prevent.
 * It also observes `branchName`, which §2 deletes from the request while asserting the UI gets it
 * from result metadata instead.
 *
 * Local mock OpenAI-compatible model; no credentials, no network egress.
 * Exits 0 when every assertion holds, 1 otherwise.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives at <repo>/scratch/src/, so the repo root is two levels up.
const TSX = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));
const CLI_SRC = fileURLToPath(new URL('../../packages/agent-cli/src/bin.ts', import.meta.url));

const failures = [];
const check = (name, ok, got) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      observed: ${got}`);
  if (!ok) failures.push(name);
};

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });

async function waitPort(port, budgetMs) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const ok = await new Promise((r) => {
      const sock = connect({ host: '127.0.0.1', port });
      const done = (v) => {
        sock.destroy();
        r(v);
      };
      sock.once('connect', () => done(true));
      sock.once('error', () => done(false));
      sock.setTimeout(500, () => done(false));
    });
    if (ok) return;
    if (Date.now() >= deadline) throw new Error('robota --serve did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
}

function startMockModel(port, command) {
  let calls = 0;
  const server = createHttpServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (String(req.url).includes('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [] }));
        return;
      }
      calls += 1;
      const parsed = (() => {
        try {
          return JSON.parse(body);
        } catch {
          return {};
        }
      })();
      const first = calls === 1;
      const toolCall = {
        id: 'call_1',
        type: 'function',
        function: { name: 'Bash', arguments: JSON.stringify({ command }) },
      };
      if (parsed.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const base = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 1, model: 'mock-model' };
        const delta = first
          ? { role: 'assistant', tool_calls: [{ index: 0, ...toolCall }] }
          : { role: 'assistant', content: 'WORKTREE_DONE' };
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
        res.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: first ? 'tool_calls' : 'stop' }] })}\n\n`,
        );
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const message = first
        ? { role: 'assistant', content: null, tool_calls: [toolCall] }
        : { role: 'assistant', content: 'WORKTREE_DONE' };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: 1,
          model: 'mock-model',
          choices: [{ index: 0, message, finish_reason: first ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, calls: () => calls })));
}

const cwd = mkdtempSync(join(tmpdir(), 'arch031-wt-'));
const home = mkdtempSync(join(tmpdir(), 'arch031-home-'));
const gitEnv = {
  ...process.env,
  HOME: home,
  GIT_AUTHOR_NAME: 'arch031',
  GIT_AUTHOR_EMAIL: 'arch031@example.invalid',
  GIT_COMMITTER_NAME: 'arch031',
  GIT_COMMITTER_EMAIL: 'arch031@example.invalid',
};
const git = (...args) => execFileSync('git', args, { cwd, env: gitEnv });
git('init', '-q', '-b', 'main');
writeFileSync(join(cwd, 'README.md'), 'seed\n');
git('add', '-A');
git('commit', '-qm', 'seed');

const modelPort = await freePort();
const mock = await startMockModel(modelPort, 'pwd > EXEC_ROOT.txt');
mkdirSync(join(cwd, '.robota'), { recursive: true });
writeFileSync(
  join(cwd, '.robota', 'settings.json'),
  JSON.stringify({
    currentProvider: 'openai',
    providers: {
      openai: { type: 'openai', model: 'mock-model', apiKey: 'mock-key', baseURL: `http://127.0.0.1:${modelPort}/v1` },
    },
    permissions: { allow: ['Bash'] },
  }),
);

const port = await freePort();
const token = 'arch031-wt-nonce-0123456789';
const child = spawn(
  TSX,
  ['--conditions=source', CLI_SRC, '--serve', '--no-session-persistence', '--permission-mode', 'bypassPermissions'],
  {
    cwd,
    env: { PATH: process.env.PATH ?? '', HOME: home, ROBOTA_WS_TOKEN: token, ROBOTA_WS_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'ignore'],
  },
);

let exitCode = 1;
try {
  await waitPort(port, 90_000);
  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${encodeURIComponent(token)}`);
  const inbox = [];
  ws.onmessage = (ev) => {
    try {
      inbox.push(JSON.parse(String(ev.data)));
    } catch {
      /* ignore non-JSON */
    }
  };
  await new Promise((r) => {
    ws.onopen = r;
  });
  const send = async (frame, budgetMs, pred) => {
    const before = inbox.length;
    ws.send(JSON.stringify(frame));
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      const hit = inbox.slice(before).find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no response to ${JSON.stringify(frame)}`);
  };

  const started = await send(
    { type: 'command', name: 'agent', args: 'run general-purpose --isolation worktree record the execution root' },
    60_000,
    (f) => f.type === 'command_result' || f.type === 'protocol_error',
  );
  const taskId = started.data?.agentId;
  check('the worktree-isolated job starts', started.success === true && typeof taskId === 'string', started.message);

  let task = null;
  for (let i = 0; i < 200; i += 1) {
    const frame = await send({ type: 'get-background-task', taskId }, 15_000, (f) => f.type === 'background_task');
    task = frame.task;
    if (task && ['completed', 'failed', 'cancelled', 'timeout'].includes(task.status)) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  check('the job completes', task?.status === 'completed', `${task?.status} / ${task?.error?.message ?? 'no error'}`);

  const worktree = task?.worktreePath;
  check(
    'the task state carries a worktree path under the project',
    typeof worktree === 'string' && worktree.startsWith(join(cwd, '.robota', 'worktrees')),
    String(worktree),
  );
  check('the task state carries the worktree branch', String(task?.branchName ?? '').startsWith('robota/'), String(task?.branchName));

  const inMain = existsSync(join(cwd, 'EXEC_ROOT.txt'));
  const inWorktree = typeof worktree === 'string' && existsSync(join(worktree, 'EXEC_ROOT.txt'));
  const recordedRoot = inWorktree ? readFileSync(join(worktree, 'EXEC_ROOT.txt'), 'utf8').trim() : '';
  check('the subagent did NOT write into the main checkout', inMain === false, `main EXEC_ROOT.txt exists=${inMain}`);
  check(
    'the subagent executed with the WORKTREE as its execution root',
    inWorktree && recordedRoot === worktree,
    `${recordedRoot || '(no file in worktree)'}`,
  );

  const list = await send({ type: 'command', name: 'agent', args: 'list' }, 20_000, (f) => f.type === 'command_result');
  check(
    '/agent list still renders both worktree= and branch=',
    list.message.includes(`worktree=${worktree}`) && list.message.includes(`branch=${task?.branchName}`),
    list.message.split('\n').find((l) => l.includes(String(taskId))) ?? list.message,
  );

  ws.close();
  exitCode = failures.length === 0 ? 0 : 1;
  console.log(`\nSCENARIO RESULT: ${exitCode === 0 ? 'PASS' : `FAIL (${failures.join(', ')})`}`);
} catch (err) {
  console.log(`\nSCENARIO RESULT: FAIL (${err instanceof Error ? err.message : String(err)})`);
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 2000));
  if (child.exitCode === null) child.kill('SIGKILL');
  mock.server.close();
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  process.exit(exitCode);
}
A031_S2_EOF

node scratch/src/arch-031-subagent-worktree-root.mjs; echo "EXIT=$?"
```

- **Expected observable result:** exit code `0`, all seven `PASS` lines below, then
  `SCENARIO RESULT: PASS`. The temp-dir prefix and the 8-hex worktree suffix are per-run and are **not**
  part of the expectation; the structural claims are.
  - `PASS  the worktree-isolated job starts` — observed `Started agent job: agent_1`
  - `PASS  the job completes` — observed `completed / no error`
  - `PASS  the task state carries a worktree path under the project` — observed a path of the form
    `<tmp-project>/.robota/worktrees/agent_1-<hex>`
  - `PASS  the task state carries the worktree branch` — observed `robota/agent_1-<hex>`
  - `PASS  the subagent did NOT write into the main checkout` — observed
    `main EXEC_ROOT.txt exists=false` (**this is the containment assertion**; it flips to `true` if the
    execution root regresses to the parent's cwd)
  - `PASS  the subagent executed with the WORKTREE as its execution root` — observed the child's own
    `pwd`, **string-equal to the `worktreePath` the task state reports**
  - `PASS  /agent list still renders both worktree= and branch=` — observed
    `agent_1 [completed worktree=<path> branch=robota/agent_1-<hex>] general-purpose - record the execution root`
- **Cleanup:** identical shape to S1 — `finally` block SIGTERM→SIGKILL, mock server closed, temp project
  dir (including the git repo and every worktree git created inside `.robota/worktrees/`) and temp `HOME`
  removed. Because the repo, its worktrees and its git config all live under the throwaway dir, nothing
  is registered in the user's real git state. Residue:
  `scratch/src/arch-031-subagent-worktree-root.mjs`, gitignored, regenerated verbatim by the heredoc.
- **Evidence (2026-08-16, `feat/arch-031-derive-subagent-seam`):** the fenced block above was extracted
  **verbatim** from this file and run. `EXIT=0`, `SCENARIO RESULT: PASS`, all assertions green:

  ```
  PASS  the job completes                                   — completed / no error
  PASS  the task state carries a worktree path              — /tmp/arch031-wt-…/.robota/worktrees/agent_1-7bc8494f
  PASS  the task state carries the worktree branch          — robota/agent_1-7bc8494f
  PASS  the subagent did NOT write into the main checkout   — main EXEC_ROOT.txt exists=false
  PASS  the subagent executed with the WORKTREE as its root — /tmp/arch031-wt-…/.robota/worktrees/agent_1-7bc8494f
  PASS  /agent list still renders both worktree= and branch=
  ```

  This is the one that matters most: it proves the containment ARCH-010 exists to guarantee still holds
  after the worktree identity moved off the request and onto the runner envelope. The subagent wrote its
  marker inside the worktree and **not** into the main checkout, and the branch — relocated rather than
  deleted — still reaches the surface.

  Pre-implementation baseline, recorded at authoring time on branch `feat/arch-031-derive-subagent-seam`:
  the command block above was extracted verbatim and run — `EXIT=0`, all seven `PASS` lines,
  `SCENARIO RESULT: PASS`. As with S1 this is a behaviour-preservation scenario over the changed path:
  matching the baseline is the pass condition, and any post-fix divergence — above all
  `main EXEC_ROOT.txt exists=true` — is a failure, not a new baseline.

### `parentTaskId` — no product-surface observable; absence recorded with its trace, not as an N/A

Deliberately **not** given a scenario. This is a recorded finding under the Capability Reachability rule
(`backlog-execution.md`), not an exemption, and it corrects this section's own former premise. The trace
was derived from the source at authoring time:

| Hop                                            | State today                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Reachable observable                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Producers**                                  | `parentTaskId` is written at exactly **three** non-test sites repo-wide — `execution-workspace-spawner.ts:104` and `:134` (both copying `request.parentTaskId`) and `background-task-manager-helpers.ts:186` (copying it onto the task state). **Zero sites originate a value.** `rg -n "parentTaskId" packages apps` finds no other occurrence, including tests.                                                                                                                    | **None** — nothing to observe, because nothing sets it.                                                                                                                                                                                                                         |
| **The one caller-settable door**               | `ISpawnAgentTaskRequest.parentTaskId` / `ISpawnProcessTaskRequest.parentTaskId`, reachable only through `createExecutionWorkspaceTaskSpawner`. That port is exported from `agent-framework`'s barrel and exposed on the host context (`interactive-session-base.ts:283`), and has **zero in-repo consumers** — the only `rg` hits are its own declaration, its builder, the two barrels and the SPEC tables. It is on neither the WS protocol nor `session-capability-contracts.ts`. | **None** — no command, transport frame or app calls it.                                                                                                                                                                                                                         |
| **The subagent path this item actually fixes** | `SubagentManager.toBackgroundRequest` has no `parentTaskId` key, and `ISubagentSpawnRequest` has no such field for a producer to set — which is why the derivation "gains" it (recommendation §Request). The four spawn producers (`orchestration/shared.ts`, `tools/agent-tool.ts`, `tools/agent-tool-batch.ts`, `interactive/interactive-session-agent-jobs.ts`) do not set it and this item does not add a source.                                                                | **None.**                                                                                                                                                                                                                                                                       |
| **The sink, which does exist**                 | `execution-workspace-projection.ts:77-78` maps `state.parentTaskId` to an entry's `parentId`, surfaced by the `get-execution-workspace` / `execution_workspace_event` frames.                                                                                                                                                                                                                                                                                                        | **Live but always unreached.** Verified by running it: after `/agent run`, the snapshot entry `task:agent_1` carries `parentId: "main:session_…"` — the `createMainThreadExecutionEntryId(state.parentSessionId)` fallback branch, because `state.parentTaskId` is `undefined`. |

So the sink is wired and the source does not exist. Writing a scenario would require fabricating a
producer, which is the HARNESS-052 failure ARCH-025 committed with its deleted `/cost` scenario.

**Missing surface wiring, named rather than waived.** For a subagent's parent link to become
user-observable, one of these must also land — none is in ARCH-031's scope as approved:

1. a spawn site that knows its own task id and sets `parentTaskId` on the child request (the natural
   home is a subagent spawning a nested subagent, which needs an ambient current-task id the interactive
   session does not carry today);
2. a consumer for `IExecutionWorkspaceTaskSpawner` — a command, skill or transport frame that lets a
   caller state `parentTaskId` at all;
3. failing both, an explicit statement that `parentTaskId` is a forward-provisioned contract field.

Until then, ARCH-031's `parentTaskId` work is a **forward-provisioned contract surface**, held to the
same quality bar by `project-structure.md` (_"'nobody uses it yet' never downgrades a defect on such a
surface"_). Its verification is the extended `type-ssot-parity.test.ts` in `## Test Plan` — engineering
evidence, which `backlog-execution.md` says is never user-execution evidence and is **not** cited as such
here.

### Not scenarios, recorded so they are not mistaken for one

`pnpm typecheck` is this item's primary proof (derivation failures are compile errors), and the IPC-guard
runtime test in the recommendation's verification plan is its second. Both are **engineering
verification** and neither appears above. The `type-ssot-parity.test.ts` extension likewise. If a future
reader finds S1 and S2 inconvenient and reaches for those instead, that is the substitution
`backlog-execution.md` forbids.

## Plan

- [x] Owner decision on scope — **approved 2026-08-16.** This item spans four packages by construction, and
      that span is the reason it is filed rather than folded into ARCH-025; the owner authorized it
      explicitly when deciding to land ARCH-025's narrowed scope first.
- [ ] Move and derive the two data contracts; correct the `subagent-contracts.ts` placement note.
- [ ] Collapse `ISpawnAgentTaskRequest` into the derivation.
- [ ] Extend the parity fixture to the request and result hops.
- [ ] Settle the classification-vocabulary ownership question and apply it to the residual keys.

## Blockers

- **None.** The four-package span was authorized by the owner on 2026-08-16, together with the decision to
  land ARCH-025's narrowed scope first. `finding-depth.md` routes a FOUNDATIONAL cause to a filed root item
  and an owner decision; this file is that root item and the decision is recorded here, in
  `.agents/tasks/AGREEMENT-002-…` (TC-13), and in ARCH-025's `## Result` section.

  _Recorded because it is the point:_ this file sat for several commits saying it needed an authorization it
  already had, while three later-written records said the opposite. That is the exact failure mode
  [`../memory/claims-not-rederived-after-facts-moved.md`](../memory/claims-not-rederived-after-facts-moved.md)
  names — a claim true when written and not re-derived once the fact under it moved — committed in the same
  change that added the memory entry, and caught by review rather than by me.

## Result

Pending.
