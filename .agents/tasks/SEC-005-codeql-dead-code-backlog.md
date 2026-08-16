---
title: 'SEC-005: empty the CodeQL dead-code alert backlog so review-gate can be tightened'
status: in-progress
created: 2026-07-26
priority: medium
urgency: soon
area: packages/agent-core, packages/agent-playground, packages/agent-framework, packages/dag-cli, packages/dag-framework, apps/agent-server
depends_on: []
---

# SEC-005: close every `unused-local-variable` / `useless-assignment-to-local` alert at the source

## Problem

This is not a tidiness item. [INFRA-048](completed/INFRA-048-review-arrives-after-merge.md) designed the
`review-gate` to block only on `error` / security-high findings, and its stated reason was
**measured**: the repository's open CodeQL alerts are dominated by `note`-severity dead-code
findings, so a gate that failed on any finding would be red on every PR from day one and would be
routinely bypassed. **Emptying this backlog is the precondition for tightening `review-gate`** — the
value delivered here is the unlocked gate, not the diff.

The dead-code classes are also under-policed by design. Root `.eslintrc.json` sets
`@typescript-eslint/no-unused-vars` to `"off"` for `**/*.test.ts`, `**/*.test.tsx`, `**/*.bintest.ts`
(the "TEST FILES EXCEPTION" override). That is exactly why **65 of the 91 in-scope alerts sit in test
files**: ESLint never looked, and CodeQL is the only thing that does.

### Measured scope

Alerts were read from the GitHub code-scanning API. Every open alert is analysed against
`refs/heads/main`; this work was performed on `develop`, so the alerts close when `develop` promotes.

| Rule                             | In scope (`packages/**`, `apps/**`) | Deferred (`scripts/**`) |
| -------------------------------- | ----------------------------------- | ----------------------- |
| `js/unused-local-variable`       | 89                                  | 8                       |
| `js/useless-assignment-to-local` | 1                                   | 5                       |
| `js/unused-loop-variable`        | 1                                   | 0                       |
| **Total**                        | **91**                              | **13**                  |

`scripts/**` is owned by another agent and was left untouched — see § Deferred below.

## Three-way classification (all 91 accounted for)

| Category                | Count | Meaning                                                                    |
| ----------------------- | ----- | -------------------------------------------------------------------------- |
| 1 — dead code           | 78    | Genuinely leftover. Deleted.                                               |
| 2 — real defect         | 4     | The value should have been used. Fixed and proven by mutation.             |
| 3 — intentional binding | 5     | Binding never carried meaning; omitted outright.                           |
| **Blocked**             | **4** | Not dead — an architecture invariant forbids removal. See § Blocked below. |

**87 of 91 alerts close here.** Zero dismissals — every closed alert closes because the code
changed. The 4 blocked alerts stay open deliberately rather than be dismissed or force-deleted.

### Category 3 — how intent was made explicit

`.eslintrc.json` sanctions three escape hatches: `varsIgnorePattern: "^_"` /
`argsIgnorePattern: "^_"`, `destructuredArrayIgnorePattern: "^_"`, and `ignoreRestSiblings: true`.
**None was needed.** In all five cases the binding could simply be _omitted_, which preserves the
meaning without needing a marker at all:

- `agent-factory.test.ts:91` — `for (const [agentId, agent] of map)` → `for (const agentId of map.keys())`
- `abort-after-permission.test.tsx:25` — `const [isThinking, setIsThinking] = useState(true)` → `const [isThinking] = useState(true)`
- `pairing-gate-e3.test.ts:128` — `const { cfg, hostKeyPair } = await hostConfig(...)` → `const { cfg } = ...`
- `rtc-signaling.test.ts:115` — `const { socket, onError, client } = setup()` → `const { socket, onError } = setup()`
- (`agent-factory.test.ts:91` is reported by two rules — `js/unused-local-variable` and `js/unused-loop-variable` — and one edit closes both.)

No interface-mandated parameter appeared anywhere in this alert set, so the `^_` prefix was used
**zero** times. An unused binding that must exist would have taken the `^_` form; none did.

## Category 2 — the real defects

### 2a. `worker-loop-driver.test.ts` — two tests that asserted nothing (headline find)

`packages/dag-framework/src/__tests__/worker-loop-driver.test.ts` had two tests whose stated subject
was never checked. The unused locals were the visible end of it.

**`applies exponential backoff when idle`** declared `const sleepDurations: number[] = []`, never
populated it, and asserted only `expect(calls).toBeGreaterThan(1)` — which passes with backoff
removed entirely.

**`resets backoff delay after processing work`** declared `let calls = 0` (never incremented, the
loop helper had its own counter) and its sole assertion was:

```ts
// Verify driver didn't crash and processed expected sequence
expect(true).toBe(true);
```

A tautology. The test name promised the backoff _reset_ — the one behaviour that distinguishes
`WorkerLoopDriver` from a fixed-interval poller — and verified nothing.

**Fix.** Both tests now record the real sleep schedule by spying the faked `setTimeout` and assert
the exact sequence `WorkerLoopDriver.runLoop` must produce (`MIN=25`, doubling, capped at `MAX=500`):

```ts
expect(sleepDurations.slice(0, 5)).toEqual([50, 100, 200, 400, 500]); // doubling + cap
expect(sleepDurations.slice(0, 4)).toEqual([50, 100, 50, 100]); // reset after processed
```

**Failing-test evidence (mutation-proven; the source was restored afterwards).** The old tests stayed
green under both mutations; the new ones go red:

_Mutation A — delete `delay = MIN_IDLE_DELAY_MS;` from the `result.value.processed` branch (removes the reset):_

```
 × WorkerLoopDriver > resets backoff delay after processing work
   → expected [ 50, 100, 200, 400 ] to deeply equal [ 50, 100, 50, 100 ]
 Tests  1 failed | 5 passed (6)
```

_Mutation B — replace `delay = Math.min(delay * 2, MAX_IDLE_DELAY_MS)` with `delay = MIN_IDLE_DELAY_MS` (removes the backoff):_

```
 × WorkerLoopDriver > applies exponential backoff when idle, capped at MAX_IDLE_DELAY_MS
   → expected [ 25, 25, 25, 25, 25 ] to deeply equal [ 50, 100, 200, 400, 500 ]
 × WorkerLoopDriver > resets backoff delay after processing work
   → expected [ 25, 25, 25, 25 ] to deeply equal [ 50, 100, 50, 100 ]
 Tests  2 failed | 4 passed (6)
```

_Unmutated:_ `Test Files 1 passed (1) / Tests 6 passed (6)`.

### 2b. `tool-execution-service.test.ts:522` — a guard test that ignored half its result

`should validate required fields for sequential execution` destructured
`const { results, errors } = await service.executeTools(...)` and asserted only on `errors`. The
point of the guard is that an invalid request produces **no result**, not merely that an error was
recorded — and the thrown type was never checked either (the unused `ValidationError` import at
line 6 was the evidence). Both values are now used as intended rather than deleted:

```ts
expect(results).toHaveLength(0);
expect(errors[0]).toBeInstanceOf(ValidationError);
expect(errors[0]?.message).toContain('executionId');
```

## Honest negative result: no defect in shipped runtime code

Category 2 is non-empty, but **every instance is in test code**. After per-site analysis, no unused
local in shipped source turned out to be a live product defect. The strongest candidates and how
each was ruled out:

| Candidate                                                         | Why it looked like a bug                         | Why it is not                                                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `apps/agent-server/src/app.ts` — `resolveApiDocsEnabled`          | An API-docs exposure flag imported, never called | The `/docs` route it gated was removed wholesale in the api-server split (`45aab62a0`). Nothing remains to gate. See § Follow-ups. |
| `qwen/provider.ts` — `assembleOpenAICompatibleStream`             | Qwen apparently not assembling its stream        | Qwen uses its own `qwenChatWithStreamingAssembly` + `observeProviderNativeRawPayloadStream`; both wired, 101 tests green.          |
| `dag-cli/commands/cost.ts` — `FAILURE_EXIT_CODE`                  | A CLI that might exit 0 on failure               | Every error path in `runCostCommand` is a usage error returning `USAGE_ERROR_EXIT_CODE`; there is no runtime-failure path.         |
| `dag-cli/commands/telemetry.ts` — `isTelemetryEnabled`            | `telemetry status` ignoring the env kill-switch  | `telemetryStatus` re-implements the `CI` / `ROBOTA_DAG_TELEMETRY=0` checks inline with more specific messages. Behaviour matches.  |
| `session-prompt-registry.ts` — `GATING_EVENT`                     | A kind→event map never applied                   | Both emit sites pass the correct event literal directly, and the reconcile site's inverse mapping is correct.                      |
| `agent-playground/lib/playground/config-validation.ts` — `errors` | An `errors[]` in a `validate*` function          | The function has no failure contract (returns `IPlaygroundConfig`, not a result type). Adjacent issue logged in § Follow-ups.      |

## What changed, by package

| Package                                                                                     | Alerts | Notable                                                                                        |
| ------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `agent-core`                                                                                | 28     | C2 assertion gaps (2b); dead `CASSETTE_RECORD_CWD`, `EXECUTION_EVENTS`, superseded test locals |
| `agent-playground`                                                                          | 28     | Vendored shadcn primitives trimmed to their export list; 4 blocked (see § Blocked)             |
| `agent-framework`                                                                           | 7      | Dead `GATING_EVENT`; redundant `createdAt` initializer                                         |
| `dag-cli`                                                                                   | 6      | Dead imports + a duplicate `resolveErrorMessage`                                               |
| `dag-framework`                                                                             | 2      | **Both category 2** — see 2a                                                                   |
| `agent-plugin`                                                                              | 3      | Unused error-class imports                                                                     |
| `agent-transport-tui` / `-webrtc` / `-webrtc-web` / `-ws` / `-protocol` / `agent-transport` | 8      | Destructure omissions + dead mock helper                                                       |
| `agent-cli`, `agent-server`, 4 providers, `agent-subagent-runner`, `dag-node`, `dag-nodes`  | 9      | Dead imports / dead schema constant                                                            |

`agent-playground`'s `hooks/use-block-tracking.ts` was deleted outright as an unreachable husk — an
unexported hook whose only trace was a never-read optional `blockTracking` field on
`IChatInputOptions`, removed with it. The shared `block-tracking` library it referenced is used
elsewhere and was left intact.

`apps/agent-server/src/utils/env-flags.ts` was deleted with its `docs/SPEC.md` entry: the `/docs`
route `resolveApiDocsEnabled` gated was removed wholesale in the api-server split (`45aab62a0`), so
the module had no caller and nothing left to gate.

## Blocked — 4 alerts that must NOT be closed by deletion

`packages/agent-playground/src/lib/playground/robota-executor/` contains an abandoned execution
subsystem. Two husk files look like textbook dead code:

- `agent-session.ts` — an **8-line file containing only import statements** and no code at all
  (alerts #263, #264, #265)
- `remote-providers.ts` — two never-exported, never-called functions (alert #266)

Deleting them was attempted and **reverted**, because `pnpm harness:verify-like-ci` proved they are
load-bearing in two distinct ways:

1. **`agent-server-boundary` (hard gate).** `scripts/harness/check-agent-server-boundary.mjs:144-150`
   requires `packages/agent-playground/src` to import `@robota-sdk/agent-remote-client`:
   _"agent-playground should keep reusable remote execution behavior in the package, backed by
   agent-remote-client."_ The dead `createRemoteExecutor` inside `remote-providers.ts` is the
   **only** such import in the package. The architecture invariant is currently satisfied
   **vacuously, by dead code** — deleting it turns the scan red.

2. **`orphan-exports` cascade.** The imports-only `agent-session.ts` is the sole file referencing
   `createToolFromCard` (`tool-card-adapter.ts`) and `normalizeTools` (`tool-normalization.ts`);
   `remote-providers.ts` is the sole file referencing `REMOTE_EXECUTOR_TIMEOUT_MS` (`constants.ts`).
   Removing the husks flags all three as orphaned exports, and following the chain further orphans
   `ToolRegistry` in `src/tools/catalog.ts`. **A file containing nothing but imports was the only
   thing keeping four modules from being reported as orphaned.**

Closing these four alerts therefore requires an architecture decision, not a dead-code sweep — pick
one and track it separately:

- **Wire it**: finish the subsystem so `createRemoteExecutor` and the tool-card adapters have a real
  caller (the seam the boundary rule intends), or
- **Remove it**: delete the whole chain (`agent-session`, `remote-providers`, `tool-card-adapter`,
  `tool-normalization`, `constants`, `ToolRegistry`) _and_ amend the `agent-server-boundary` rule,
  which lives in `scripts/**` and is outside this PR's ownership.

Neither belongs in a behaviour-preserving cleanup, so the four alerts stay open and undismissed.

## Deferred: `scripts/**` (13 alerts, another agent owns that tree)

Left untouched, to be closed separately:

| Rule                             | Site                                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/useless-assignment-to-local` | `scripts/harness/verify-change.mjs:164,175,195,259,293` — five writes to `allPassed` that are never read; likely a real aggregation bug, triage it                                                                                                                              |
| `js/unused-local-variable`       | `scripts/harness/verify-change.mjs:348`, `self-check.mjs:165`, `cleanup-drift.mjs:235`, `collect-run-context.mjs:17`, `scan-memory-neutrality.mjs:121`, `scripts/docs/cleanup-readme.js:7`, `scripts/docs/copy-readme.cjs:84`, `scripts/examples/deepseek-provider-demo.mjs:17` |

`verify-change.mjs`'s five `allPassed` writes are the one deferred item that deserves priority: a
pass/fail aggregator whose assignments are all dead is the shape of a verification step that cannot
report failure.

## Follow-ups (found while classifying; out of this PR's scope)

1. **`agent-server` lost its API-docs exposure switch.** `env-flags.ts` and its SPEC entry are gone
   with the dead import, which is correct for the current code — but if a `/docs` route is ever
   restored to `agent-server`, it must come back gated by `API_DOCS_ENABLED` rather than
   unconditionally exposed.
2. **NUL bytes in `packages/agent-core/src/testing/cassette-provider.ts`.** `SCRUB_TOKEN` is
   `'\0SCRUBBED\0'`, not `' SCRUBBED '` — literal U+0000 where spaces were plainly intended (the file
   is classified as binary by `file(1)` and is invisible to `grep`). The removed `CASSETTE_RECORD_CWD`
   had the same corruption. It is behaviourally inert today (the token only has to be unique) but
   changing it invalidates recorded cassette hashes, so it was left alone deliberately.
3. **`config-validation.ts` logs a fallback it does not apply.** On an invalid `serverUrl` / `apiUrl`
   it warns `"using default localhost:3001"` but keeps the invalid value. Note that the repo's
   No-Fallback rule (HARNESS-028) makes "just apply the default" the wrong reflex — the correct fix
   is probably to fail loudly or to correct the message.
4. **`plugins.test.ts` has no error-path coverage.** It imported `PluginError` and
   `ConfigurationError` and contains zero `toThrow` / `rejects` assertions, while
   `plugins-helpers.ts` has seven distinct throw sites. The imports were removed as dead; the
   coverage gap remains.
5. **The premise behind this work should be re-measured before tightening `review-gate`.** The brief
   for this item stated 100 open alerts, all `note`/`warning`. The live API today reports **170 open
   alerts on `refs/heads/main`**, still including security-severity classes (`js/path-injection` ×7,
   `js/file-system-race` ×15, `js/insecure-temporary-file` ×7, `js/system-prompt-injection` ×6, and
   the command-injection family ×10). Those are `main`-analysed and largely stale against `develop`
   and/or owned by SEC-003/SEC-004 — but **`review-gate` must not be tightened on the assumption that
   this PR empties the alert list.** It empties the dead-code classes (91 alerts); confirm the
   remainder is closed on `main` first.

## Observation added 2026-08-16 — a triage that is not applied has to be redone

**Measured on PR #1778 (CORE-044), which it blocked.** The `CodeQL` check reported _"6 new alerts
including 6 high severity security vulnerabilities"_ and went red. All six are
`js/system-prompt-injection`, alert numbers **11–16**, `created_at` **2026-07-23** on
`refs/heads/main` — a month older than the pull request they were reported as new in. They surfaced
because the pull request MOVED the code carrying the taint path (the provider chat routes were split
out of `apps/agent-server/src/app.ts`), so the pre-existing alerts re-attributed to changed code.

They had already been triaged. [SEC-006](completed/SEC-006-main-ref-alert-triage.md) §
_"`js/system-prompt-injection` ×6 — a provider adapter is not the trust boundary"_ examined every one
and recorded them as false positives, with the reasoning that the sites are role-preserving format
translations with no interpolation and no role decision, and that the real question — whether
lower-trust content can acquire the `system` role upstream — belongs to SEC-007 and is not at those
lines.

**The verdict was written in a document and never applied to the alerts.** All six are still
`state: open`, `dismissed_at: null`, `dismissed_reason: null`. So the analysis has to be redone by
the next author whose diff happens to touch a file on the path, and the check goes red on correct
work — the shape `git-branch.md` names: _"a gate that trains people to route around it has already
failed."_

The fix is to make the recorded triage the alerts' actual state: dismiss each as `false positive`
with the SEC-006 reasoning as the comment, so the judgement survives outside a markdown file.
**Deliberately not done here** — dismissing security alerts changes the repository's security posture
and is visible outside this work; it is an owner action, not a side effect of an unrelated pull
request.

Worth checking in the same pass, and measured rather than presumed: the repository currently has
**92 open alerts with `dismissed_at: null` against 2 dismissed in total**. So essentially every
triage this repository has performed lives only in markdown, and each one will block whichever pull
request next touches a file on its path — the same round again, for every class SEC-006 cleared.

## Test Plan

- Full test suite of **every touched package**, run in the foreground (see evidence below).
- `pnpm build`, `pnpm typecheck`, `pnpm lint` (0 errors).
- `pnpm harness:verify-like-ci` — all stages.
- Mutation proof for the category-2 fix: two independent source mutations of
  `WorkerLoopDriver.runLoop`, each shown to turn the rewritten tests red (transcripts in § 2a),
  with the source restored afterwards. This is the HARNESS-041 accidental-green discipline applied
  by hand: a rewritten assertion is only worth anything if it fails when the behaviour it names
  is broken.

## User Execution Test Scenarios

**Not applicable.** This is a behaviour-preserving dead-code removal plus test-assertion
strengthening; it delivers no new user-facing behaviour. The two deliberate behavioural deltas are
both inside the test suite. Verification therefore belongs entirely in § Test Plan, which is where
it is recorded.
