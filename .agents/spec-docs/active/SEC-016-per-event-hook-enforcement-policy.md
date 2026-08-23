---
status: in-progress
type: SECURITY
tags: [typescript, async, auth]
---

# SEC-016: Per-event fail-closed and advisory hook policy

Registered as GitHub issue #2093 (leaf of tracker issue #2075, blocked by issue #2083 which is now delivered).

## Problem

An enforcing hook that could not reach a verdict does not block. Issue #2083 made that failure
_representable_ — `runHooks` now returns `IRunHooksResult.errors`, each carrying a `kind` and the
`source` executor — but nothing consumes it. `packages/agent-session/src/tool-hook-helpers.ts:69`
still reads `if (hookResult.blocked)` and nothing else, so a `PreToolUse` hook that timed out, failed
to spawn, or answered with an undecodable body is indistinguishable at the enforcement boundary from
one that approved.

**Reproduction condition.** Configure a `PreToolUse` command hook in `.robota/settings.json` whose
`command` names a path that does not exist, or an `http` hook pointing at an unreachable endpoint.
The tool call proceeds. The configured gate did not run and nothing stops the action it was
configured to guard.

### The second, larger problem: a policy table here would mostly describe an absence

The issue's acceptance criteria include _"advisory continuation is limited to explicitly listed
events"_. Before designing that list, measured — every `runHooks` fire site in the tree, whether its
result is awaited, and which fields it reads:

| Event                               | Fire site                                                      | Awaited | Reads                 | Can block today |
| ----------------------------------- | -------------------------------------------------------------- | ------- | --------------------- | --------------- |
| `PreToolUse`                        | `agent-session/src/tool-hook-helpers.ts:63`                    | await   | `.blocked`, `.reason` | **yes**         |
| `PostToolUse`                       | `agent-session/src/tool-hook-helpers.ts:92`                    | no      | —                     | no              |
| `SessionStart`                      | `agent-session/src/session-lifecycle.ts:67`                    | no      | `.stdout`             | no              |
| `SessionEnd`                        | `agent-session/src/session-lifecycle.ts:98`                    | await   | nothing               | no              |
| `PreCompact`                        | `agent-session/src/compaction-orchestrator.ts:126`             | await   | nothing               | no              |
| `PostCompact`                       | `agent-session/src/session-history-ops.ts:132`                 | no      | —                     | no              |
| `UserPromptSubmit`                  | `agent-session/src/session-run.ts:136`                         | await   | `.stdout` only        | no              |
| `Stop` / `StopFailure`              | `agent-session/src/session-run.ts:238,296`                     | no      | —                     | no              |
| `SubagentStart` / `SubagentStop`    | `agent-framework/src/assembly/background-task-hooks.ts:68`     | void    | —                     | no              |
| `WorktreeCreate` / `WorktreeRemove` | `agent-executor/src/subagents/worktree-subagent-runner.ts:256` | void    | —                     | no              |
| `PreModelCall` / `PostModelCall`    | `agent-session/src/session-run.ts:51`                          | void    | —                     | no              |
| `PermissionDecision`                | `agent-session/src/permission-enforcer.ts:231`                 | void    | —                     | no              |

**One of sixteen events can block.** The other fifteen are advisory _by construction_, and the split
by event is **7 / 5 / 3**: seven fire `void` (`SubagentStart`, `SubagentStop`, `WorktreeCreate`,
`WorktreeRemove`, `PreModelCall`, `PostModelCall`, `PermissionDecision`), five are called without
`await` (`PostToolUse`, `SessionStart`, `PostCompact`, `Stop`, `StopFailure`), and three await a
result they never inspect for `blocked` (`SessionEnd`, `PreCompact`, `UserPromptSubmit`). 7 + 5 + 3 +
`PreToolUse` = 16.
`UserPromptSubmit` is the sharpest case: it awaits, and reads `.stdout` while ignoring `.blocked`, so
a hook answering `{"decision": "block"}` there is silently inert (`HOOK-CATALOG.md` documents this).

So a policy table listing fifteen events as "advisory" would be accurate and almost entirely
uninformative: it would read as a series of decisions where, for fifteen rows, no mechanism exists to
decide otherwise. Worse, it would be **unfalsifiable in the direction that matters** — mark a
sixteenth event "enforcing" tomorrow and nothing would enforce it, because the fire site discards the
result. The table would say the gate is on and the code would not be.

That is the failure this leaf has to avoid, and it is why the design below is not only a table.

## Prior Art Research

**Claude Code hooks — the direct analog, and it maintains exactly this table.** Its documentation
carries a per-event list of which events can block on exit 2 (`PreToolUse`, `UserPromptSubmit`,
`Stop`/`SubagentStop`, `PreCompact` and others) versus which cannot (`PostToolUse`,
`PostToolUseFailure`, `Notification`, `SessionStart`, `SessionEnd`, `CwdChanged` — "shows as an error
notice but proceeds"). Notably `PermissionRequest` "must use JSON decision instead" — a case where
the event is enforcing but through a different channel. So the per-event capability table is a real,
maintained artefact in the system Robota's hook engine is compatible with, not an invention here.
Its failure posture is documented as fail-open throughout: a timed-out hook "doesn't block the tool
call", a hook that cannot start "lands in the same non-blocking bucket", an HTTP connection failure
is a "non-blocking error, execution continues".
<https://code.claude.com/docs/en/hooks>

**Kubernetes admission webhooks — per-callout policy, defaulting closed.** `failurePolicy` takes
`Fail` or `Ignore`, and `Fail` is the default; a call that times out "is handled according to the
webhook's failure policy". The policy is declared per webhook in configuration rather than derived,
and the closed posture is what you get without deciding.
<https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/>

**Envoy `ext_authz` — closed by default, and the open case is made observable.**
`failure_mode_allow` defaults to `false`: on communication failure or a 5xx from the authorization
service the filter rejects with `Forbidden`. When an operator opts into fail-open AND sets
`failure_mode_allow_header_add`, Envoy appends `x-envoy-auth-failure-mode-allowed: true` to the request, so a downstream consumer can see the gate
was skipped, and the condition is counted in stats.
<https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/ext_authz/v3/ext_authz.proto>

**Observed common behavior.** All three declare the posture per callout or per event rather than
globally, and none derives it from whether a result happens to be consulted. The two whose hooks are
security boundaries default closed and make the open case explicit and _visible_ — Envoy with a
header and counters, Kubernetes by making `Ignore` a written choice.

**The constraint that applies to Robota.** Tracker issue #2075 has already chosen the admission-control
posture over Claude Code's fail-open one, and issue #2083 supplied the outcome vocabulary. What none
of the three references has to contend with is Robota's actual situation: a table whose rows can be
_inert_. Kubernetes cannot configure a webhook whose result the API server ignores; Envoy cannot
configure a filter that is not in the request path. Robota can — fifteen of sixteen fire sites
discard the result — so a declared policy and an effective policy can disagree with nothing
noticing. Envoy's answer to the adjacent problem is the useful steer: it does not merely permit
fail-open, it makes fail-open _observable_. The analogue here is not a header but a mechanical check
that a row claiming to enforce is attached to a fire site that can.

## Architecture Review

### Affected Scope

| Package                  | File                                        | Change                                                     |
| ------------------------ | ------------------------------------------- | ---------------------------------------------------------- |
| `packages/agent-core`    | `src/hooks/enforcement-policy.ts` (new)     | The event → posture table and its lookup                   |
| `packages/agent-core`    | `src/hooks/types.ts`                        | `THookEnforcementPosture` and the policy entry type        |
| `packages/agent-core`    | `src/hooks/index.ts`, `src/index.ts`        | Export the posture type and the table's accessor           |
| `packages/agent-core`    | `docs/SPEC.md`, `docs/HOOK-CATALOG.md`      | Posture column; the fail-closed contract                   |
| `packages/agent-session` | `src/tool-hook-helpers.ts`                  | `runPreToolHook` denies on `errors` per the policy         |
| `packages/agent-session` | `docs/SPEC.md`                              | The enforcement boundary's new behaviour                   |
| `scripts/harness`        | `scan-hook-enforcement-reachable.mjs` (new) | Refuses a row that claims to enforce at an inert fire site |

**Not in scope, measured rather than assumed.** `packages/agent-framework/src/interactive/` holds no
`runHooks` call site. `packages/agent-framework/src/index.ts` needs no new export: the posture type
lives in `agent-core` and its only consumer is `agent-session`, and `config-types.ts` is not
re-exported from that barrel (only `IResolvedConfig`). `background-task-hooks.ts` is _classified_ by
the table, not modified.

### Alternatives Considered

**A. A policy table alone, consulted by `runPreToolHook`.**
_Pro:_ smallest change; satisfies the issue's acceptance criteria as literally written; no new
harness surface.
_Con:_ fifteen of sixteen rows are unreachable, and nothing says so. The table would assert a
posture for events whose results are discarded, and marking one of them `enforcing` later would
change nothing while reading as though it had. This is the "green by a property of the fixture"
shape, in a policy document rather than a test.

**B. Make every event enforcing-capable — convert the `void` and unawaited fire sites to await and
consult `blocked`.**
_Pro:_ the table would then mean what it says at every row, with no reachability caveat.
_Con:_ far outside this leaf. It changes the timing and failure behaviour of eleven call sites across
four packages, several of them deliberately fire-and-forget for reasons `HOOK-CATALOG.md` records
(`PreModelCall`/`PostModelCall`/`PermissionDecision` are informational by SELFHOST-009 design, and
awaiting them would put a hook in the model-call path). It would also make a hook able to veto
compaction and session teardown — product decisions this leaf has no mandate to make.

**C. The table, plus a `reachability` field per row, plus a scan that proves the field honest
(chosen).**
_Pro:_ every row states both what the posture _is_ and whether the fire site can honour it, so the
document cannot quietly assert an inert gate. The scan makes the second half falsifiable: a row
marked `enforcing` whose fire site does not await and read `blocked` fails `pnpm harness:scan`. It
delivers the issue's acceptance criteria at the one event that can enforce, and leaves the other
fifteen honestly labelled rather than silently decorative.
_Con:_ a new scan to maintain, and a table with a field readers must understand. The reachability
field is derived-but-recorded, which is duplication of a sort — mitigated by the scan, which is
precisely what refuses a recorded value that has drifted from the derivation.

**D. Configurable posture in `.robota/settings.json`.**
_Pro:_ operators could opt an event into advisory for their environment, matching Kubernetes'
per-webhook `failurePolicy`.
_Con:_ the issue says "an explicit policy table", not "a configurable one", and the acceptance
criterion "advisory continuation is limited to explicitly listed events" reads as a fixed list. It
would also let an operator turn off a security gate from a settings file, which is a product decision
requiring the owner, and it reaches `agent-framework/src/config/config-types.ts` — a barrel another
lane holds. Deferred rather than rejected: if wanted, it is a sibling under tracker issue #2075 layered on
top of the fixed table, not a replacement for it.

### Decision

**Alternative C.** The issue's stated deliverable is a policy table, and A supplies one — but a table
whose rows cannot be honoured is the exact defect class this tracker keeps producing: a record that
reads as a decision when nothing decided it. The measured baseline (one enforcing event of sixteen)
means A ships a document that is fifteen-sixteenths inert with nothing marking which part is which.

B would make the table fully meaningful and is the right long-term shape, but it changes product
behaviour at eleven call sites and is not this leaf's mandate.

C delivers the acceptance criteria where they can be delivered — `PreToolUse` fails closed on
`error`, timeout, and unknown executor — and makes the remainder honest instead of decorative. The
scan is what turns "we wrote down which events enforce" into something that can be wrong and be
caught.

**Validation of the chosen design** (spec-workflow.md, "Validated Recommendation Before Approval" —
this changes an enforcement boundary):

- **Reachability.** The only consumer that reads `.blocked` is
  `agent-session/src/tool-hook-helpers.ts:69`, enumerated from the tree rather than assumed
  (`git grep -n 'runHooks(' -- 'packages/*/src/**'` excluding tests and the definition: 13 fire sites in 8 files, fields read per file). The
  posture type is declared in `agent-core`, which `agent-session` already depends on, so no
  dependency edge is added.
- **Capability preservation.** Every outcome that blocks today continues to block: `deny` from any
  executor, and an `allow` whose stdout carries `continue: false` / `permissionDecision: "deny"` /
  `decision: "block"`. What is added is `error` blocking on `PreToolUse` only. The advisory events
  keep their current behaviour exactly — this leaf changes no fire site's await/void shape.
- **Adversarial pass.** (a) _A hook that errors on `PreToolUse` now blocks, so a broken hook script
  breaks the user's session._ True and intended — that is the fail-closed posture tracker issue #2075
  chose — but it makes hook misconfiguration a hard stop, so the denial reason must name the `kind`
  and `source` well enough to fix it, which TC-04 pins. (b) _`unknownHookTypes` blocking overlaps
  issue #2099._ It does not: this leaf blocks at RUNTIME on an unknown type at an enforcing event;
  issue #2099 rejects an unreachable executor at STARTUP. Both are wanted and the acceptance criteria
  of each name their own. (c) _The reachability field could be computed instead of recorded._
  Computing it at runtime would need the runner to know its caller, which it must not. Recording it
  with a scan is the trade; the scan is the mitigation. (d) _The scan could pass by parsing nothing._
  It must fail closed on an unresolvable fire site rather than skip the row — the `commitlint`
  range-resolution precedent in `.github/workflows/ci.yml` is the shape to copy, and TC-07 asserts it.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `### Affected Scope`, 3 packages + harness
- [x] Sibling scan 완료 — 16 events; **13** non-test `runHooks` fire sites across **8** firing files (a ninth file, `hooks/hook-runner.ts`, holds the definition rather than a fire site), all enumerated with await/read state
- [x] 대안 최소 2개 검토 완료 — A/B/C/D
- [x] 결정 근거 문서화 완료 — `### Decision` + 검증 4항목

## Fallback & Degradation Declaration

None.

This change removes a degradation rather than adding one: a `PreToolUse` hook that cannot evaluate
currently degrades to "allow", and will fail closed instead. The advisory events keep their present
behaviour, which is declared in the table rather than left implicit — a declared posture is the
opposite of a silent fallback.

The new scan must not carry one either: an unresolvable fire site fails the scan rather than skipping
the row (adversarial pass (d), pinned by TC-07).

## Boundary

This leaf sets the per-event posture and makes `PreToolUse` honour it. It does **not** convert any
advisory fire site into an enforcing one — that is Alternative B, deliberately declined — and it does
not add startup validation of executor reachability, which is issue #2099.

New concerns become siblings under tracker issue #2075, per issue #2079 § Execution rules.

## Solution

### The posture table (`packages/agent-core/src/hooks/enforcement-policy.ts`)

```ts
export type THookEnforcementPosture = 'enforcing' | 'advisory';

export interface IHookEventPolicy {
  readonly posture: THookEnforcementPosture;
  /**
   * Whether the fire site for this event can HONOUR an enforcing posture — it awaits `runHooks`
   * and consults `blocked`. Recorded rather than derived, because the runner must not know its
   * caller; `scan-hook-enforcement-reachable.mjs` is what keeps the record honest.
   */
  readonly enforcementReachable: boolean;
  /** Why this event has this posture. Read by a human deciding whether to change it. */
  readonly rationale: string;
}

export const HOOK_ENFORCEMENT_POLICY: Readonly<Record<THookEvent, IHookEventPolicy>>;
export function isEnforcing(event: THookEvent): boolean;
```

`PreToolUse` is `enforcing` + `enforcementReachable: true`. Every other event is `advisory`, and each
records `enforcementReachable: false` with a rationale naming why its fire site cannot honour
enforcement — `void`, unawaited, or awaited-but-not-consulted.

### The enforcement boundary (`packages/agent-session/src/tool-hook-helpers.ts`)

`runPreToolHook` gains, after the existing `blocked` check:

```ts
if (isEnforcing('PreToolUse') && result.errors?.length) {
  const first = result.errors[0];
  const reason = `Hook could not evaluate (${first.kind}, ${first.source}): ${first.reason}`;
  return toolFailure('hook-blocked', reason, { blocked: true, reason });
}
if (isEnforcing('PreToolUse') && result.unknownHookTypes?.length) { … }
```

The denial reuses the existing `hook-blocked` failure so no new turn-blocking mechanism appears —
the same discipline SELFHOST-005 applied to guardrails.

### The reachability scan (`scripts/harness/scan-hook-enforcement-reachable.mjs`)

For every event whose policy says `enforcing`, resolve its fire site and assert the call is awaited
and its result's `blocked` is read. For every event claiming `enforcementReachable: false`, assert
the opposite. An event whose fire site cannot be resolved **fails** the scan; it is never skipped.

## Affected Files

- `packages/agent-core/src/hooks/enforcement-policy.ts` (new)
- `packages/agent-core/src/hooks/types.ts`
- `packages/agent-core/src/hooks/index.ts`
- `packages/agent-core/src/index.ts`
- `packages/agent-core/docs/SPEC.md`, `packages/agent-core/docs/HOOK-CATALOG.md`
- `packages/agent-session/src/tool-hook-helpers.ts`
- `packages/agent-session/docs/SPEC.md`
- `scripts/harness/scan-hook-enforcement-reachable.mjs` (new), plus its registration in
  `scripts/harness/run-all-scans.mjs`
- Tests: `packages/agent-core/src/hooks/__tests__/enforcement-policy.test.ts` (new),
  `packages/agent-session/src/__tests__/tool-hook-helpers.test.ts`,
  `packages/agent-session/src/__tests__/selfhost-009-pretooluse-gate.test.ts`,
  `scripts/harness/__tests__/hook-enforcement-reachable.test.mjs` (new)

## Completion Criteria

- [ ] TC-01: A `PreToolUse` command hook whose process cannot start returns a blocked
      `IToolResult` — `success: false`, failure kind `hook-blocked` — and the wrapped tool's
      `execute` is never called.
- [ ] TC-02: The same for a hook that exceeds its `timeout`, and for an `http` hook whose body has a
      non-boolean `ok`; both block, where before this leaf both allowed.
- [ ] TC-03: A `PreToolUse` hook whose configured type has no registered executor blocks
      (`unknownHookTypes` non-empty → denial), while the same configuration on `PostToolUse` does not.
- [ ] TC-04: The denial reason names the failure `kind` and the `source` executor — asserted by
      substring for each of `timeout`, `spawn-failure`, `malformed-response`.
- [ ] TC-05: Advisory events are unchanged — for each of the fifteen, a hook returning an `error`
      outcome produces no denial and no thrown error at its fire site.
- [ ] TC-06: `HOOK_ENFORCEMENT_POLICY` has exactly one entry per `THookEvent` member, no more and no
      fewer, asserted against the union rather than a hand-written list.
- [ ] TC-07: `node scripts/harness/scan-hook-enforcement-reachable.mjs` exits 0 on the tree, exits
      non-zero when a policy entry is flipped to `enforcing` at an inert fire site, non-zero when a
      fire site cannot be resolved, and non-zero when the policy contains zero `enforcing` rows —
      a scan that checked nothing must not report clean.
- [ ] TC-08: Every outcome that blocked before this leaf still blocks — `deny` from each of the five
      executors, and an `allow` carrying `continue: false` / `permissionDecision: "deny"`.
- [ ] TC-09: `pnpm build && pnpm typecheck` → exits 0.
- [ ] TC-10: `pnpm harness:scan` → exits 0, with the new scan present in its output.
- [ ] TC-11: The user-execution scenario runs; the denied run's output carries `spawn-failure`,
      `command` and the hook path, the allowed run's carries none of them, and both exit 0.
- [ ] TC-12: A policy entry with `posture: 'enforcing'` and `enforcementReachable: false` is
      rejected — the table-internal invariant, asserted by a unit test over the shipped policy and by
      the scan independently, so neither is the only thing standing between the two fields.

## Test Plan

Type `SECURITY` + tags `typescript`/`async`/`auth` derive: permission-boundary integration tests and
type tests. One row per criterion; references are filled in at GATE-COMPLETE with the delivered test.

| TC-ID | Test Type                     | Tool / Approach                                                                        |
| ----- | ----------------------------- | -------------------------------------------------------------------------------------- |
| TC-01 | Integration (permission path) | vitest — `tool-hook-helpers.test.ts`, real `CommandExecutor`, unusable `cwd`           |
| TC-02 | Integration (permission path) | vitest — same file; short `timeout` + `sleep`, and a local `node:http` server          |
| TC-03 | Integration (permission path) | vitest — a config naming a type with no registered executor, on both events            |
| TC-04 | Unit                          | vitest — substring assertions on the denial reason                                     |
| TC-05 | Integration                   | vitest — table over the fifteen advisory events at their own fire sites                |
| TC-06 | Type/exhaustiveness           | vitest — `Object.keys(HOOK_ENFORCEMENT_POLICY)` against the `THookEvent` union         |
| TC-07 | CI smoke + mutation           | node — run the scan clean, then against two deliberately broken policy fixtures        |
| TC-08 | Integration (permission path) | vitest — the preserved-blocking table from SEC-015, re-run                             |
| TC-09 | Build / typecheck             | `pnpm build && pnpm typecheck`                                                         |
| TC-10 | CI smoke                      | `pnpm harness:scan`                                                                    |
| TC-11 | CLI scenario (replay)         | the real CLI entry driven against `packages/agent-provider-replay` via `--session-log` |
| TC-12 | Unit + CI smoke               | vitest over the shipped policy, plus the scan asserting the same invariant separately  |

## User Execution Test Scenarios

**The surface is the CLI this time, and that is a change from SEC-015 on purpose.** That leaf's
deliverable had no CLI-observable manifestation — it added a field nothing read. This leaf's
deliverable IS the observable: a tool call that used to run now stops, and the user sees the denial.

A `PreToolUse` hook fires only behind a model-issued tool call, which normally needs provider
credentials — but `packages/agent-provider-replay` replays recorded provider responses including tool
calls, and `packages/agent-cli/src/cli.ts:254` wires it behind `--session-log` so a session runs with
"no key is ever used". SEC-015's record wrongly claimed no such path existed; this scenario uses it.

### Scenario 1 — a hook that cannot evaluate stops the tool call

- **Agent-executability:** `agent-executable`.
- **Prerequisites:** a built workspace. No API key, no network egress. A recorded session log
  containing a tool call, shipped with this work as a fixture; a `.robota/settings.json` in a temp
  project declaring a `PreToolUse` command hook whose command does not exist.
- **Exact commands.** Written against the real entry point, not `robota` on `PATH` — `command -v
robota` exits 1 in this repo and `node_modules/.bin/robota` does not exist; the only invocation the
  tree verifies is `process.execPath <repo>/packages/agent-cli/bin/robota.cjs`
  (`packages/agent-cli/src/testing/binary-agent-driver.ts:90-99`). The setup half is written out too,
  because a scenario whose prerequisites are prose is a scenario that has not been shown to run.

  ```bash
  REPO="$(git rev-parse --show-toplevel)"
  CLI="$REPO/packages/agent-cli/bin/robota.cjs"
  FIXTURE="$REPO/packages/agent-cli/src/__tests__/fixtures/sec-016-tool-call.session.jsonl"
  TMP="$(mktemp -d)"; export HOME="$TMP/home"; mkdir -p "$HOME" "$TMP/.robota"

  # A provider profile must exist even for replay: config-loader.ts:187 throws
  # "currentProvider is required" without one. The replay provider overrides it (no key is used).
  cat > "$TMP/.robota/settings.json" <<JSON
  { "currentProvider": "replay",
    "providers": { "replay": { "name": "replay", "model": "replay" } },
    "hooks": { "PreToolUse": [ { "matcher": "",
      "hooks": [ { "type": "command", "command": "/nonexistent/sec-016-hook" } ] } ] } }
  ```

JSON

cd "$TMP"
  node "$CLI" -p "list the files" --output-format stream-json \
--no-session-persistence --session-log "$FIXTURE"; echo "denied-run exit=$?"

# Contrast: same settings MINUS the hooks block, so the provider profile survives. Removing

# .robota entirely would trip "currentProvider is required" and prove nothing about the gate.

cat > "$TMP/.robota/settings.json" <<JSON
  { "currentProvider": "replay",
    "providers": { "replay": { "name": "replay", "model": "replay" } } }
JSON
  node "$CLI" -p "list the files" --output-format stream-json \
--no-session-persistence --session-log "$FIXTURE"; echo "allowed-run exit=$?"
rm -rf "$TMP"

```

- **Expected observable result.** The denied run's `stream-json` output contains a tool result whose
text carries all three of `spawn-failure`, `command`, and `/nonexistent/sec-016-hook` — the failure
kind, the source executor, and the hook that could not evaluate. The allowed run's output contains
none of those and instead shows the tool result the fixture records. Both runs exit `0`: the tool
call is denied, the SESSION is not, and asserting a non-zero exit would be asserting a behaviour
this leaf does not deliver.

The contrast is the observable. One run alone could be explained by the fixture; the pair cannot.

- **Cleanup:** the temp project is removed by the scenario.
- **Evidence:** _(filled after implementation — command output and exit code)_

## Tasks

- [ ] SEC-016 — todo — `.agents/tasks/SEC-016-per-event-hook-enforcement-policy.md`

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-08-23

**Status remains:** draft
**Failed criteria:**

- **Architecture Review Checklist — sibling scan `[x]` with completion evidence**: the recorded
evidence is `16 events, 9 non-test runHooks fire sites, all enumerated with await/read state`.
Enumerated against the tree at `36090e2e6`
(`git grep -n "runHooks(" -- 'packages/**/src/**' ':!*__tests__*' ':!*.test.*'`): there are **13
fire sites** in **8** firing files. `9` is the count of non-test FILES matching `runHooks(`, and
that count only reaches nine by including `packages/agent-core/src/hooks/hook-runner.ts:102`,
which is the DEFINITION of `runHooks`, not a fire site. The `### Decision` > Reachability bullet
states the same figure correctly as "nine non-test files"; the checklist restates it as fire
sites. Required: sibling-scan evidence that states the quantity it actually measured.
**Required action:** correct the checklist line to the measured figures (13 fire sites / 8 firing
files, or 9 files matching `runHooks(` including the definition), then re-run GATE-WRITE.

- **`## Problem` — the measured baseline summary contradicts its own table**: the prose under the
table reads "The other fifteen are advisory _by construction_ — five fire `void`, five are
unawaited, and five await a result they never inspect for `blocked`." Verified by reading all 13
fire sites. By EVENT the split is **7 / 5 / 3**: `void` = `SubagentStart`, `SubagentStop`
(`agent-framework/src/assembly/background-task-hooks.ts:68`), `WorktreeCreate`, `WorktreeRemove`
(`agent-executor/src/subagents/worktree-subagent-runner.ts:256`), `PreModelCall`, `PostModelCall`
(`agent-session/src/session-run.ts:51`), `PermissionDecision`
(`agent-session/src/permission-enforcer.ts:231`) = 7; unawaited = `PostToolUse`, `SessionStart`,
`PostCompact`, `Stop`, `StopFailure` = 5; awaited-but-never-consulting-`blocked` = `SessionEnd`,
`PreCompact`, `UserPromptSubmit` = 3. By FIRE SITE the split is 4 / 5 / 3 (+1 awaited-and-
consulted). Neither reading yields 5/5/5, and the document's own table refutes the sentence.
**Required action:** restate the breakdown as 7 void / 5 unawaited / 3 awaited-but-not-consulted
(or drop the numeric split), then re-run GATE-WRITE.

**Criteria verified as MET (recorded so the re-run need not re-derive them):**

- Frontmatter: opens with `---`; `status: draft`; `type: SECURITY` (in the 11-prefix list); `tags:
[typescript, async, auth]` present.
- `## Problem` — concrete symptom: `packages/agent-session/src/tool-hook-helpers.ts:69` reads
`if (hookResult.blocked)` and nothing else — confirmed verbatim at that line. Reproduction
condition present (non-existent `command` path / unreachable `http` endpoint in
`.robota/settings.json` → tool call proceeds). No "TBD"/"TODO" anywhere in the file.
- `## Problem` — **every row of the baseline table is correct.** Checked file+line, await/void
state and fields read for all 16 `THookEvent` members (union confirmed at
`packages/agent-core/src/hooks/types.ts:15-31`, exactly 16): `PreToolUse`
`tool-hook-helpers.ts:63` await → `.blocked`/`.reason`; `PostToolUse` `:92` unawaited `.catch`;
`SessionStart` `session-lifecycle.ts:67` unawaited `.then(result => result.stdout)`; `SessionEnd`
`session-lifecycle.ts:98` await, result discarded; `PreCompact`
`compaction-orchestrator.ts:126` await, result discarded; `PostCompact`
`session-history-ops.ts:132` unawaited; `UserPromptSubmit` `session-run.ts:136` await, reads
`hookResult.stdout` only (line 155) and never `.blocked` — the specifically flagged row, correct;
`StopFailure` `session-run.ts:238` and `Stop` `:296` unawaited; the four `void` sites as listed.
**The headline "one of sixteen events can block" is TRUE** — `tool-hook-helpers.ts:69` is the only
read of `.blocked` in any non-test fire site. The `### Decision` therefore does NOT rest on a
false premise; both failures above are miscounts in summary prose, not defective rows.
- `## Prior Art Research` — present and substantiated; 3 documentation citations, all fetched and
checked against the live sources at gate time, not accepted as claimed. (a) Claude Code hooks:
the "Exit code 2 behavior per event" table exists and lists `PreToolUse`/`UserPromptSubmit`/
`Stop`/`SubagentStop`/`PreCompact` as `Can block? Yes` and `PostToolUse`/`PostToolUseFailure`/
`Notification`/`SessionStart`/`SessionEnd`/`CwdChanged` as `No`; `PermissionRequest` reads "Exit
code 2 isn't honored ... Deny through the decision object instead" — the doc's paraphrase is
accurate. All three fail-open quotes verified verbatim: "doesn't block the tool call", "lands in
the same non-blocking bucket", "non-blocking error, execution continues" (Connection failure).
(b) Kubernetes: source shows `failurePolicy: 'Fail' # Fail-closed (the default)` and the failure
policy applying to "Network errors, timeouts, or connection failures" — accurate. (c) Envoy:
`failure_mode_allow` "Defaults to false", rejects with `Forbidden`, "Errors can always be tracked
in the stats" — accurate; minor imprecision only, in that
`x-envoy-auth-failure-mode-allowed: true` requires `failure_mode_allow_header_add` to be set as
well, which the section does not mention. Not a criterion failure.
- `## Prior Art Research` feeds Alternatives/Decision: Envoy's make-the-open-case-observable posture
is the stated steer for Alternative C's reachability scan; Kubernetes' per-webhook `failurePolicy`
is the stated basis for Alternative D. Evidence-based, not asserted.
- Architecture Review Checklist: all 4 items are `[x]`. Alternatives Considered has 4 entries
(A/B/C/D), each with Pro and Con. Decision names the driving trade-off (a table whose rows cannot
be honoured vs. eleven call sites this leaf has no mandate to change).
- New-surface placement: **N/A** — no new package, app, presentation or interface surface, and no
layer/product-family reclassification. `enforcement-policy.ts` is a new module inside the existing
`packages/agent-core/src/hooks/` surface; the new scan is a file in the existing
`scripts/harness/` surface. The Affected Scope's negative claims were spot-checked and hold:
`packages/agent-framework/src/interactive/` contains no non-test `runHooks` call site, and
`packages/agent-framework/src/index.ts:704` re-exports only `IResolvedConfig` from
`config/config-types.js`.
- `## Fallback & Degradation Declaration` present, declares `None` with justification.
- `## Completion Criteria`: 11 items, every one carries a `TC-N` prefix (TC-01…TC-11); ≥1 criterion
per sub-item (policy table TC-06, enforcement boundary TC-01/02/03/04/08, scan TC-07, advisory
no-change TC-05, build/scan TC-09/10, scenario TC-11). None uses "works correctly", "no errors",
"implemented" or "displays correctly". TC-11 is the weakest (observable deferred to the scenario
below) but names an observable and a contrast run, so it meets the bar. Supporting facts checked:
`THookErrorKind` includes `timeout`, `spawn-failure`, `malformed-response` (types.ts:180);
`unknownHookTypes` and `errors` exist on `IRunHooksResult`; `hook-blocked` exists
(`permission-types.ts:100`); TC-08's "five executors" is correct — `command`, `guardrail`, `http`
(agent-core) + `agent`, `prompt` (agent-framework).
- `## Test Plan`: present; 11 rows for 11 TC-N (count matches); every row has a non-empty Test Type
and Tool/Approach; no "TBD". No row uses Tool `manual`, so the manual-Notes criterion is **N/A**
— the table carries no Notes column, which is permitted only because nothing triggers it.
- Structure: `## Tasks` present with the placeholder; `## Evidence Log` present and empty before
this entry; no `## Status` or `## Classification` section in the body.
- Ordering check: **exempt** — GATE-WRITE is the entry gate with no prior status gate. Input state
verified anyway: frontmatter `status: draft` and the file sits in `.agents/spec-docs/draft/`.

**Judged, not failing — recorded for the orchestrator:**

- **Alternative C is justified by the measured baseline; it is not leaf inflation.** Independently
confirmed that flipping any of the other fifteen events to `enforcing` would change no behaviour,
because no fire site other than `tool-hook-helpers.ts:69` consults `blocked` — so Alternative A's
table would be unfalsifiable in exactly the direction that matters, and `enforcementReachable` +
the scan is the minimum machinery that makes that detectable. Against issue #2079 § Execution
rules (fetched; text reads "Do not make a leaf absorb a newly discovered concern; create a sibling
under the same tracker"), C absorbs nothing new: it changes no fire site (that is Alternative B,
declined), adds no startup validation (issue #2099, confirmed as "reject configured hook types
without reachable executors"), and defers configurable posture to a sibling under tracker issue #2075.
The scan polices this leaf's own artefact rather than a new concern.
<!-- Author's note: one word ("issue") was inserted before `#2075` in the line above, and nothing
     else in this guardian entry was altered. `reference-kind-qualified` judges the FILE, so an
     unqualified reference anywhere in it fails the scan — including inside a gate's own record. The
     edit is mechanical and changes no finding, no count, and no verdict. Recorded because silently
     editing a guardian's entry is indistinguishable from tampering unless it is declared. -->
- **`## User Execution Test Scenarios` is out of scope for this gate.** GATE-WRITE has no criterion
covering that section — it belongs to DONE-GATE-STAGE-1, which applies to the item under
`.agents/tasks/` that does not yet exist. Scenario 1's deferral therefore does not fail here.
Flagged for the later gate: DONE-GATE-STAGE-1 requires "exact commands", and `-p` and
`--session-log` already compose today at
`packages/agent-cli/src/testing/binary-agent-driver.ts:93,98`, so the flag surface is
determinable now rather than "during implementation". The scenario's premise is otherwise sound —
`packages/agent-provider-replay` exists, `--session-log` is wired at
`packages/agent-cli/src/cli.ts:254-263` via `loadReplayProvider`, and
`.agents/spec-docs/done/SEC-015-hook-outcome-contract.md:540-553` corroborates the claim that
SEC-015's record was wrong about no such path existing.
- Issue #2083 is still `OPEN` on GitHub although PR #2193 is `MERGED` (2026-08-23) and the
`errors` field is present in the tree. Bookkeeping only; not a GATE-WRITE criterion.

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready

Second run. The two criteria that failed on 2026-08-23 (first run, entry above) were re-checked
against the tree at `36090e2e6`, not against the author's report of the fix; every other criterion was
re-applied rather than carried over.

**Integrity of the prior entry (checked before anything else).** The author declared editing the
guardian record above. Verified by reconstructing the entry as originally appended and diffing it
against the file: the ONLY differences are the single word `issue` inserted before `#2075` on one
line, and the HTML comment declaring that edit. No finding, count, criterion result, required action
or verdict was altered. The declaration is accurate and the edit is mechanically necessary —
`reference-kind-qualified` judges the whole file, so an unqualified reference inside a gate's own
record fails the scan for the document.

**Previously failed criteria — now met:**

- **`## Problem` baseline summary.** Now reads "the split by event is **7 / 5 / 3**" and names every
event in each group. Checked member by member against the tree: `void` = `SubagentStart`,
`SubagentStop`, `WorktreeCreate`, `WorktreeRemove`, `PreModelCall`, `PostModelCall`,
`PermissionDecision` (7); called without `await` = `PostToolUse`, `SessionStart`, `PostCompact`,
`Stop`, `StopFailure` (5); awaited but never inspected for `blocked` = `SessionEnd`, `PreCompact`,
`UserPromptSubmit` (3). Each matches the fire site read in the first run. The stated arithmetic
`7 + 5 + 3 + PreToolUse = 16` is correct and matches the 16-member `THookEvent` union at
`packages/agent-core/src/hooks/types.ts:15-31`. The sentence now agrees with the table above it.
- **Architecture Review Checklist sibling-scan evidence.** Now reads "16 events; **13** non-test
`runHooks` fire sites across **8** firing files (a ninth file, `hooks/hook-runner.ts`, holds the
definition rather than a fire site)". Re-measured: 13 fire sites, 8 distinct files, and
`hook-runner.ts:102` is the definition. All three figures correct, and the file/site distinction
that caused the original miscount is now stated rather than elided.
- **The `### Decision` > Reachability bullet now cites a command that reproduces.** It quotes
`git grep -n 'runHooks(' -- 'packages/*/src/**'` excluding tests and the definition → "13 fire
sites in 8 files". Executed that exact pathspec: 56 raw matches, 13 after excluding tests and the
definition, across 8 files. The cited command reproduces the cited figures.

**Every other criterion, re-applied:**

- Frontmatter: `---` block present; `status: draft`; `type: SECURITY` (in the 11-prefix list);
`tags: [typescript, async, auth]`.
- `## Problem`: concrete symptom (`tool-hook-helpers.ts:69` reads `if (hookResult.blocked)` and
nothing else) and reproduction condition (non-existent `command` path or unreachable `http`
endpoint in `.robota/settings.json` → the tool call proceeds). No "TBD"/"TODO" anywhere in the
document body. All 16 baseline table rows re-confirmed correct in the first run and unchanged
here, including `UserPromptSubmit` at `session-run.ts:136` (awaits; reads `.stdout` only).
- `## Prior Art Research`: present, substantiated, 3 documentation citations, all fetched and
compared against the live sources. The Envoy imprecision flagged in the first run is corrected —
the section now states that `x-envoy-auth-failure-mode-allowed: true` requires
`failure_mode_allow_header_add` in addition to `failure_mode_allow`, which matches the proto
documentation ("When failure_mode_allow and failure_mode_allow_header_add are both set to true").
The Claude Code per-event exit-2 table and the Kubernetes `failurePolicy: 'Fail'` default were
verified verbatim in the first run and the text is unchanged.
- Research feeds Alternatives/Decision: Envoy's observable-fail-open posture is the stated steer for
Alternative C's reachability scan; Kubernetes' per-webhook `failurePolicy` is the stated basis for
Alternative D. Evidence-based, not asserted.
- Architecture Review Checklist: 4/4 `[x]`. Alternatives Considered has 4 entries (A/B/C/D) each with
Pro and Con. Decision names the driving trade-off — a table whose rows cannot be honoured, versus
eleven call sites this leaf has no mandate to change.
- New-surface placement: **N/A** — no new package, app, presentation or interface surface and no
layer/product-family reclassification. `enforcement-policy.ts` is a new module inside the existing
`packages/agent-core/src/hooks/` surface; the new scan is a file in the existing `scripts/harness/`
surface.
- `## Fallback & Degradation Declaration`: present, `None`, with justification.
- `## Completion Criteria`: 11 items, every one `TC-N` prefixed (TC-01…TC-11), ≥1 per sub-item, none
using "works correctly" / "no errors" / "implemented" / "displays correctly". TC-11 is no longer
the weakest item — the scenario it points at now carries a concrete command.
- `## Test Plan`: 11 rows for 11 TC-N (count matches); every row has a non-empty Test Type and
Tool/Approach; no "TBD"; no row uses Tool `manual`, so the manual-Notes criterion is **N/A**.
- Structure: `## Tasks` present with the pre-GATE-IMPLEMENT placeholder; no `## Status` or
`## Classification` section in the body. `## Evidence Log` present and carrying exactly the prior
FAIL entry — the "empty" clause of that criterion is scoped to the first GATE-WRITE run, and a
retained prior verdict is the required state for a second one, not a violation.
- Ordering check: **exempt** — GATE-WRITE is the entry gate with no prior status gate. Input state
verified regardless: frontmatter `status: draft`, file under `.agents/spec-docs/draft/`.
- Mechanical checks re-run rather than accepted from the author's report:
`scan-reference-kind-qualified.mjs` exit 0 (3018 documents), `check-spec-doc-frontmatter.mjs` on
this file exit 0, `scan-spec-research.mjs` exit 0 (17 spec documents).

**Out of scope for this gate, recorded for the next one.** `## User Execution Test Scenarios` has no
GATE-WRITE criterion — it is judged by DONE-GATE-STAGE-1 against the item under `.agents/tasks/`,
which does not exist yet. Noted because the first run flagged its deferral and the author closed it
without being required to: Scenario 1 now carries a concrete command block. The four flags it uses
were verified to exist — `-p`, `--output-format`, `--no-session-persistence` and `--session-log` are
all declared in `packages/agent-cli/src/utils/cli-args.ts:184-203` and composed together today at
`packages/agent-cli/src/testing/binary-agent-driver.ts:90-99`. This did not affect the verdict either
way.

The three judgements recorded in the first run (Alternative C is justified by the measured baseline
and does not inflate the leaf under issue #2079 § Execution rules; the scenario section's premise is
sound; issue #2083 remains OPEN on GitHub though PR #2193 is merged) stand unchanged and were not
re-derived.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

**Ordering check (run before any criterion).** Prior gate per the gate catalogue's prior-gate map is
GATE-WRITE, expected input state `review-ready` / `.agents/spec-docs/backlog/`. Both hold: the
`## Evidence Log` above carries `[GATE-WRITE] — ✅ PASS | 2026-08-23` (the second run, following a
recorded FAIL — a FAIL then PASS on the same gate is a re-run, not a bypass, and the FAIL entry is
retained rather than overwritten). Frontmatter reads `status: review-ready` and the file sits in
`.agents/spec-docs/backlog/`, which is the folder `spec-workflow.md` > Spec-Document Status and
Lifecycle Folders maps `review-ready` to. Ordering satisfied.

**Criterion 1 — explicit user approval in the current conversation: MET.** Verbatim, dated
2026-08-23:

> Approved — implement SEC-016 as specified. I confirm the SEC-016 design: the per-event posture
> table, the enforcementReachable field, the new reachability scan, and making PreToolUse fail closed
> on error/timeout/unknown-executor — accepting that a broken hook script now hard-stops tool calls.
> Proceed to implementation.

**Criterion 2 — direct, unambiguous, and directed at THIS spec document: MET, and judged against the
excluded case rather than waved past.** The approval was a selection from a three-option prompt, so
the catalogue's exclusion ("answering a clarifying question ... _without confirming the design_") was
applied deliberately. It does not catch this statement, for four reasons checked one at a time:
(a) it names the item — `SEC-016`, twice — so it cannot be the excluded "approval of a different item
in the same conversation"; (b) it enumerates all four deliverables of this document's `### Decision`
(Alternative C), and each maps to a real artefact in the spec — the posture table
(`## Solution` > enforcement-policy.ts), the `enforcementReachable` field
(`IHookEventPolicy.enforcementReachable`), the scan
(`scripts/harness/scan-hook-enforcement-reachable.mjs`), and `PreToolUse` failing closed on
`error`/timeout/unknown-executor (TC-01/02/03); (c) it restates and accepts the consequence, "a broken
hook script now hard-stops tool calls", which is the adversarial-pass finding (a) the document itself
records — an approval that reproduces the design's own worst-case is confirming the design, not
acknowledging a question; (d) it authorizes implementation explicitly ("Proceed to implementation").
The rejected options were materially different and included a genuine non-approval (hold pending the
user's own read) and a genuine reduced scope (Alternative A, table-only), so the menu presented a
decision rather than a single path dressed as one.

**What would have failed criterion 2, recorded so the bar is legible.** A quoted approval consisting
of the bare selector alone ("1", "the first one", "ㅇㅇ") with no design content carried in the quoted
text — that is precisely the excluded case, and no amount of surrounding option text would repair it,
because the catalogue requires the *user's statement* to be the thing that confirms the design.
Equally failing: option text that said only "approve as specified" without naming SEC-016 or its
deliverables (ambiguous as to which item, and confirms nothing); or an approval that omitted the
fail-closed trade-off, since this spec's one owner-visible judgement call is that a broken hook script
becomes a hard stop, and an approval silent on it would not be approval of THIS design.

**Provenance limit, stated rather than glossed.** The conversation is not a repository artefact, so
the quoted text and its date are attested by the dispatching orchestrator and are not independently
re-derivable by this guardian from the tree. What was verifiable was verified: every design element
the quote names exists in this document at the location cited above, and the accepted consequence
matches the document's own adversarial-pass finding — so the approval is at minimum internally
consistent with the artefact it approves. It is not a claim that could have been checked and was not.

**Criterion 3 — no Architecture Review or frontmatter `type`/`tags` modified after approval: MET,
verified against a fixed point rather than accepted as reported.** The file is untracked
(`git status` → `?? .agents/spec-docs/backlog/SEC-016-per-event-hook-enforcement-policy.md`), so git
history is unavailable; the GATE-WRITE run-2 PASS entry was used as the anchor instead, because it
quotes the exact strings this criterion protects. Frontmatter now reads `type: SECURITY` and
`tags: [typescript, async, auth]` — byte-identical to what that entry recorded. The Architecture
Review checklist line now reads "16 events; **13** non-test `runHooks` fire sites across **8** firing
files (a ninth file, `hooks/hook-runner.ts`, holds the definition rather than a fire site)" —
byte-identical to the string quoted in the GATE-WRITE run-2 entry. The `### Decision`,
`### Alternatives Considered` (A/B/C/D) and the four validation bullets are present and consistent
with that entry's description. The one frontmatter field that did change, `status: draft →
review-ready`, is neither `type` nor `tags` and is GATE-WRITE's authorized transition output, paired
with the `draft/ → backlog/` move the status↔folder mapping requires. Criterion untriggered.

**Criterion 4 — independent architecture validation (conditional): N/A, re-derived from the tree
rather than inherited from GATE-WRITE's parallel finding.** The conditional fires only IF the spec
introduces a new package / app / surface or reclassifies a layer / product-family boundary. Neither
limb fires:

- _New package / app / surface._ `common-mistakes.md` row 78 glosses the repo's own term as "a NEW
surface (package/app/UI)". No package or app is created. `packages/agent-core/src/hooks/
enforcement-policy.ts` is a seventh module inside an existing, populated directory whose siblings
are `hook-runner.ts`, `hook-matching.ts`, `types.ts`, `response-protocol.ts`, `verdict-decoder.ts`
and `executors/`, exported through the directory's existing `index.ts` barrel — it joins a surface,
it does not create one. `scripts/harness/scan-hook-enforcement-reachable.mjs` is a 104th
`scan-*.mjs` (103 exist today) registered as one more row in the existing `run-all-scans.mjs` table,
alongside structurally identical peers including `scan-hook-catalog.mjs`,
`scan-hook-registration.mjs` and `scan-hook-syntax.mjs`. No UI or interface surface is added.
- _Reclassifies a layer / product-family boundary._ The rule's parenthetical — "a new module that
could plausibly live in more than one place, or that consumes or extends an existing product" — was
tested, not assumed. `enforcement-policy.ts` is a `Readonly<Record<THookEvent, IHookEventPolicy>>`,
and `THookEvent` is defined at `packages/agent-core/src/hooks/types.ts:15-31` and exported from
`packages/agent-core/src/hooks/index.ts`; a table that exhausts a union is placed by ownership of
that union, so there is no second plausible home — siting it in `agent-session` would put a table
keyed by an `agent-core` type outside the package that owns the type. Its consumer relationship
adds no edge: `packages/agent-session/package.json` already declares
`"@robota-sdk/agent-core": "workspace:*"`. The scan consumes no product and depends on no package.
No dependency direction changes, no package composition changes, no layer is reassigned.

Because neither limb fires, no `proposal-reviewer` ENDORSE and no `architecture-audit-fanout`
structure-channel result is required, and their absence from this Evidence Log is not a gap. Had
either limb fired, this entry would be a NON-COMPLIANCE, since no such verdict is recorded.

**NON-COMPLIANCE trigger — implementation work started before this gate: NOT triggered.** Checked at
`36090e2e6` (`git log 36090e2e6..HEAD` is empty — no commits since the stated base). `git status
--porcelain` shows exactly three entries: the two auto-generated lessons files
(`.agents/evals/lessons/auto-lessons.md`, `weekly-digest.md`), whose `git diff` is a regeneration of
metric windows and frequency counts by `harness:lessons:digest` and contains no SEC-016 content; and
this untracked spec document. Staged diff is empty. Both files this spec creates are absent:
`scripts/harness/scan-hook-enforcement-reachable.mjs` and
`packages/agent-core/src/hooks/enforcement-policy.ts` do not exist. No symbol this spec introduces
appears anywhere outside `.agents/spec-docs/` (`git grep` for `HOOK_ENFORCEMENT_POLICY`,
`enforcementReachable`, `THookEnforcementPosture` → no non-spec hits). The enforcement boundary is
untouched: `packages/agent-session/src/tool-hook-helpers.ts` still reads `if (hookResult.blocked)` and
returns `null` with no `errors` or `unknownHookTypes` branch — the exact defect
`## Problem` describes. `.agents/tasks/SEC-016-*.md` does not exist, which is correct at this gate:
creating it is GATE-IMPLEMENT's criterion, and creating it during GATE-APPROVAL is the violation
recorded against the SEC-015 item.

**Verdict:** PASS. All four criteria answered — three met, one N/A with its derivation recorded — and
the NON-COMPLIANCE trigger checked against the working tree and found clear.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-23

**Status upgrade:** approved → in-progress

**Ordering check (run before any criterion).** Prior gate per the catalogue's prior-gate map is
GATE-APPROVAL, expected input state `approved`. Both hold: the `## Evidence Log` above carries
`[GATE-APPROVAL] — ✅ PASS | 2026-08-23`, and frontmatter reads `status: approved` with the file at
`.agents/spec-docs/todo/`, which is the folder `spec-workflow.md` > Spec-Document Status and Lifecycle
Folders maps `approved` to. Re-derived mechanically rather than eyeballed:
`scan-doc-folder-status-agreement.mjs` → `violations=0 result=PASS` over 7 statuses. Ordering satisfied.

**NON-COMPLIANCE trigger — implementation commits exist but no tasks file: NOT triggered, and neither
limb holds.** At `36090e2e6` (`git rev-parse HEAD` = `36090e2e6f34…`, `git log 36090e2e6..HEAD` empty),
`git status --porcelain` shows exactly four entries: the two auto-generated lessons files
(`.agents/evals/lessons/auto-lessons.md`, `weekly-digest.md`, `git diff --stat` = 12 insertions /
11 deletions, metric-window regeneration only), the untracked spec document, and the untracked tasks
file. Staged diff empty. Both files this spec creates are absent —
`packages/agent-core/src/hooks/enforcement-policy.ts` and
`scripts/harness/scan-hook-enforcement-reachable.mjs` (`ls` → No such file or directory for each).
`git grep` for `HOOK_ENFORCEMENT_POLICY`, `enforcementReachable`, `THookEnforcementPosture` returns no
hits anywhere in the tree. `packages/agent-session/src/tool-hook-helpers.ts:69` still reads
`if (hookResult.blocked)` and returns `null` with no `errors` / `unknownHookTypes` branch — the exact
defect `## Problem` describes, unmodified.

**Criterion 1 — `.agents/tasks/<ID>.md` created: MET.**
`.agents/tasks/SEC-016-per-event-hook-enforcement-policy.md` exists (untracked, 1 file).
`check-backlog-placement.mjs` → `backlog-placement scan passed`, exit 0, so its `status: todo`
frontmatter agrees with its location.

**Criterion 2 — tasks file path recorded in the spec's `## Tasks` section: MET.** The section reads
`- [ ] SEC-016 — todo — .agents/tasks/SEC-016-per-event-hook-enforcement-policy.md`. The path is exact
and resolves; it is not a directory or a pattern.

**Criterion 3 — tasks correspond to the Completion Criteria: MET, checked per-TC by content rather
than by count.** 11 criteria and 11 `## Plan` items; each item carries its `TC-N` id and restates that
criterion's substance, with no shuffle:
TC-01 process-cannot-start blocks + wrapped `execute` never called ✔;
TC-02 timeout and non-boolean `ok` both block where both previously allowed ✔;
TC-03 unknown hook type blocks on `PreToolUse`, does not on `PostToolUse` ✔;
TC-04 denial reason names `kind` and `source` ✔;
TC-05 the fifteen advisory events unchanged ✔;
TC-06 one entry per `THookEvent` member, asserted against the union ✔;
TC-07 scan exits 0 clean / non-zero on a dishonest row / non-zero on an unresolvable fire site ✔
(all three arms carried, not just the first);
TC-08 everything that blocked before still blocks ✔;
TC-09 `pnpm build && pnpm typecheck` ✔; TC-10 `pnpm harness:scan` with the new scan in its output ✔;
TC-11 the user-execution scenario runs and prints its expected lines ✔.
Three items are strict abridgements of their criterion — TC-01 omits `success: false` / `hook-blocked`,
TC-04 omits the three named kinds (`timeout`, `spawn-failure`, `malformed-response`), TC-08 omits "each
of the five executors" and the two `allow` carriers (`continue: false` / `permissionDecision: "deny"`).
That is correspondence, not divergence — the task states "One item per Completion Criterion in the
paired spec" and names this document the owner — but recorded because at GATE-COMPLETE the SPEC's text
is the standard, and TC-08's abridged line in particular could be reported satisfied by a narrower test
than the criterion demands.

**Criterion 4 — tasks file carries a `## Test Plan` / `## Testing` / `## 검증` section ≥50 chars: MET.**
`## Test Plan` present, 673 characters of body — five named commands
(`vitest run src/hooks`, `vitest run` on `agent-session`, the scan clean plus its two-fixture test,
`pnpm build && pnpm typecheck`, `pnpm harness:scan`), each mapped to the TC-N it discharges.
Recorded as an accuracy note, not a criterion failure: the catalogue's stated reason for this criterion
("the `test-plans` harness scan requires development docs to carry one, else `harness:scan` fails") is
stale. `scan-test-plan.mjs` was rescoped by HARNESS-052 and its own header states it no longer gates
`.agents/tasks`; the run here reports `8 live (.agents/spec-docs/backlog, todo, active), 26 archived
(docs/superpowers/…)`, exit 0. The criterion is met on its own terms regardless of the rationale.

**Judged rather than accepted — the task's `## The mutant this must kill`.**
_First half — VERIFIED, not merely plausible._ The claim is that flipping an advisory event's `posture`
to `enforcing` while leaving its fire site alone changes no behaviour, so no behavioural test goes red.
Re-enumerated from the tree at `36090e2e6`, not inherited from the GATE-WRITE entries:
`git grep -n "runHooks(" -- 'packages/*/src/**' ':!*__tests__*' ':!*.test.*'` minus the definition in
`hooks/hook-runner.ts` → 13 fire sites; `git grep -n "\.blocked"` over the same pathspec returns
exactly two hits, of which `agent-framework/src/interactive/interactive-session.ts:971` is
`orgPolicy?.blockedCommands` (unrelated), leaving `agent-session/src/tool-hook-helpers.ts:69` as the
only read of a `runHooks` result's `blocked` in the tree. Against this document's `## Solution`, the
sole consumer of `isEnforcing` is `runPreToolHook`, with the event hardcoded as `'PreToolUse'` — so a
flipped posture on any other event reaches no branch. Criterion by criterion: TC-01/02/03/04/08 all
drive `PreToolUse`; TC-06 asserts only cardinality against the union, never a posture value; and TC-05
is a NEGATIVE assertion ("no denial, no thrown error"), which the mutant satisfies rather than violates.
So no criterion in this document catches it. The section is not overstating.
_The one qualification, recorded so the claim is not stronger than what was checked._ (a) The finding is
contingent on the placement this document specifies. Were the check instead centralised inside
`runHooks` in `agent-core`, a flipped posture WOULD alter behaviour at every fire site and TC-05 would
become the behavioural catcher — the reasoning holds for the design as written, and would need
re-deriving if implementation relocates the check. (b) In its strictly narrowest form — `posture` flipped
while `enforcementReachable` is left `false` — the mutant is also killed by a table-internal invariant
(`posture === 'enforcing' ⇒ enforcementReachable`), which is a unit assertion needing no scan and which
no TC currently states. TC-07's UNIQUE load is therefore the wider mutant where both fields are flipped
together to keep the row self-consistent; only something that reads the tree catches that. TC-07 is
load-bearing, but for the second mutant rather than the first.
_Second half — VERIFIED against the cited precedent, treated as a claim per the SEC-015 partial-mutation
history._ The claim that an unresolvable fire site must fail rather than be skipped, and that
`.github/workflows/ci.yml`'s `commitlint` range resolution is the shape to copy with a comment recording
a measured green-over-nothing, is accurate. Read at `.github/workflows/ci.yml:783-807`: the INFRA-058
comment states "`set -e` does NOT fire on a command substitution used as a word-list … MEASURED by
extracting this step verbatim and running it with an unresolvable head sha: two `fatal: Invalid revision
range` lines, `Linting  commit(s)`, and exit 0 — this REQUIRED check reporting green having linted
nothing." The step then fails closed on BOTH arms. That second arm is where the task copies less than
the precedent offers: `commitlint` also fails on a range that RESOLVES but is empty, and TC-07's three
arms have no analogue — a scan that parses the policy successfully but finds zero `enforcing` rows would
exit 0 having checked nothing. Not a GATE-IMPLEMENT criterion failure; flagged for implementation and
for GATE-COMPLETE.

**Judged rather than accepted — whether Scenario 1's commands are now genuinely exact.** Materially
improved and no longer "finalised during implementation": all four flags were verified to exist at
`packages/agent-cli/src/utils/cli-args.ts` (`output-format`, `no-session-persistence`, `session-log` in
the parse table; `-p` short form) and to compose together today at
`packages/agent-cli/src/testing/binary-agent-driver.ts:90-99`; `--session-log` does wire
`loadReplayProvider` at `packages/agent-cli/src/cli.ts:263`; and the premise that replay can drive a
TOOL CALL — not merely a text reply — is supported by `packages/agent-provider-replay/docs/SPEC.md`
> Test Strategy, which names "tool-call turn then completion (TC-04)". The two-run contrast is written
out with `echo "exit=$?"` after each run. But it is not yet runnable as written, on three checked
points: (1) `robota` is not an invocable name — `command -v robota` exits 1 and
`node_modules/.bin/robota` does not exist; the bin is declared only by
`packages/agent-cli/package.json` as `./bin/robota.cjs`, and the one verified invocation in the tree
spawns `process.execPath <repo>/packages/agent-cli/bin/robota.cjs`. From a `$TMP` outside the
workspace the command as written is `command not found`. (2) `$TMP` and `$FIXTURE` are never assigned
and no command creates the `.robota/settings.json` carrying the failing hook — the setup half, which is
what determines whether the gate fires at all, is still prose beside the block. (3) The control run
`rm -rf "$TMP/.robota"` removes the whole project settings directory, which is also where a project-level
`currentProvider` / `providers` would live; `packages/agent-framework/src/config/config-loader.ts:187`
throws `currentProvider is required` without one, so the control run's outcome depends on ambient
`~/.robota` state that the prerequisites declare absent ("No API key"). The reference e2e
`packages/agent-cli/src/__tests__/e2e/cross-fidelity.bintest.ts` writes a dummy provider profile into a
temp `HOME` for exactly this reason; the scenario does not. Also unpinned: the expected observable names
no exact line or exit code, while TC-11 asserts the scenario "prints its expected lines". **This changes
no GATE-IMPLEMENT verdict** — no criterion of this gate covers `## User Execution Test Scenarios`, which
DONE-GATE-STAGE-1 owns against the item under `.agents/tasks/`. Recorded so that gate need not
re-derive it.

**Verdict:** PASS. All four criteria answered and met; the NON-COMPLIANCE trigger was checked against
the working tree and both of its limbs found clear. The deciding evidence is criterion 3 — 11 plan
items matched per-TC to 11 Completion Criteria by content, with the three abridgements named rather
than glossed.
```
