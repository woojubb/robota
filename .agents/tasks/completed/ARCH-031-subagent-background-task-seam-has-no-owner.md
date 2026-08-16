---
title: 'ARCH-031: the subagent↔background-task request/result seam has no owner — one field family is declared three times and carried by hand-written literals, so every new field is dropped at the hops nobody remembered'
status: done
created: 2026-08-16
completed: 2026-08-16
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
- `parentTaskId` flows end to end from `execution-workspace-spawner.ts:105` to the runner.
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
  **verbatim** from this file and run. `EXIT=0`, `SCENARIO RESULT: PASS`, all seven assertions green:

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
  PASS  the worktree-isolated job starts                    — Started agent job: agent_1
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
| **Producers**                                  | `parentTaskId` is written at exactly **three** non-test sites repo-wide — `execution-workspace-spawner.ts:105` and `:135` (both copying `request.parentTaskId`) and `background-task-manager-helpers.ts:186` (copying it onto the task state). **Zero sites originate a value.** `rg -n "parentTaskId" packages apps` finds no other occurrence, including tests.                                                                                                                    | **None** — nothing to observe, because nothing sets it.                                                                                                                                                                                                                         |
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

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-16

**Status upgrade:** `todo` → `todo` (Stage 1 authorizes the Stage 2 run; it is not a status transition —
the item's status is the orchestrator's to move, not this gate's)

**Ordering:** exempt — `DONE-GATE-STAGE-1` has no prior gate (gate catalogue > Prior-gate map). Input state
checked anyway: `## User Execution Test Scenarios` present, item at `.agents/tasks/` root with
`status: todo`, which is the state this gate expects. The section was committed at `d8261778b` (13:27),
**before** all three implementation commits (`a21837604` 13:52, `d9d6c16ec` 14:06, `a3186b732` 14:10), so
the "section before implementation starts" ordering in `backlog-execution.md` holds.

- **Every scenario has exact commands, prerequisites, expected observable, evidence field** — met for both.
  S1: heredoc + `node scratch/src/arch-031-subagent-permission-policy.mjs; echo "EXIT=$?"`; prerequisites
  name `pnpm install`, Node ≥ 22 (machine `v22.14.0` confirmed), and that the driver builds its own temp
  project/`HOME`/mock server; expected observable is exit `0` plus seven quoted `PASS` lines that
  explicitly fence the per-run temp path out of the expectation; cleanup and evidence fields present.
  S2 identical in shape, plus `git init` seeding. Prerequisites verified to exist:
  `node_modules/.bin/tsx`, `packages/agent-cli/src/bin.ts`, `scratch/.gitignore` ignoring `src/*`.
- **Executability decision per scenario** — met. Both `agent-executable`, each substantiated
  (non-interactive, no TTY, `--no-session-persistence` keeps `better-sqlite3` out). No `manual-only`
  claimed, so the specific-technical-reason sub-clause does not apply.
- **Scenario drives a product surface** — met for both, and no engineering check is smuggled in. S1/S2
  drive the real `robota --serve` loopback WS with `/agent run …` and `/agent list`; observables are
  product-produced (`background_task_event` tool frames, `/agent list` rendering) and files on disk
  (`BREACH.txt`, `EXEC_ROOT.txt`). Cited surface anchors verified present: `--isolation` parsing at
  `agent-command-parser.ts:83-85`, `worktree=`/`branch=` rendering in `formatAgentJobLine`
  (`agent-command.ts:64-71`), and the `command` / `get-background-task` / `background_task` /
  `background_task_event` frames in `ws-protocol.ts`. Running the entrypoint via
  `tsx --conditions=source packages/agent-cli/src/bin.ts` is the "repository-local command that invokes the
  same CLI entrypoint" the rule sanctions, and the deviation is justified by a reproduced defect that is
  filed separately (`.agents/tasks/DIST-006-built-binary-cannot-spawn-a-subagent.md` exists). The
  "Not scenarios" subsection correctly quarantines `pnpm typecheck`, the IPC-guard test and
  `type-ssot-parity.test.ts` instead of citing them.
- **Live-credential / external-service prerequisite stated explicitly** — met, and stronger than stated:
  neither scenario needs one. The probe is recorded, not asserted, and was **reproduced by this gate** —
  `env | grep -iE 'ANTHROPIC|OPENAI|GEMINI|GOOGLE|BYTEDANCE|API_KEY|ROBOTA|CLAUDE'` returns only
  `PATH`, `PWD`, `AI_AGENT` and `CLAUDE_CODE_*`, no provider key; `ls ~/.robota` →
  `No such file or directory`. The credential-free path is real, not hoped: `resolveApiSurface` in
  `agent-provider-openai/src/openai/provider.ts` returns `'chat-completions'` exactly when `baseURL` is
  set, which is what the in-driver mock model relies on.
- **S1 falsifiability (scrutinized, and it is real)** — the claim that the two arms diverge only by the
  parent allowlist, and that dropping `permissionPolicy` at any hop flips arm A to allowed, was verified
  against source rather than taken on trust. `permission-enforcer.ts:105` is literally
  `if (this.permissionPolicy) {`. Present → `resolvePermissionByPolicy(..., { parentAllow:
this.config.permissions.allow })`, whose `inherit-allowlist` branch ends
  `matchesAnyPattern(toolName, toolArgs, allow) ? 'allow' : 'deny'` — so arm A (`allow: []`) denies and
  arm B (`allow: ['Bash']`) allows, with nothing else differing. Absent → control falls to
  `evaluatePermission(..., 'bypassPermissions', { allow: [], deny: [] })`, which matches no list and
  returns `MODE_POLICY.bypassPermissions.Bash === 'auto'` → the call is allowed and `BREACH.txt` appears.
  Every hop carries the field through a conditional spread
  (`child-process-subagent-worker.ts:111`, `in-process-subagent-runner.ts:151`,
  `create-subagent-session.ts:219`), so a dropped field silently becomes `undefined` rather than erroring —
  the exact silent-no-op mode this item targets. `DEFAULT_BACKGROUND_PERMISSION_POLICY` is
  `'inherit-allowlist'` (`agent-core/src/permissions/types.ts`), confirming the value the four producers
  state. The scenario is a falsifier, not a restatement that the command ran.
- **`parentTaskId` absence (scrutinized: trace-backed finding, not an N/A dodge)** — the per-hop table was
  re-derived independently. `rg -n "parentTaskId" packages apps` reproduces the claimed shape exactly:
  three non-test writers, all copying (`execution-workspace-spawner.ts`, `background-task-manager-helpers.ts:186`),
  **zero originating a value**; the sink at `execution-workspace-projection.ts:77-78` exists with precisely
  the described `createMainThreadExecutionEntryId(state.parentSessionId)` fallback; and
  `IExecutionWorkspaceTaskSpawner` has no invoking consumer (`spawnAgent`/`spawnProcess` have no non-test
  call site). The cited `:104`/`:134` are exact at the authoring commit `d8261778b` and shifted to
  `:105`/`:135` only in the later implementation commit — evidence the trace was read off the source, not
  reconstructed. It records what is missing and names the three wirings that would create an observable,
  rather than asserting inapplicability; and it explicitly refuses to cite `type-ssot-parity.test.ts` as
  user-execution evidence. This is the opposite of the N/A dodge the Capability Reachability rule bans.
- **No post-hoc expectation rewriting** — checked, since it would void the gate.
  `git diff d8261778b 7f349510f` on this file is `+36/-2`: it replaces only the two
  `**Evidence:** _(to be filled…)_` placeholders. No command, prerequisite or expected-result line was
  edited after the run.

**Scenarios covered:** S1 (permission policy governs subagent tool calls, outranks `bypassPermissions`) —
all fields complete. S2 (worktree-isolated subagent executes inside its worktree) — all fields complete.
`parentTaskId` — no scenario, absence recorded with its trace under the Capability Reachability rule, which
is a valid recorded finding, not an unstated omission.

### [DONE-GATE-STAGE-2] — 🔴 NON-COMPLIANCE | 2026-08-16

**Status remains:** `todo` (unchanged by this gate — a status change follows a verdict, it is not part of one)

**Violation — the ordering check's input-state condition fails.** `gate-catalogue.md` > Prior-gate map
states this gate's expected input as "scenarios written, **implementation complete**". Scenarios are
written; the implementation is not, and the item's own record says so: `## Plan` carries four unchecked
boxes and `## Result` reads "Pending." That is not stale bookkeeping — two of them are verifiably unlanded
in code at `8abea89ed`:

- _"Collapse `ISpawnAgentTaskRequest` into the derivation"_ — not done.
  `packages/agent-framework/src/background-tasks/execution-workspace-spawner.ts:21-41` still declares all
  eighteen fields by hand; `git diff baa6863e9 HEAD` on that file is five lines that only make
  `permissionPolicy` required. This is the third of the three independent declarations `## Problem` names,
  so the defect this item exists to remove is still present at one hop.
- _"Settle the classification-vocabulary ownership question and apply it to the residual keys"_ — not done.
  No `satisfies`-checked residual-key disposition map exists in any of the four `area:` packages
  (`rg "satisfies" packages/agent-interface-transport/src packages/agent-executor/src/subagents` → one
  unrelated hit in `session-capability-contracts.ts:207`); `TCompositionFieldPolicy` is untouched.

No follow-up item or descope note exists for either (`rg -ln "ARCH-031" .agents/tasks .agents/spec-docs`).
Stage 2 was therefore dispatched before the implementation phase closed, so its evidence — however clean —
was gathered against an intermediate state, which `backlog-execution.md` > Done Gate Stage 2 ("executed …
against the completed implementation") does not permit. **Prior gate is sound and is not the problem:**
`[DONE-GATE-STAGE-1] ✅ PASS | 2026-08-16` is recorded above with per-criterion evidence, and this gate
re-verified rather than trusted it.

**What was re-executed anyway, and what it showed** (recorded because it is durable and will not need
redoing at the re-run, and because a claim I could check and did not is not evidence):

- **S1** — the fenced block at lines 179-435 was extracted programmatically and **verbatim** (9,913 chars)
  and run from the repo root on `feat/arch-031-derive-subagent-seam` @ `8abea89ed`. Reproduced: `EXIT=0`,
  `SCENARIO RESULT: PASS`, all seven `PASS` lines. The claimed divergence is real, not asserted — arm A
  (`allow: []`): `[{"type":"background_task_tool_end","toolName":"Bash","success":false,"taskId":"agent_1"}]`
  with no `tool_start` and `BREACH.txt exists=false`; arm B (`allow: ['Bash']`): `tool_start` +
  `tool_end success=true` and `exists=true body="BREACHED\n"`. Both arms reported `modelCalls === 2`, so
  the child really ran. The recorded evidence block matches, with one inaccuracy: it says "all **eight**
  assertions green" over a seven-assertion driver.
- **S2** — block at lines 512-762 extracted verbatim (9,645 chars) and run. Reproduced: `EXIT=0`,
  `SCENARIO RESULT: PASS`, all seven `PASS` lines. Containment holds: `main EXEC_ROOT.txt exists=false`,
  and the child's own `pwd` is string-equal to the reported worktree
  (`/tmp/arch031-wt-2kHLj5/.robota/worktrees/agent_1-557a922f`); `/agent list` rendered
  `worktree=… branch=robota/agent_1-557a922f`. The recorded evidence block lists only **six** of the seven
  `PASS` lines — `the worktree-isolated job starts` is missing — and paraphrases the remaining assertion
  names rather than quoting them.
- **No post-hoc expectation rewriting.** `git diff d8261778b 7f349510f` on this file is `+36/-2` and
  touches only the two `**Evidence:** _(to be filled…)_` placeholders; `git diff 7f349510f 8abea89ed`
  changes only two line citations (`:104/:134` → `:105/:135`) and adds the Stage-1 entry. No command,
  prerequisite or "Expected observable result" line was edited after either run. Not the deciding finding,
  but it clears the charge.
- **Durable-artifact rule — met, on the same tested grounds ARCH-025's Stage 2 accepted.** Both drivers
  live in gitignored `scratch/src/` (`scratch/.gitignore:2 src/*`), which is where
  `backlog-execution.md` § Script home _requires_ disposable live-verification scripts to live, so
  committing them was not an available option. The committed heredocs regenerate them **byte-identically**
  (9,737 / 9,480 bytes, diffed against the on-disk files after my run; `cat >` truncates, so my runs
  executed the committed text by construction). `node scripts/harness/check-done-evidence.mjs` passes and
  does not scope `scratch/…` paths.
- **Engineering-verification-as-evidence** and **unprobed capability-absence** — neither triggered. The
  observables are `background_task_event` frames, `/agent list` output and files on disk; the "Not
  scenarios" subsection explicitly quarantines `pnpm typecheck` and `type-ssot-parity.test.ts`. No
  credential exception is claimed — both scenarios are credential-free by construction (in-driver mock
  model on `127.0.0.1`), so no probe is load-bearing here.

**Required action:** land the two remaining `## Plan` items (or record an explicit, owner-visible descope
with a named follow-up item), tick the Plan boxes and fill `## Result`, then re-run both scenarios against
that final state and re-run this gate. Correct the two record inaccuracies at the same time: S1's "eight
assertions" and S2's missing seventh `PASS` line. The two runs above are reproducible evidence, not a
substitute for the re-run.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** `todo` → `todo` (this gate authorizes completion; moving the status is the
orchestrator's act, not this gate's)

**Ordering — passes, re-derived rather than accepted.** Prior gate `[DONE-GATE-STAGE-1] ✅ PASS |
2026-08-16` is recorded above with per-criterion evidence. The input state `gate-catalogue.md` >
Prior-gate map requires — "scenarios written, **implementation complete**" — now holds, and the two items
the previous 🔴 NON-COMPLIANCE named as verifiably unlanded were re-checked **in code** at `f79d59e92`,
not read off the ticked box:

- `ISpawnAgentTaskRequest` is genuinely derived. `execution-workspace-spawner.ts:38-44` is now
  `Readonly<Omit<IAgentBackgroundTaskRequest,'kind'|'parentSessionId'|'metadata'|'mode'|'depth'|'cwd'> &
Partial<Pick<…,'mode'|'depth'|'cwd'>>>`, where `8abea89ed` declared twenty-one fields by hand — the third
  of the three independent declarations `## Problem` names is gone. The TYPE-only split holds on its
  stated ground (`createAgentRequest` injects `kind`/`parentSessionId`/`metadata`, which a caller must not
  be able to forge) and required keys stay total, because the mapper's annotated return type makes a
  missed required key a compile error. One consequence is recorded below rather than waived.
- The classification-vocabulary question is answered, not deferred, and every row of the five-row residual
  table was checked where it claims to be enforced: `permissionPolicy` required at
  `background-task-contracts.ts:93`; `providerProfile` optional at `:94` and carried by the derivation;
  `exitCode`/`signalCode` named in the `Omit` with its reason at `subagent-contracts.ts:99-110`;
  `worktreePath`/`branchName` relocated onto the runner envelope at `subagents/types.ts:35-52`.
- `## Plan` is 5/5 `[x]` and `## Result` is written. `pnpm typecheck` clean for agent-interface-transport
  / agent-executor / agent-framework, and the parity fixture is inside the typechecked program
  (`tsgo --listFiles` includes `type-ssot-parity.test.ts`; 5/5 green). Engineering verification, cited
  **only** for this input-state condition and never as user-execution evidence.

**Criterion 1 — every scenario directly executed against the completed implementation: MET, by this
guard, at the final state.** Both fenced blocks were extracted programmatically and byte-verbatim from
this file at `f79d59e92` (S1 lines 179-435, 9,914 chars; S2 lines 512-762, 9,646 chars) and run from the
repo root on `feat/arch-031-derive-subagent-seam` with a clean tree. Recorded because it is the delta from
the last run: the S1/S2 evidence blocks above are still the runs made at `7f349510f`, i.e. before the
final implementation commit — the final-state execution is this one.

**Criterion 2 — the observed result matched the expected observable, for every scenario: MET.** 14/14
assertions, both `EXIT=0`, both `SCENARIO RESULT: PASS`.

- S1 — the divergence is real, not asserted. Arm A (`permissions.allow: []`) observed
  `[{"type":"background_task_tool_end","toolName":"Bash","success":false,"taskId":"agent_1"}]` with no
  `tool_start`, and `BREACH.txt exists=false`. Arm B (`allow: ['Bash']`) observed `tool_start`
  (`firstArg: echo BREACHED > /tmp/arch031-cwd-utWsD1/BREACH.txt`) then `tool_end success=true`, and
  `exists=true body="BREACHED\n"`. Both arms `completed / no error` with `modelCalls === 2`, so the child
  really reached the mock model. This is the falsifier the item needs: drop `permissionPolicy` at any hop
  and arm A falls through to `evaluatePermission`, which under `bypassPermissions` writes the file.
- S2 — containment holds after the worktree identity moved onto the envelope. `main EXEC_ROOT.txt
exists=false`, and the child's own `pwd` (`/tmp/arch031-wt-56QzX9/.robota/worktrees/agent_1-318f9605`) is
  string-equal to the `worktreePath` the task state reports; branch `robota/agent_1-318f9605`;
  `/agent list` rendered `agent_1 [completed
worktree=/tmp/arch031-wt-56QzX9/.robota/worktrees/agent_1-318f9605 branch=robota/agent_1-318f9605]
general-purpose - record the execution root`.

**Criterion 3 — concrete evidence recorded under each scenario's evidence field: MET, with one
uncorrected inaccuracy.** Both fields carry the exact command, the observed `PASS` lines with their
values, and the exit code, and every line of both reproduces at `f79d59e92`. S2's missing seventh line was
fixed at `f79d59e92`; **S1's miscount was not** — line 461 still reads "all **eight** assertions green"
over a seven-assertion driver, although that commit's message states it was corrected. The count is
wrong; the seven quoted lines and their observed values are not, and the driver's own output is the
authority — so the criterion is met on substance and the miscount is recorded rather than let pass
silently.

**Engineering verification cited as user-execution evidence** — not triggered. The observables are
`background_task_event` frames, `/agent list` output, and files on disk; the "Not scenarios" subsection
quarantines `pnpm typecheck`, the IPC-guard test and `type-ssot-parity.test.ts` instead of citing them.

**Unprobed capability-absence claim** — not triggered, and no exception is claimed. The recorded probe was
reproduced anyway: `env | grep -iE 'ANTHROPIC|OPENAI|GEMINI|GOOGLE|BYTEDANCE|API_KEY'` matches only
`PATH`, and `ls ~/.robota` → `No such file or directory`. Nothing rides on it — both drivers point the
provider at their own `127.0.0.1` mock, so both runs are credential-free by construction.

**Durable-artifact rule — met.** The committed heredocs are the durable artifact and regenerate the
drivers byte-identically (`cat >` truncates, so this run executed the committed text by construction);
`scratch/src/*` is where `backlog-execution.md` § Script home requires disposable live-verification
scripts to live. `node scripts/harness/check-done-evidence.mjs` →
`done-evidence scan passed (14 superseded reference(s))`.

**Recorded, not part of this verdict — a live instance of this item's own defect class, created by the
fix.** The derivation widened the public `IExecutionWorkspaceTaskSpawner.spawnAgent` port with
`providerProfile?` (inherited through the `Omit`; the hand-written version at `8abea89ed` had no such
key), and `createAgentRequest` (`execution-workspace-spawner.ts:102-126`) is the one projection that
stayed a hand-written literal and does not copy it. A caller that sets `providerProfile` there gets a
silent no-op — "compiles clean as a silent no-op", the exact mode `## Problem` names. It is not a
`DONE-GATE-STAGE-2` criterion and does not change this verdict; it wants a follow-up item, or a
spread-with-overrides mapper at that hop.

**Scenarios covered:** S1 (the subagent's permission policy governs its tool calls and outranks
`bypassPermissions`) — executed by this guard, 7/7. S2 (a worktree-isolated subagent still executes inside
its worktree) — executed by this guard, 7/7. `parentTaskId` — no scenario, and correctly so: a
trace-backed absence finding under the Capability Reachability rule, not an exception this gate must
accept.

## Plan

- [x] Owner decision on scope — **approved 2026-08-16.** This item spans four packages by construction, and
      that span is the reason it is filed rather than folded into ARCH-025; the owner authorized it
      explicitly when deciding to land ARCH-025's narrowed scope first.
- [x] Move and derive the two data contracts; correct the `subagent-contracts.ts` placement note —
      `ISubagentSpawnRequest = Omit<IAgentBackgroundTaskRequest,'kind'>` and
      `ISubagentJobResult = Omit<IBackgroundTaskResult,'kind'|'exitCode'|'signalCode'>` in
      `agent-interface-transport/src/subagent-contracts.ts`, with the placement note corrected.
- [x] Collapse `ISpawnAgentTaskRequest` into the derivation — the TYPE only. `createAgentRequest` stays,
      because it owns four defaults and injects three spawner-owned fields (`parentSessionId`,
      `metadata`, `kind`); collapsing the mapper would let a caller forge the parent session and the
      execution origin.
- [x] Extend the parity fixture to the request and result hops — two `expectTypeOf` cases in
      `type-ssot-parity.test.ts`, typechecked by `tsgo --noEmit`. They are tautologies while the types
      are defined as `Omit<…>`, which is what makes them worth writing: they fail the moment either type
      is re-declared by hand, the only way the drift returns.
- [x] Settle the classification-vocabulary ownership question and apply it to the residual keys —
      **answered: an exhaustive classification map is not needed here**, and not because the residual set
      is small. It is because the set is finite, enumerated, and every entry has a compiler-visible home,
      so a map would restate in data what the type system already refuses:

      | Residual key | Disposition | Where it is enforced |
                              | --- | --- | --- |
                              | `permissionPolicy` | required at the boundary; the default is one named constant owned by `agent-core` | compile error at each producer until stated |
                              | `providerProfile` | **carried by derivation; not honored by any runner today — ARCH-021 is the item that honors it.** Not "rejected" and not "dead": for a library, no in-repo consumer is not evidence a contract is dead | `createProviderProfile`, which builds the profile the worker actually reads |
                              | `exitCode` / `signalCode` | excluded — process-only, sole producer is the shell runner | named in the `Omit` and its comment |
                              | `worktreePath` | moved to the runner envelope — runner-produced, so the request was the wrong owner | compile error if read off the request |
                              | `branchName` | **relocated to the envelope, not deleted.** It has no reader in this repository; that is not a reason to drop a legitimate contract | declared on both envelopes and crosses the IPC boundary |

                              `TCompositionFieldPolicy` (ARCH-027, `agent-capability-pack`) is therefore left alone rather than
                              borrowed or re-spelled. The open question of who should own "exhaustive public-key classification"
                              as a domain-free concept is not answered here because nothing in this item now needs it.

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

**Delivered.** One field family that was declared three times and carried by six hand-written literals is
now derived from its transport SSOT. `ISubagentSpawnRequest` is `Omit<IAgentBackgroundTaskRequest,'kind'>`,
`ISubagentJobResult` is `Omit<IBackgroundTaskResult,'kind'|'exitCode'|'signalCode'>`, both owned by
`agent-interface-transport`; `ISpawnAgentTaskRequest` derives from the same source. All four projections
collapse to spreads, so `parentTaskId` and `providerProfile` reach the runner because they exist on the
source rather than because someone remembered them, and `wait()` subsumes ARCH-025's repair exactly as that
item predicted.

**What the derivation forced into the open**, which is the argument for it: the compiler named every
divergence rather than leaving it to be found. `permissionPolicy` was required on the SSOT and optional at
the seam, with its default applied mid-projection in **two** packages independently — a security-relevant
value whose default was declared twice. It is now required at the boundary with one named constant owned by
`agent-core`, and every spawn site states its own policy.

**Two corrections the owner and the reviewers made to this item, recorded because a reader would otherwise
inherit them:**

- An earlier draft read `worktreePath`/`branchName` as caller fields and proposed deleting their only
  producer, which would have severed the containment branch `subagentExecutionRoot` guards. They are
  runner-produced; they moved to the runner envelope.
- `branchName` was then deleted as a "zero readers" dead field. **That was a grep-based cleanup of a
  legitimate contract.** For a library, no in-repo consumer is not evidence a contract is dead — the owner
  corrected this, and it is now relocated to the envelope and crosses the IPC boundary. The same correction
  applies to `providerProfile`, which is carried and honored by ARCH-021, not "rejected".

**Verification.** Six packages typecheck clean; 2826 tests green; both user-execution scenarios pass, and
Stage 2's guard re-executed both itself — S1's two arms diverge on the parent allowlist alone (denied and
no file, versus allowed and the file written), and S2 shows the subagent executing inside its worktree and
**not** writing into the main checkout, which is the containment ARCH-010 exists to guarantee.

**Found along the way and filed rather than folded in:** `DIST-006` (#1758 — the built binary cannot spawn a
subagent at all), `HARNESS-093` (the spec public-surface scan cannot read a SPEC that groups its table by
subheading), #1764 (three pass-through re-exports, an unnameable public parameter type, an allowlist entry
its own criterion disqualifies), and #1763 (the skill work the owner directed).
