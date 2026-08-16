---
title: 'ARCH-025: agent-executor projections silently drop declared contract fields — SubagentManager.wait() strips usage (ANALYTICS-001), the task→runner bridge drops providerProfile, and IScheduleEditPatch is unexported and re-declared inline'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-executor, packages/agent-framework
depends_on: [ARCH-024, ARCH-027]
---

# ARCH-025: executor facade projections lose contract fields

## Problem

Three declared fields on agent-executor's public contracts are silently dropped or unreachable by the
projections that should carry them, so a caller who sets them gets a no-op with no error.

## Evidence (adversarially verified 2026-08-13, PARTIAL — core confirmed, one consumer citation corrected)

- **usage stripped by wait():** `packages/agent-executor/src/subagents/subagent-manager.ts:38-41` —
  `wait()` returns `{ jobId, output, metadata }` with no `usage`, though `ISubagentJobResult.usage`
  is declared (`types.ts:56-57`, ANALYTICS-001), `toBackgroundResult` (`:233-241`) carries it, and
  usage is genuinely populated upstream (worker `sumHistoryUsage` → IPC →
  `child-process-subagent-runner-result.ts:161` → `BackgroundTaskManager` completion). `SubagentManager`
  is the only `ISubagentManager` production class, so the **single live reader**,
  `packages/agent-framework/src/orchestration/shared.ts:106`, sees `result.usage` structurally always
  `undefined`. (Correction to the original audit: `interactive-session-agent-jobs.ts:103-107` does NOT
  read `result.usage` — it only passes the result through; `shared.ts:106` is the sole live consumer.)
- **providerProfile dropped by the bridge:** `IAgentBackgroundTaskRequest.providerProfile`
  (`agent-interface-transport/src/background-task-contracts.ts:94`) is read nowhere:
  `toSubagentStartRequest` (`subagent-manager.ts:207-231`) omits it, `ISubagentSpawnRequest` has no
  such field, and the profile that actually reaches the worker is built independently from the
  runner's own `providerConfig` (`child-process-subagent-runner.ts:144`) — the request field is a
  silent no-op.
- **IScheduleEditPatch unexported + duplicated:** it is the parameter type of the public
  `IBackgroundTaskManager.editScheduledTask` / `IBackgroundTaskHandle.editSchedule`
  (`background-tasks/types.ts:103,107,130`) but is omitted from the package's public `index.ts:15-27`
  and documented nowhere; the consumer re-declares the shape inline
  (`agent-framework/src/interactive/interactive-session-base.ts:381`), which `code-quality.md:15`
  bans.

## Finding-depth verdict and re-plan (2026-08-16)

`finding-depth-triager`: **FOUNDATIONAL**. The three fields named below are instances; the cause is that
this seam has no owner — one field family is declared three times as independent shapes and carried by
hand-written literals that nothing checks for totality. Filed as the root item
**[ARCH-031](ARCH-031-subagent-background-task-seam-has-no-owner.md)** / issue
[#1747](https://github.com/woojubb/robota/issues/1747), per `finding-depth.md`'s requirement that a
foundational cause is never patched in place. The disposition is **re-plan**, not containment: the cause was
filed, the loop halted, and the owner decided (2026-08-16) to land this narrowed item first and then
ARCH-031, whose four-package span the owner approved. Containment would additionally require a comment at
the site naming the root item — _"a hold with no such comment is indistinguishable from having ignored the
finding"_ — and that is not what happened here.

A recommendation that proposed solving the cause under this item returned `REVIEW VERDICT: REJECT`
(2026-08-16). Three reasons, each independently sufficient, and they are recorded because the next reader
should not have to rediscover them:

1. A FOUNDATIONAL verdict routes to re-plan or labelled containment — never a third option, and "solve it
   here with a widened package set" is that third option.
2. The plan would have added a public optional field to `IAgentBackgroundTaskRequest`, a published export of
   a package this item does not name — a public-contract change the Agent Authority rule reserves for the
   owner.
3. **Its worktree diagnosis was inverted.** It read `worktreePath`/`branchName` as caller fields dropped by
   `toBackgroundRequest`, and proposed deleting
   `agent-executor/src/subagents/worktree-subagent-runner.ts:117-122` as a "workaround". Those lines are the
   ONLY producer of those fields — the worktree does not exist at spawn time — and deleting them would have
   severed `subagentExecutionRoot`'s "the worktree wins when present" branch, which guards a measured
   containment breach. The invariant is **runner-produced, never caller-supplied**, and it is recorded in
   ARCH-031 so the mistake is not made twice.

**This item's remaining scope is therefore the two repairs that are LOCAL and inside its declared area** —
`usage` and `IScheduleEditPatch` below. Neither is user-visible: review established that `/cost` is fed by
the `background_task_completed` event path (`interactive-session-background-tracker.ts:310`), which bypasses
`wait()` and already works. **The scenario recorded further down this item would therefore pass against
unfixed code and must be re-derived, not re-surfaced.** ARCH-031's derivation will subsume the `wait()`
repair rather than undo it. `providerProfile` moves to ARCH-031: it is a dead contract field
whose disposition belongs with the seam, and it is what ARCH-021 actually needs, so ARCH-021 is unblocked by
ARCH-031 rather than by this item.

## Direction

Create one canonical total mapper for the public task/request/result projection seam. Every public key
must be mechanically classified as mapped, deliberately derived, or explicitly rejected; adding a key
must fail a fixture until classified. Preserve `usage`, `providerProfile`, permission policy, schedule
patch fields, and future public fields rather than relying on recurring hand-written partial objects.
Export one `IScheduleEditPatch` owner from agent-executor and consume it from agent-framework.

## Test Plan

- Red-first projection tests preserve usage, provider profile, permission policy, and schedule edits.
- A public-key exhaustiveness fixture fails whenever a new field is unclassified.
- Typecheck asserts `agent-framework` consumes the exported `IScheduleEditPatch` owner.
- `pnpm harness:verify -- --scope packages/agent-executor` green.

## User Execution Test Scenarios

**Applies — one scenario (S1), for repair #2.** The previous scenario (`/cost` subagent usage) was
**deleted, not amended**: it asserted a before/after contrast that does not exist. `/cost` is fed by the
`background_task_completed` event path — `interactive-session-background-tracker.ts:310` reads
`event.task.result?.usage` off the runner's own result object — which bypasses `SubagentManager.wait()`
and already populates usage today. Running it would have produced a vacuous green of the HARNESS-052
class. It is re-derived below, per repair, rather than re-surfaced.

**Credential probe (recorded, not assumed).** `env | grep -iE 'ANTHROPIC|OPENAI|GEMINI|GOOGLE|BYTEDANCE|API_KEY|ROBOTA'`
returns only `PATH`/`PWD`; `~/.robota` does not exist. No provider credentials are available in this
environment. **S1 needs none** — it was designed to a credential-free surface rather than declared
unrunnable.

### S1 — `/schedule edit` re-arms a live schedule through the de-duplicated patch type (repair #2)

**What this scenario proves, stated plainly.** Repair #2 is a type-level de-duplication with **no
intended runtime change**, so S1 is a **behaviour-preservation scenario over the changed call path**, not
a behaviour-flip one. It will pass before the fix as well as after. It is nonetheless the item's real
scenario, not a test-plan regression guard, for three reasons: (a) `backlog-execution.md` requires a
code-changing backlog's scenario to _exercise the implemented code path_, and this one traverses
`IAgentJobHostContext.editSchedule(taskId, patch)` — the exact signature being de-duplicated — with both
patch fields populated; (b) the **Capability Reachability** section forecloses a "library seam ⇒ N/A"
answer when a product surface reaches the changed contract, and `/schedule edit` is that surface; (c) it
is falsifiable in the direction that matters here — if the imported `IScheduleEditPatch` is not
field-equivalent to the two anonymous shapes it replaces, or a field stops being forwarded, S1 fails.
It cannot fail from the work being _undone_; it can fail from the work being done _wrongly_. The
guardian, not this section, decides whether that clears the gate bar.

- **Executability:** `agent-executable`. Non-interactive, no TTY, no provider credentials, no
  `better-sqlite3` (`--no-session-persistence` keeps the session store out of the run). Verified by
  actual execution on this machine before this section was written (see Evidence baseline note).
- **Surface:** the real `robota --serve` runtime host — the same authenticated loopback WS the GUI
  (`apps/agent-app`) drives as a sidecar — using its published `{ type: 'command', name: 'schedule' }`
  client frame and the `command_result` / `background_tasks` server frames
  (`packages/agent-transport-protocol/src/ws-handler.ts:236-253`, `ws-protocol.ts:35,76`).
  _Why not plain `robota -p "/schedule …"`:_ print mode dispatches slash commands correctly (verified),
  but scheduled tasks are held in `BackgroundTaskManager`'s in-memory map with no disk store, and print
  mode accepts exactly one prompt per process — so a second invocation observes `No schedules.`
  (verified). `create → edit → list` needs one long-lived process, which is what `--serve` provides.
- **Prerequisite state:**
  - built CLI: `pnpm --filter @robota-sdk/agent-cli build`, which produces
    `packages/agent-cli/bin/robota.cjs` and `packages/agent-cli/dist/node/`.
  - Node >= 22 (the driver uses the global `WebSocket`). **No dependency needs to be added** — the
    driver imports only `node:child_process`, `node:fs`, `node:net`, `node:os`, `node:path`, `node:url`.
  - the driver creates its own throwaway project dir, throwaway `HOME`, and a `.robota/settings.json`
    holding a **dummy** provider profile. That profile only lets the CLI boot; `/schedule` is an
    `inline` system command that returns without ever calling a model.
- **Exact commands** (run from the repo root):

```bash
pnpm --filter @robota-sdk/agent-cli build

mkdir -p scratch/src
cat > scratch/src/arch-025-schedule-edit.mjs <<'ARCH025_EOF'
/**
 * ARCH-025 user-execution driver: `/schedule` create -> list -> edit -> list over the real
 * `robota --serve` runtime host (the same loopback WS surface apps/agent-app drives).
 * Credential-free: the provider profile only boots the CLI; `/schedule` never calls a model.
 * Exits 0 when every assertion holds, 1 otherwise.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file lives at <repo>/scratch/src/, so the repo root is two levels up.
const BIN = fileURLToPath(new URL('../../packages/agent-cli/bin/robota.cjs', import.meta.url));
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

const cwd = mkdtempSync(join(tmpdir(), 'arch025-cwd-'));
const home = mkdtempSync(join(tmpdir(), 'arch025-home-'));
mkdirSync(join(cwd, '.robota'), { recursive: true });
writeFileSync(
  join(cwd, '.robota', 'settings.json'),
  JSON.stringify({
    currentProvider: 'anthropic',
    providers: { anthropic: { type: 'anthropic', model: 'claude-test-model', apiKey: 'unused' } },
  }),
);

const port = await freePort();
const token = 'arch025-nonce-0123456789abcdef';
const child = spawn(process.execPath, [BIN, '--serve', '--no-session-persistence'], {
  cwd,
  env: {
    PATH: process.env.PATH ?? '',
    HOME: home,
    ROBOTA_WS_TOKEN: token,
    ROBOTA_WS_PORT: String(port),
  },
  stdio: ['ignore', 'ignore', 'ignore'],
});

let exitCode = 1;
try {
  await waitPort(port, 30_000);
  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${encodeURIComponent(token)}`);
  const inbox = [];
  ws.onmessage = (ev) => {
    try {
      const f = JSON.parse(String(ev.data));
      if (
        f.type === 'command_result' ||
        f.type === 'background_tasks' ||
        f.type === 'protocol_error'
      )
        inbox.push(f);
    } catch {
      /* ignore non-JSON */
    }
  };
  await new Promise((r) => {
    ws.onopen = r;
  });

  const send = async (frame, budgetMs = 15_000) => {
    const before = inbox.length;
    ws.send(JSON.stringify(frame));
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      if (inbox.length > before) return inbox[inbox.length - 1];
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no response to ${JSON.stringify(frame)}`);
  };
  const schedule = (args) => send({ type: 'command', name: 'schedule', args });

  const created = await schedule('cron "0 9 * * *" run the daily report');
  const id = created.data?.taskId;
  check(
    'create succeeds',
    created.success === true && typeof id === 'string' && id.length > 0,
    created.message,
  );

  const listBefore = await schedule('list');
  check(
    'list shows original cadence 0 9 * * *',
    listBefore.message.includes('0 9 * * *'),
    listBefore.message,
  );

  const edited = await schedule(`edit ${id} cron "30 18 * * *" run the evening report`);
  check(
    'edit reports the new cadence',
    edited.success === true && edited.message === `Schedule updated: ${id} (cron \`30 18 * * *\`).`,
    edited.message,
  );

  const listAfter = await schedule('list');
  check(
    'list shows the new cadence and not the old one',
    listAfter.message.includes('30 18 * * *') && !listAfter.message.includes('0 9 * * *'),
    listAfter.message,
  );

  const tasks = await send({ type: 'get-background-tasks' });
  const state = tasks.tasks?.find((t) => t.id === id);
  check(
    'both patch fields landed on the task state',
    state?.schedule?.cronExpression === '30 18 * * *' &&
      state?.schedule?.agentInstruction === 'run the evening report',
    JSON.stringify(state?.schedule),
  );

  ws.close();
  exitCode = failures.length === 0 ? 0 : 1;
  console.log(`\nSCENARIO RESULT: ${exitCode === 0 ? 'PASS' : `FAIL (${failures.join(', ')})`}`);
} catch (err) {
  console.log(`\nSCENARIO RESULT: FAIL (${err instanceof Error ? err.message : String(err)})`);
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(cwd, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  process.exit(exitCode);
}
ARCH025_EOF

node scratch/src/arch-025-schedule-edit.mjs; echo "EXIT=$?"
```

- **Expected observable result:** exit code `0`, and stdout containing all five lines below (the
  `next …` timestamps in the two list lines are clock-relative and are NOT part of the expectation; the
  cadence substrings are):
  - `PASS  create succeeds` — observed line reports a scheduled wake at cron `0 9 * * *` with a task id
  - `PASS  list shows original cadence 0 9 * * *`
  - `PASS  edit reports the new cadence` — the observed `command_result.message` is exactly
    `Schedule updated: <id> (cron ` + the backtick-quoted `30 18 * * *` + `).`
  - `PASS  list shows the new cadence and not the old one` — the list line now reads `[sleeping] 30 18 * * *`
    and no longer contains `0 9 * * *`
  - `PASS  both patch fields landed on the task state` — observed
    `{"cronExpression":"30 18 * * *","agentInstruction":"run the evening report"}`, i.e. **both** fields
    of the patch the CLI sends survived the hop
  - final line `SCENARIO RESULT: PASS`
- **Cleanup:** the driver removes its own temp project dir, temp `HOME`, and `SIGTERM`s the serve host
  in a `finally` block (falling back to `SIGKILL`), so no process or file survives a failed run. The
  only residue is `scratch/src/arch-025-schedule-edit.mjs`, which is gitignored (`scratch/.gitignore`
  ignores all of `src/*`) — the sanctioned home for disposable live-verification scripts. Delete it with
  `rm -f scratch/src/arch-025-schedule-edit.mjs` if a clean tree is wanted. No `~/.robota` is created or
  touched: the driver overrides `HOME`.
- **Evidence (2026-08-16, post-implementation, branch `fix/arch-025-executor-projection-totality`):**
  the command block above was extracted **verbatim** from this file and run. `EXIT=0`, stdout:

  ```
  PASS  create succeeds
        observed: Scheduled wake (cron `0 9 * * *`): "run the daily report" — task process_1.
  PASS  list shows original cadence 0 9 * * *
        observed: - process_1 [sleeping] 0 9 * * * — Scheduled: run the daily report (next 2026-08-17T00:00:00.000Z)
  PASS  edit reports the new cadence
        observed: Schedule updated: process_1 (cron `30 18 * * *`).
  PASS  list shows the new cadence and not the old one
        observed: - process_1 [sleeping] 30 18 * * * — Scheduled: run the daily report (next 2026-08-16T09:30:00.000Z)
  PASS  both patch fields landed on the task state
        observed: {"cronExpression":"30 18 * * *","agentInstruction":"run the evening report"}

  SCENARIO RESULT: PASS
  ```

  - **Matches the pre-implementation baseline exactly**, which is the pass condition for a
    behaviour-preservation scenario: the same five `PASS` lines and the same `Schedule updated: …`
    string. Had they differed, repair #2's "no runtime change" claim would be falsified and this would
    be a failure, not a new baseline. No expectation was rewritten after observing the output.
  - **Durable artifacts this evidence rests on.** The driver at `scratch/src/arch-025-schedule-edit.mjs`
    is deliberately NOT one: `backlog-execution.md` § Script home puts disposable live-verification
    scripts in that gitignored home, so it exists only while a run is in flight and is absent from a
    fresh clone. It is **regenerated verbatim by the heredoc in the command block above**, which is
    committed in this file — that block, not the file it writes, is the durable artifact, and the
    scenario author proved the round-trip by deleting the driver and re-running the extracted block.
    The durable repository artifacts for these two repairs are:
    - `packages/agent-executor/src/subagents/__tests__/subagent-manager.test.ts` — the red-proved
      contract cases (`wait() carries the declared usage through to its caller`, which failed with
      `expected undefined to deeply equal { promptTokens: 120, … }` before the fix, and
      `wait() omits usage entirely when the runner reported none`);
    - `packages/agent-executor/src/index.ts` and `packages/agent-executor/src/background-tasks/index.ts` —
      the `IScheduleEditPatch` exports;
    - `packages/agent-framework/src/command-api/host-context.ts` and
      `packages/agent-framework/src/interactive/interactive-session-base.ts` — both re-declaration sites,
      now naming the owner, with `rg` finding zero occurrences of the anonymous literal repo-wide.
  - **What this does and does not prove.** It proves the `/schedule edit` path still works end to end
    through the de-duplicated `IScheduleEditPatch` signature, and that **both** patch fields survive the
    hop. It does **not** demonstrate a behaviour change, because repair #2 is a type-level
    de-duplication that intends none — stated here so the Done Gate reads it as the non-regression proof
    it is rather than as evidence of a fix.

### Repair #1 (`usage` carried by `wait()`) — no product-surface observable; absence recorded with its trace

Deliberately **not** given a scenario, and this is a recorded finding rather than an unexamined N/A. The
trace was re-verified independently at authoring time (not taken from the recommendation), and it is
**wider** than the recommendation stated — the recommendation named one consumer of `wait()`; there are
four, and none of them reaches a surface:

| `wait()` consumer (non-test)                                                                                                    | Where the `usage` field ends up                                                                  | Reachable observable                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-framework/src/orchestration/shared.ts:104` (`runStepOnce`)                                                               | `IOrchestrationStepResult.usage` (`agent-core/src/orchestration/orchestration-contracts.ts:159`) | **None.** `rg` finds the field written at `shared.ts:106` and read nowhere. Additionally the five primitives that produce it (`runSequential`/`runParallel`/`runHandoff`/`runHierarchical`/`runGroupChat`) have **no non-test caller** in the repo — they are exported from `agent-framework/src/index.ts:497-501` and consumed only by their own `__tests__`. |
| `agent-framework/src/tools/agent-tool.ts:236` (Agent tool, single)                                                              | `stringifyAgentSuccess` (`tools/agent-tool-output.ts:43-69`)                                     | **None.** That function builds its JSON from an **explicit field list** (`output`, `agentId`, `agentIds`, `provenance`, `metadata`, worktree fields) — no spread, no `usage` key. Adding `usage` to `wait()` cannot change its output.                                                                                                                         |
| `agent-framework/src/tools/agent-tool-batch.ts:217` (Agent tool, batch)                                                         | `createBatchSuccessResult` (`:172-188`)                                                          | **None.** Same shape: an explicit field list with no `usage` key.                                                                                                                                                                                                                                                                                              |
| `agent-framework/src/interactive/interactive-session-base.ts:306` (`waitAgentJob`, via `interactive-session-agent-jobs.ts:104`) | returned to the caller as `ISubagentJobResult`                                                   | **None.** `rg -n "waitAgentJob"` over `packages` + `apps` finds only the declaration, the delegation, and the import — **no caller at all**, in any command module or app.                                                                                                                                                                                     |

`/cost` is explicitly _not_ on this list and must not be used as the observable: it reads
`event.task.result?.usage` from the `background_task_completed` event
(`interactive-session-background-tracker.ts:310`), a path that never goes through `wait()` and already
works. That is precisely what made the deleted scenario vacuous.

**Missing surface wiring, named rather than waived** (per the Capability Reachability requirement that an
unreachable capability is a finding, not an exemption). For a subagent's token usage obtained through
`wait()` to become user-observable, one of these must also land — none is in this item's scope, and each
belongs with ARCH-031's ownership of the seam:

1. `stringifyAgentSuccess` / `createBatchSuccessResult` carrying `usage` into the Agent tool's JSON
   result (the closest reachable surface — it appears in the tool-result panel);
2. a reader for `IOrchestrationStepResult.usage`, plus any product surface that calls an orchestration
   primitive at all;
3. a caller for `IAgentJobHostContext.waitAgentJob` that renders the result.

Until then the repair is a **forward-provisioned contract surface**, which `project-structure.md` holds
to the same quality bar ("_'nobody uses it yet' never downgrades a defect on such a surface_"). Its
verification is the red-first contract test in `## Test Plan` — engineering evidence, which per
`backlog-execution.md` is never user-execution evidence and is not cited as such here.

---

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-16

**Status upgrade:** scenario-written (Stage 1) → eligible for `DONE-GATE-STAGE-2`. Frontmatter
`status: todo` deliberately unchanged — only Stage 2 plus the Completion Steps may set a terminal status.

**Ordering check:** exempt. `gate-catalogue.md` > Prior-gate map states DONE-GATE-STAGE-1 has no prior
gate and defines no expected input status. No `[DONE-GATE-STAGE-1]` entry pre-existed in this item, so
this is the first run, not a re-run over a prior verdict.

**Per-criterion evidence:**

- **Field completeness (S1)** — PASS. Exact commands: the fenced block (`pnpm --filter
@robota-sdk/agent-cli build`, the `scratch/src/arch-025-schedule-edit.mjs` heredoc, `node … ; echo
"EXIT=$?"`). Prerequisites: built CLI + `packages/agent-cli/bin/robota.cjs`, Node ≥ 22 for global
  `WebSocket`, driver-created throwaway cwd/`HOME`/dummy `settings.json`, and an explicit "no dependency
  needs to be added" (driver imports only `node:` builtins — confirmed by reading the block). Expected
  observable: `EXIT=0`, five named `PASS` lines, the exact `Schedule updated: <id> (cron \`30 18 * *
  _\`).`string, final`SCENARIO RESULT: PASS`, with the clock-relative `next …`timestamps explicitly
excluded from the expectation. Cleanup:`finally`block SIGTERM→SIGKILL + temp-dir removal, and the
named residue`scratch/src/arch-025-schedule-edit.mjs`(present on disk;`scratch/.gitignore`does
ignore`src/_` as claimed). Evidence field: present and populated.
- **Expectation not back-fitted to output (Evidence rule)** — PASS, verified mechanically, not accepted
  on assertion. `git diff fc9f275be 175d2bd8c -- <this file>` touches **only** the Evidence bullet; the
  "Expected observable result" list is byte-identical across the authoring commit and the evidence
  commit, and the authoring commit already recorded the against-unfixed-code baseline as the pass
  condition. The item's "no expectation was rewritten" claim is therefore checked, not taken.
- **Executability decision (S1)** — PASS. Recorded as `agent-executable` with the reasons that make it
  one (non-interactive, no TTY, no credentials, `--no-session-persistence` keeps `better-sqlite3` out).
  Not a bare label. `manual-only` is not used anywhere in this item, so the specific-technical-reason
  sub-clause is not engaged.
- **Drives a product surface** — PASS. The observable is `command_result` / `background_tasks` frames
  from a live `robota --serve` host spawned from the built product binary — not a build, typecheck,
  lint, test, harness, CI, or repository-text inspection. The surface exists as described:
  `{ type: 'command'; name: string; args?: string }` and `{ type: 'background_tasks'; tasks: … }` are in
  `packages/agent-transport-protocol/src/ws-protocol.ts:35,96`, dispatched at `ws-handler.ts:234-253`
  and `ws-background-messages.ts:17-18`. The `pnpm --filter … build` line is a prerequisite that
  produces the binary, not the thing observed.
- **Exercises the implemented code path (code-changing item)** — PASS. `/schedule edit` reaches
  `host.editSchedule(id, { cronExpression, agentInstruction })` at
  `packages/agent-command/src/schedule/schedule-command.ts:65-67` — the exact signature retyped by
  repair #2 at `command-api/host-context.ts:263` and `interactive/interactive-session-base.ts:380`
  (commit `a0e33e04`). `rg` finds zero remaining occurrences of the anonymous
  `{ cronExpression?; agentInstruction?; command? }` literal, and `IScheduleEditPatch`
  (`agent-executor/src/background-tasks/types.ts:107-111`) carries all three fields of the shapes it
  replaced, so the de-duplication is field-equivalent and S1's fifth assertion is a real forwarding
  check.
- **Behaviour-preservation shape of S1** — PASS, judged rather than accepted. Stage 1 requires a
  scenario that drives a product surface over the changed path; it nowhere requires a behaviour flip,
  and repair #2 is a type-level de-duplication for which no flip exists to observe — demanding one would
  force a fabricated observable, which is exactly the HARNESS-052 failure the deleted `/cost` scenario
  committed. S1 is falsifiable in the direction that matters (a dropped or renamed patch field fails
  assertion 5), the pre-fix baseline is recorded as the pass condition rather than discovered
  afterwards, and the item states the limit of what it proves instead of overclaiming. Legitimate, not
  vacuous.
- **Credential / external-service prerequisite stated** — PASS. Stated as "needs none", with the reason
  (dummy profile boots the CLI; `/schedule` never calls a model). The recorded probe was **re-run by
  this gate and reproduces exactly**: `env | grep -iE 'ANTHROPIC|OPENAI|GEMINI|GOOGLE|BYTEDANCE|API_KEY|ROBOTA'`
  returns only `PATH` and `PWD`, and `/home/ubunutu/.robota` does not exist. An executor learns from the
  scenario, not from a failure.
- **Repair #1's unwritten scenario (Exception clause)** — PASS by exception, and it is a finding, not an
  N/A dodge. "Genuinely impossible" is established by evidence I re-verified independently rather than
  read: `rg` finds exactly the four non-test `wait()` consumers the table names
  (`orchestration/shared.ts:104`, `tools/agent-tool.ts:236`, `tools/agent-tool-batch.ts:217`,
  `interactive/interactive-session-agent-jobs.ts:108`), and each sink is closed —
  `shared.ts:106` writes `usage` and nothing reads it repo-wide; `stringifyAgentSuccess`
  (`tools/agent-tool-output.ts:43-69`) and `createBatchSuccessResult` (`agent-tool-batch.ts:172-188`)
  build explicit field lists with no `usage` key and no spread; `waitAgentJob` has only its declaration
  (`interactive-session-base.ts:307`), its delegation, and test mocks — no production caller; and the
  five orchestration primitives appear only as their own definitions and barrel re-exports
  (`agent-framework/src/index.ts:497-501`). There is therefore no product surface at which a user could
  observe this field, so no scenario could be written that is not fabricated. The absence is recorded
  **under** the unwritten scenario with its per-consumer trace, it refuses `/cost` as a false observable
  and says why the deleted scenario was vacuous, it names the three missing wirings and assigns them to
  ARCH-031 (`.agents/tasks/ARCH-031-subagent-background-task-seam-has-no-owner.md` exists), and it
  states outright that its red-first contract test is engineering evidence and is not being cited as
  user-execution evidence. That is the Capability Reachability requirement satisfied, not waived.

**Advisory for DONE-GATE-STAGE-2 (not part of this verdict):** S1's evidence cites
`scratch/src/arch-025-schedule-edit.mjs`, which is gitignored and self-deleted by the documented cleanup
step. Whether that satisfies the durable-artifact rule and `check-done-evidence.mjs` is Stage 2's
criterion to judge, not Stage 1's.
