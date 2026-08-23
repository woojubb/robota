---
status: verifying
type: SECURITY
tags: [typescript, json-schema, async, auth]
---

# SEC-015: Decoded allow / deny / error outcomes for hook execution

Registered as GitHub issue #2083 (leaf of tracker issue #2075).

## Problem

A hook executor reports its result as `IHookResult { exitCode, stdout, stderr }` — a channel with
room for a verdict and no room for "I could not reach one". Failures are therefore forced into a
verdict, and which verdict they land on is an accident of JavaScript coercion.

Concrete symptoms, each measured against the code at `origin/develop@73dff3344` rather than read off
it (transcripts in `### Measured baseline` below):

1. **A malformed HTTP body is coerced to a verdict — in whichever direction its truthiness falls.**
   `HttpExecutor` bare-casts the response body to `{ ok: boolean; reason?: string }` and branches on
   `!body.ok` (`packages/agent-core/src/hooks/executors/http-executor.ts:57-67`). `ok` is never
   checked for being a boolean, so:

   | Response body     | `exitCode` | Engine reads it as                        |
   | ----------------- | ---------- | ----------------------------------------- |
   | `{"ok": "false"}` | `0`        | **allow** — the endpoint said block       |
   | `{"ok": 1}`       | `0`        | **allow**                                 |
   | `{"ok": null}`    | `2`        | **deny**, reason `"Blocked by HTTP hook"` |
   | `{}`              | `2`        | **deny**, reason `"Blocked by HTTP hook"` |
   | `"not an object"` | `2`        | **deny**, reason `"Blocked by HTTP hook"` |

   Both directions are defects, and the second is the one that is easy to miss. A truthy non-boolean
   silently **disables** the gate. A falsy or absent `ok` — which is what a misconfigured endpoint,
   an HTML error page parsed as JSON, or a schema change actually produces — silently **blocks the
   user's tool call** and attributes the block to a hook that never rendered a verdict. Neither is a
   decision anyone made.

2. **A failure is not distinguishable from a verdict, because the runner flattens the codes.** The
   executors do preserve a little detail — a missing binary surfaces as the shell's `127`, a timeout
   and a signal-kill both arrive as `1` (`command-executor.ts:52-76`) — but `runHooks` discards it at
   `if (result.exitCode !== 0) continue;` (`hook-runner.ts:180`). `127`, `1`, an HTTP `503`
   (`http-executor.ts:49-55`), a refused connection (`http-executor.ts:68-71`), and a prompt hook
   whose model returned unparseable text (`prompt-executor.ts:68-74`) are all the same event to the
   caller: the loop moves on. An enforcement gate that _passed_ and one that never _ran_ are the same
   observation.

3. **The caller has nothing to enforce on.** `IRunHooksResult` exposes `blocked`, `reason`, `stdout`,
   `updatedInput`, `permissionDecision`, and `unknownHookTypes`. There is no field in which a failed
   evaluation appears at all, so `tool-hook-helpers.ts:69` (`if (hookResult.blocked)`) cannot
   distinguish "no hook objected" from "no hook was able to answer" — which is precisely the
   distinction issue #2093 needs in order to fail closed.

**Reproduction condition.** Configure an enforcing `PreToolUse` hook in `.robota/settings.json` and
make it fail rather than decide. Point an `http` hook at an endpoint answering `{"ok": "false"}` and
the tool runs with the gate inert; point it at one answering `{}` and the tool is blocked by a
verdict no endpoint issued. Point a `command` hook at a path that does not exist and the tool runs,
with nothing anywhere reporting that the gate did not execute.

This document covers the **contract only**. Deciding that an `error` must block on an enforcing event
is issue #2093 and is explicitly out of scope here (see `## Boundary`).

### Measured baseline

Both probes drive the shipped executors on `origin/develop@73dff3344` through their public API. They
are repro probes, not tests — script home is `scratch/src/` per backlog-execution.md, and they are
not committed. The behavior they record is what TC-01 through TC-04 must change.

`scratch/src/sec-015-repro.ts` — `HttpExecutor` against a local `node:http` server:

```
body={"ok": "false"}    exitCode=0 -> ALLOW
body={"ok": null}       exitCode=2 -> DENY
body={}                 exitCode=2 -> DENY
body={"ok": 1}          exitCode=0 -> ALLOW
body="not an object"    exitCode=2 -> DENY
```

`scratch/src/sec-015-repro-cmd.ts` — `CommandExecutor`:

```
exit 0                   exitCode=0    stderr=""
exit 2 + stderr          exitCode=2    stderr="blocked-reason"
exit 1                   exitCode=1    stderr=""
exit 127 (no binary)     exitCode=127  stderr="zsh:1: command not found: definitely-not"
timeout (sleep 3, t=1)   exitCode=1    stderr="Hook timed out"
killed by signal         exitCode=1    stderr=""
```

Two things in the second transcript corrected an earlier draft of this document, and both changed a
completion criterion. A missing binary does **not** collapse to `exitCode: 1` — the shell reports
`127`, so the flattening that matters happens in `runHooks`, not in the executor (symptom 2), and the
`spawn-failure` mapping needs a different probe than "run a command that does not exist" (TC-03).

A third probe, `scratch/src/sec-015-probe-abort.mjs`, checks that the HTTP mapping table's three
failure rows are actually separable at runtime — without that, TC-04 is unimplementable as written:

```
timeout   -> name=TimeoutError constructor=DOMException msg="The operation was aborted due to timeout"
refused   -> name=TypeError    constructor=TypeError    cause=ECONNREFUSED
bad json  -> name=SyntaxError  constructor=SyntaxError
```

So `timeout`, `transport-failure`, and `malformed-response` are distinguishable by `err.name` plus
the `response.json()` call site, with no dependence on message text.

## Prior Art Research

Three comparable systems document what an enforcement hook does when it cannot produce a verdict.

**Kubernetes admission webhooks** — the closest structural analog: an external, user-configured
callout that can veto an action. `failurePolicy` takes exactly `Fail` or `Ignore`, and **`Fail` is
the default**; a webhook call that times out is "handled according to the webhook's failure policy."
The posture is chosen per webhook, declared in configuration, and defaults to closed.
<https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/>

**Envoy `ext_authz`** — an external authorization filter in the request path. `failure_mode_allow`
defaults to **`false`**: when communication with the authorization service fails or it returns 5xx,
the filter _rejects_ the request with `Forbidden`. Opting into fail-open is explicit, and when it is
taken, Envoy adds `x-envoy-auth-failure-mode-allowed: true` to the request so a downstream consumer
can see the gate was skipped, plus counters in stats. Prior art for both halves of this issue: an
explicit outcome, _and_ diagnostic metadata that survives the decision.
<https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/filters/http/ext_authz/v3/ext_authz.proto>

**Claude Code hooks** — the model Robota's hook engine is deliberately compatible with (event names,
exit-code 2, `continue: false`, `hookSpecificOutput.permissionDecision`). It is documented as
**fail-open by design**: an exit-0 response that fails schema validation "is a non-blocking error:
the action proceeds"; a timed-out hook "doesn't block the tool call"; a hook that cannot start
"lands in the same non-blocking bucket"; an HTTP connection failure is a "non-blocking error,
execution continues". Malformed JSON is downgraded to plain text rather than treated as a failure.
<https://code.claude.com/docs/en/hooks>

**Observed common behavior.** All three separate _the verdict_ from _the failure to reach one_, and
all three treat the failure as a first-class, named condition with its own configured policy — none
of them folds it into the allow verdict. Where they differ is only the default: the two systems whose
hooks are security boundaries (admission control, external authz) default closed and make fail-open
opt-in and observable; the developer-tooling system defaults open.

**The constraint that applies to Robota.** Robota's engine is _described_ as fail-open like Claude
Code, but it does not actually implement a posture at all — it has no channel in which a failure can
be represented, so there is no place to write a policy even if one were wanted. Worse, what it does
instead is something none of the three references does: it **coerces a malformed response into a
verdict**, allowing on a truthy `ok` and denying on a falsy one. A system that fails open is making a
choice; a system that reads `{}` as a denial is not failing open, it is guessing. Tracker issue #2075 has
already decided Robota moves to the admission-control posture.
This leaf supplies what that decision needs and what all three references have: an outcome that names
the failure and carries its diagnostics. It deliberately does **not** pick the default; issue #2093 does,
which is the same order Kubernetes and Envoy separate them in — the outcome vocabulary is part of the
protocol, the policy is per-event configuration.

## Architecture Review

### Affected Scope

| Package                    | File                                                          | Change                                                   |
| -------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/agent-core`      | `src/hooks/types.ts`                                          | Add `THookOutcome` union; delete `IHookResult`           |
| `packages/agent-core`      | `src/hooks/hook-runner.ts`                                    | Switch on outcome; collect errors into `IRunHooksResult` |
| `packages/agent-core`      | `src/hooks/executors/command-executor.ts`                     | Exit/timeout/spawn mapping                               |
| `packages/agent-core`      | `src/hooks/executors/http-executor.ts`                        | Strict response decoder                                  |
| `packages/agent-core`      | `src/hooks/executors/guardrail-executor.ts`                   | Return outcomes (verdicts unchanged)                     |
| `packages/agent-core`      | `src/hooks/index.ts`, `src/index.ts`                          | Export the new types, drop `IHookResult`                 |
| `packages/agent-core`      | `docs/SPEC.md`, `docs/HOOK-CATALOG.md`                        | Type Ownership, Public API Surface, Error Taxonomy       |
| `packages/agent-framework` | `src/hooks/prompt-executor.ts`, `src/hooks/agent-executor.ts` | Strict response decoder                                  |
| `packages/agent-framework` | `docs/SPEC.md`                                                | Class Contract Registry rows for the two executors       |
| `packages/agent-session`   | `examples/verify-compaction-contract.ts`                      | Custom executor returns an outcome                       |
| `packages/agent-session`   | `examples/verify-hook-outcome-contract.ts` (new)              | User-execution scenario                                  |
| `packages/agent-session`   | `package.json`                                                | Wire the new example into `scenario:verify`              |

`packages/agent-session/src/tool-hook-helpers.ts` is **not** in scope: `runPreToolHook` reads
`hookResult.blocked`, which this change leaves with identical semantics. That file changes in issue #2093.

### Alternatives Considered

**A. Add an `outcome` field alongside `exitCode`/`stdout`/`stderr`.**
_Pro:_ smallest diff; no executor signature changes; nothing outside `agent-core` recompiles.
_Con:_ two representations of the same fact, and the old one stays authoritative because
`hook-runner.ts` still branches on `exitCode`. Every future reader must know which wins, and the
`{"ok": "false"}` misread survives untouched — the bug is in the _decode_, not in the reporting. This
is the compatibility-shim shape the issue and tracker both forbid ("do not add compatibility shims or
forwarding aliases"; the audited API is prerelease).

**B. Keep `IHookResult` and fix only the HTTP truthiness check.**
_Pro:_ one-line fix for the sharpest symptom; near-zero blast radius.
_Con:_ leaves symptoms 2 and 3 entirely — timeout, spawn failure and HTTP 503 still arrive as
`exitCode: 1`, and issue #2093 still has no field to enforce on, so it would have to do this work anyway
with the fix already spent. It also does not satisfy this issue's stated acceptance criteria.

**C. Replace `IHookResult` with a discriminated `THookOutcome` union (chosen).**
_Pro:_ one representation; the compiler finds every consumer; malformed input becomes unrepresentable
as allow because `ok` must be exactly `true` or exactly `false`; `error` carries `kind` + `reason` +
`source`, which is what issue #2093 and issue #2099 need and what Envoy's diagnostic header is prior art for.
_Con:_ touches 4 packages and every executor implementation including one example; a consumer holding
a hand-rolled `IHookTypeExecutor` gets a compile error rather than a silent behavior change.

**D. Make `error` block immediately at the enforcing event, in this leaf.**
_Pro:_ closes the security hole in one PR instead of two.
_Con:_ explicitly forbidden by this issue's scope boundary ("Session enforcement policy is not
changed in this issue") and it is issue #2093's declared scope. It would also ship a policy change with no
per-event advisory opt-out, which would break every informational event that legitimately tolerates a
failing hook.

### Decision

**Alternative C.** The defect is that a failure and a verdict share one representation, so any fix
that keeps that representation (A, B) leaves the next reader — and issue #2093 — in the same position. A
discriminated union makes the three outcomes exhaustive and makes the compiler, not review, the thing
that finds consumers. D is the right change made at the wrong time; it is issue #2093, and this leaf exists
to make it a small change.

**Validation of the chosen design** (spec-workflow.md, "Validated Recommendation Before Approval" —
this is a contract-boundary change across four packages):

- **Reachability.** Every consumer of the replaced contract was enumerated from the tracked tree, not
  guessed: `git grep 'IHookResult|IHookTypeExecutor'` returns implementations in exactly five places —
  `CommandExecutor`, `HttpExecutor`, `GuardrailExecutor` (agent-core), `PromptExecutor`,
  `AgentExecutor` (agent-framework) — plus one hand-rolled executor literal in
  `packages/agent-session/examples/verify-compaction-contract.ts:84-86`. All six are in
  `## Affected Files`. Every other hit passes `IHookTypeExecutor[]` through as an opaque array and is
  unaffected by the return-type change. The union is declared in `agent-core`, which
  `agent-framework`, `agent-session` and `agent-executor` all already depend on, so the dependency
  direction is unchanged and no new edge is introduced.
- **Capability preservation.** Each capability of `IHookResult` is carried or consciously dropped:
  `exitCode: 0` → `allow`; `exitCode: 2` → `deny`; `stderr` on a block → `deny.reason`; `stdout` on
  success → `allow.stdout` (the runner's Claude-Code response-protocol parsing is unchanged and still
  reads it); `exitCode: <other>` → `error` with a `kind` naming which failure it was, which is
  strictly more information than the code it replaces. `stderr` on a _non-blocking_ result is dropped
  as a distinct channel and folded into `error.reason` — it had no reader (`hook-runner.ts:180`
  discarded it).
- **Adversarial pass.** Failure modes considered, with disposition:
  (a) _An executor returns `allow` with stdout that the runner then decodes as a deny
  (`continue: false`, `permissionDecision: "deny"`)._ Preserved deliberately — that is the
  Claude-Code response protocol and it is runner-level, not executor-level, so both layers keep the
  responsibility they have today.
  (b) _A guardrail that throws currently blocks (SELFHOST-005 fail-safe) and could be re-read as an
  `error` under the new vocabulary._ It stays `deny`, because changing it would be an enforcement
  policy change this leaf forbids itself.
  (c) _`unknownHookTypes` could be folded into `error`._ Left alone; it is issue #2099's declared scope,
  and absorbing it would expand this leaf against the tracker's explicit instruction.
  (d) _The strict decoder does change one blocking outcome, and this document originally denied it._
  A malformed body whose `ok` is falsy or absent (`{}`, `{"ok": null}`, a non-object) is a **deny**
  today (measured — `### Measured baseline`) and becomes an `error`, which does not block until issue #2093
  lands. So between this leaf and issue #2093 there is a window in which a `PreToolUse` hook returning a
  malformed body stops blocking the tool call. Accepted, for three reasons: that denial is not a
  decision any endpoint made, so preserving it would be preserving a coin flip; the alternative —
  mapping malformed to `deny` — directly contradicts this issue's acceptance criteria, which name
  non-boolean and missing `ok` as `error`; and the window is bounded by issue #2093, which is the next leaf
  and is already blocked on this one. This is the ONE enforcement-visible change in the leaf, it is
  called out again in `## Boundary`, and TC-02 asserts the new outcome is `error` and specifically
  **not** `deny` so the change is deliberate rather than incidental.
  (e) _Loss of a malformed body's stdout._ Accepted: `{"ok": "false"}` no longer contributes to
  `IRunHooksResult.stdout`, because it is now an `error` rather than an allow. Injecting a verdict
  the engine could not decode into model context was not a behavior worth preserving.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `## Affected Scope` 표, 4개 패키지
- [x] Sibling scan 완료 — 5개 `IHookTypeExecutor` 구현체 + 예제 1개 전수 확인 (`git grep`)
- [x] 대안 최소 2개 검토 완료 — A/B/C/D 4개
- [x] 결정 근거 문서화 완료 — `### Decision` + 검증 3항목

## Fallback & Degradation Declaration

None.

This change **removes** two undeclared fallbacks rather than adding any: the bare cast plus
truthiness test in `http-executor.ts:57-67` (a malformed body silently degrading to allow), and the
`catch` blocks in `prompt-executor.ts`/`agent-executor.ts` that map an unparseable model response
onto the same `exitCode: 1` as a transport failure. Both become explicit `error` outcomes with a
named `kind`.

Two `// allow-fallback:` annotations already in `hook-runner.ts` (lines 60, 74 — non-JSON stdout
treated as plain text; an invalid matcher regex falling back to exact string match) are untouched and
keep their annotations.

## Boundary

Stated because the acceptance criteria depend on it: **this leaf changes no enforcement _policy_.**
`deny` blocks, `allow` and `error` do not, exactly as today. What changes is that an `error` is now
_represented and reported_ (`IRunHooksResult.errors`) instead of being indistinguishable from a hook
that ran and approved.

**Enforcement-visible consequences, stated rather than buried.** This section originally claimed
exactly ONE. Two guards found otherwise, and both corrections are recorded here rather than quietly
absorbed — the second was found by GATE-VERIFY after the change had already merged.

**(a) A malformed body carrying NO block directive stops blocking.** Reclassifying it from a coerced
verdict to an `error` moves `{}`, `{"ok": null}`, and a non-object body out of the blocking set until
issue #2093 gives `error` a policy. That is a change in which tool calls are blocked, and calling it "no behavior change"
would be false. It is the unavoidable cost of correcting the coercion, it is bounded by the next
leaf, and its rationale is in `### Alternatives Considered` → adversarial pass (d).

**(b) A malformed body carrying `decision: "block"` on `PreToolUse` starts blocking.**
`explicitBlockDirective` treats `continue: false`, `decision: "block"` and
`permissionDecision: "deny"` as a block on ANY event, while `hook-runner.ts` scopes the latter two to
`UserPromptSubmit` and `PreToolUse` respectively. So `{"ok":"maybe","decision":"block"}` on
`PreToolUse` now denies where it previously allowed. This is fail-CLOSED and therefore easy to miss —
which is exactly why it needed a guard to find it rather than a reviewer's instinct. Filed as issue
#2196 to be decided alongside issue #2093, since it is per-event directive semantics and that leaf is
already choosing per-event policy. Its practical reach is currently bounded: no event other than
`PreToolUse` consults `blocked`, so a broader `deny` elsewhere changes nothing observable today.

Every outcome other than (a) and (b) blocks exactly as it did before, which TC-07 pins.

**Two concerns found during implementation, filed rather than absorbed.** A pre-push review raised
both; per issue #2079 § Execution rules a leaf does not grow to swallow what it uncovers.

1. **issue #2191** — `runHooks` remains long and branchy after the file split — `hook-matching.ts` and
   `response-protocol.ts` extracted cohesive concerns, but the runner itself did not shrink, because
   the response-protocol interpretation is still inline in a loop that mutates four accumulators and
   returns early from four places. Untangling it is a refactor with its own regression surface.
2. **issue #2192** — `packages/agent-executor/tsconfig.json` excludes `**/*.test.ts`, so `pnpm typecheck` cannot see a
   type error in that package's tests. This change was caught by review rather than by the compiler
   for exactly that reason, which makes "the compiler is the consumer sweep" (TC-10) narrower than it
   sounds wherever that exclusion applies.

Making an `error` deny on enforcing events is issue #2093; rejecting configured hook types with no reachable
executor is issue #2099. Both consume the type this leaf defines. New concerns discovered during
implementation become siblings under issue #2075 (issue #2079 § Execution rules) and do not expand this document.

## Solution

### The outcome union (`packages/agent-core/src/hooks/types.ts`)

```ts
/** Why a hook execution could not produce a verdict. */
export type THookErrorKind =
  | 'timeout' // the executor's own deadline elapsed
  | 'spawn-failure' // the process//transport never started
  | 'transport-failure' // it started and failed mid-flight (network, provider, session)
  | 'http-status' // a well-formed non-2xx response
  | 'malformed-response' // a response arrived and could not be decoded to a verdict
  | 'nonzero-exit'; // the process exited with a code that is neither 0 nor 2

interface IHookOutcomeBase {
  /** Which executor produced this outcome — preserved for diagnostics. */
  readonly source: THookDefinition['type'];
}

export interface IHookAllowOutcome extends IHookOutcomeBase {
  readonly outcome: 'allow';
  /** Raw hook stdout. The runner decodes the response protocol out of it. */
  readonly stdout: string;
}

export interface IHookDenyOutcome extends IHookOutcomeBase {
  readonly outcome: 'deny';
  readonly reason: string;
}

export interface IHookErrorOutcome extends IHookOutcomeBase {
  readonly outcome: 'error';
  readonly kind: THookErrorKind;
  readonly reason: string;
}

export type THookOutcome = IHookAllowOutcome | IHookDenyOutcome | IHookErrorOutcome;
```

`IHookResult` is deleted. `IHookTypeExecutor.execute` returns `Promise<THookOutcome>`.

### The verdict decoder

`{ ok, reason }` is the response shape shared by the HTTP, prompt, and agent executors, and all three
decode it wrongly in the same way today. One decoder owns it:

```ts
export function decodeHookVerdict(
  body: unknown,
  source: THookDefinition['type'],
  raw: string,
): THookOutcome;
```

`ok === true` → `allow`; `ok === false` → `deny` (reason from `reason` when it is a string);
anything else — a non-object, a missing `ok`, a non-boolean `ok` — → `error` with
`kind: 'malformed-response'` and a reason quoting what arrived.

**One carve-out, added after a pre-push review found the first version fail-open.** Before declaring
"no verdict", the decoder asks `explicitBlockDirective` whether the same body carries
`continue: false`, `decision: "block"`, or `hookSpecificOutput.permissionDecision: "deny"`. Those are
decisions the hook stated outright, and an undecodable `ok` beside them does not retract one — the
first version discarded them, so `{"ok":"false","continue":false}` stopped blocking, which is
fail-open in the gate this leaf exists to harden. The decoder also owns PARSING, so a body that is
not JSON is the same `malformed-response` as one whose `ok` is not boolean.

### Per-executor mapping

| Executor    | Condition                            | Outcome                              |
| ----------- | ------------------------------------ | ------------------------------------ |
| `command`   | exit `0`                             | `allow` (stdout)                     |
| `command`   | exit `2`                             | `deny` (stderr, or a default reason) |
| `command`   | any other exit code                  | `error` / `nonzero-exit`             |
| `command`   | killed by signal (exit code `null`)  | `error` / `nonzero-exit`             |
| `command`   | timeout elapsed                      | `error` / `timeout`                  |
| `command`   | `child.on('error')` (ENOENT, EACCES) | `error` / `spawn-failure`            |
| `http`      | non-2xx                              | `error` / `http-status`              |
| `http`      | `AbortSignal.timeout` fired          | `error` / `timeout`                  |
| `http`      | other fetch rejection                | `error` / `transport-failure`        |
| `http`      | body is not JSON                     | `error` / `malformed-response`       |
| `http`      | 2xx + body                           | `decodeHookVerdict`                  |
| `prompt`    | provider threw                       | `error` / `transport-failure`        |
| `prompt`    | response is not JSON                 | `error` / `malformed-response`       |
| `prompt`    | response is JSON                     | `decodeHookVerdict`                  |
| `agent`     | session threw                        | `error` / `transport-failure`        |
| `agent`     | response is not JSON                 | `error` / `malformed-response`       |
| `agent`     | response is JSON                     | `decodeHookVerdict`                  |
| `guardrail` | a guardrail returned `pass: false`   | `deny` (unchanged)                   |
| `guardrail` | a guardrail threw                    | `deny` (unchanged — SELFHOST-005)    |
| `guardrail` | all passed / empty selection         | `allow`                              |

### Runner (`hook-runner.ts`)

`IRunHooksResult` gains one field, carried on every return path exactly as `unknownHookTypes` is:

```ts
/** Hook executions that could not produce a verdict. Absent when every hook decided. */
errors?: readonly IHookErrorOutcome[];
```

`deny` returns `blocked: true` where `exitCode === 2` does today. `allow` runs the unchanged
response-protocol parsing over `stdout`. `error` is appended to `errors` and the loop continues,
which is what `if (result.exitCode !== 0) continue;` does today — the enforcement behavior issue #2093
will change, left deliberately untouched here.

## Affected Files

- `packages/agent-core/src/hooks/types.ts`
- `packages/agent-core/src/hooks/hook-runner.ts`
- `packages/agent-core/src/hooks/verdict-decoder.ts` (new)
- `packages/agent-core/src/hooks/hook-matching.ts` (new — extracted from the runner)
- `packages/agent-core/src/hooks/response-protocol.ts` (new — extracted from the runner)
- `packages/agent-core/src/hooks/executors/command-executor.ts`
- `packages/agent-core/src/hooks/executors/http-executor.ts`
- `packages/agent-core/src/hooks/executors/guardrail-executor.ts`
- `packages/agent-core/src/hooks/index.ts`
- `packages/agent-core/src/index.ts`
- `packages/agent-core/docs/SPEC.md`
- `packages/agent-core/docs/HOOK-CATALOG.md`
- `packages/agent-framework/src/hooks/prompt-executor.ts`
- `packages/agent-framework/src/hooks/agent-executor.ts`
- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-session/examples/verify-compaction-contract.ts`
- `packages/agent-session/examples/verify-hook-outcome-contract.ts` (new)
- `packages/agent-session/package.json`
  **Tests holding a hand-rolled `IHookTypeExecutor`.** Enumerated by
  `git grep -ln IHookTypeExecutor -- 'packages/**/*.test.ts' 'packages/**/examples/**'` rather than by
  inspection — an earlier draft of this list named six implementers when there are thirteen, and the
  miss was caught by the GATE-WRITE guard. Each of these returns `{ exitCode, stdout, stderr }` and
  must migrate when `IHookResult` is deleted:

- `packages/agent-core/src/hooks/__tests__/{types,command-executor,http-executor,guardrail-executor,integration,unknown-hook-type}.test.ts`
- `packages/agent-core/src/hooks/__tests__/verdict-decoder.test.ts` (new)
- `packages/agent-framework/src/hooks/__tests__/{prompt-executor,agent-executor}.test.ts`
- `packages/agent-framework/src/__tests__/{cross-package-hooks,hook-wiring}.test.ts`
- `packages/agent-executor/src/subagents/__tests__/worktree-subagent-runner.test.ts`
- `packages/agent-session/src/__tests__/{selfhost-009-existing-events-regression,selfhost-009-model-call-hooks,selfhost-009-permission-decision-hook,selfhost-009-pretooluse-gate,tool-hook-helpers,session-shutdown-best-effort}.test.ts`

**Size.** Roughly 25 files. That exceeds the ~600-line / ~15-file soft ceiling in
[git-branch.md](../../rules/git-branch.md) § PR Batching, and it stays one PR: a contract replacement
is not independently revertible in halves, so splitting it would put a knowingly-broken tree on the
integration branch between the two merges. The ceiling is soft and the exception is stated here so a
reviewer judges it rather than re-deriving it.

## Completion Criteria

- [x] TC-01: `pnpm --filter @robota-sdk/agent-core test src/hooks` → exits 0, and a test asserts an
      HTTP hook body of `{"ok": "false"}` produces `outcome: 'error'`, `kind: 'malformed-response'`
      (today it produces allow — the gate-disabling direction).
- [x] TC-02: A table test over `{}`, `{"ok": null}`, `"not an object"`, `[]` → every case is
      `outcome: 'error'`, `kind: 'malformed-response'`, and **not** `deny` (today every one of these
      produces a false denial with reason `"Blocked by HTTP hook"` — the user-blocking direction).
      Asserted for each of the `http`, `prompt`, and `agent` executors.
- [x] TC-03: `CommandExecutor` table test → exit 0 ⇒ `allow`; exit 2 ⇒ `deny` with stderr as reason;
      exit 1 and exit 127 ⇒ `error`/`nonzero-exit`; a command exceeding `timeout` ⇒ `error`/`timeout`;
      a signal-killed command (exit code `null`) ⇒ `error`/`nonzero-exit` with the signal named in
      `reason`. A `spawn-failure` row is asserted by stubbing `child.on('error')` rather than by a
      missing binary: a missing binary is reported by the shell as exit `127`, so it exercises the
      `nonzero-exit` row, not this one (measured — see `### Measured baseline`).
- [x] TC-04: `HttpExecutor` against a local `node:http` server → `503` ⇒ `error`/`http-status`;
      a non-JSON body ⇒ `error`/`malformed-response`; a connection refused ⇒
      `error`/`transport-failure`; `{"ok":true}` ⇒ `allow`; `{"ok":false,"reason":"nope"}` ⇒ `deny`
      with `reason === 'nope'`.
- [x] TC-05: Every outcome carries `source` equal to the definition's `type` — asserted for all five
      executors.
- [x] TC-06: `runHooks` over a config whose hooks all fail returns `blocked: false` and
      `errors.length === <n>`, each entry carrying `kind`, `reason`, and `source`; `errors` is
      `undefined` when every hook decided.
- [x] TC-07: `runHooks` enforcement **policy** is unchanged for every outcome the decoder does not
      reclassify — a PreToolUse `deny` still returns `blocked: true` with the hook's reason, an
      `error` still returns `blocked: false`, and an `allow` whose stdout carries `continue: false`
      / `permissionDecision: "deny"` still blocks. (Scope note: this does **not** assert that the
      same set of tool calls is blocked as before — reclassifying a falsy-`ok` body from `deny` to
      `error` deliberately changes that one case. `## Boundary` owns the statement; TC-02 owns the
      reclassification.)
- [x] TC-08: `GuardrailExecutor` verdicts are unchanged — `pass: false` ⇒ `deny`, a thrown guardrail
      ⇒ `deny`, an unregistered named guardrail ⇒ `deny`, all guardrails passing ⇒ `allow`.
- [x] TC-09: `grep -rn "IHookResult" packages apps --include=*.ts` → no matches outside `docs/`
      (the type is gone, not aliased).
- [x] TC-10: `pnpm build && pnpm typecheck` → exits 0 across the workspace.
- [x] TC-11: `pnpm --filter @robota-sdk/agent-session scenario:verify` → exits 0 and the new example
      prints `PASS` for all three outcomes (see `## User Execution Test Scenarios`).
- [x] TC-12: `pnpm harness:scan` → exits 0.

## Test Plan

Type `SECURITY` + tags `typescript`/`json-schema`/`auth` derive: permission-boundary integration
test, Zod/JSON-Schema-style validation test, and type tests.

| TC-ID | Test Type                     | Tool / Approach                                                      | Notes                                                        |
| ----- | ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| TC-01 | Validation (boundary)         | vitest — `http-executor.test.ts`                                     | The regression the issue names first                         |
| TC-02 | Validation (table)            | vitest — `verdict-decoder.test.ts` + per-executor tests              | One decoder, three consumers                                 |
| TC-03 | Integration (process)         | vitest — `command-executor.test.ts`, real `spawn`                    | Timeout row uses a short `timeout` + `sleep`                 |
| TC-04 | Integration (HTTP)            | vitest — `http-executor.test.ts` with a `node:http` server on port 0 | No network egress; connection-refused row uses a closed port |
| TC-05 | Unit                          | vitest — assertion in each executor suite                            | Diagnostics-preservation criterion                           |
| TC-06 | Integration (permission path) | vitest — `integration.test.ts` over `runHooks`                       | Aggregation + absence-when-clean                             |
| TC-07 | Integration (permission path) | vitest — `integration.test.ts`                                       | Pins the scope boundary against regression                   |
| TC-08 | Unit                          | vitest — `guardrail-executor.test.ts`                                | Capability-preservation for SELFHOST-005                     |
| TC-09 | Command-form                  | `grep -rn "IHookResult" packages apps --include=*.ts`                | Proves no forwarding alias survived                          |
| TC-10 | Build / typecheck             | `pnpm build && pnpm typecheck`                                       | The union's consumer sweep is compiler-enforced              |
| TC-11 | SDK scenario (offline)        | `pnpm --filter @robota-sdk/agent-session scenario:verify`            | Also the user-execution gate; see scenario below             |
| TC-12 | CI smoke                      | `pnpm harness:scan`                                                  | Repo-wide guards incl. `no-fallback`, `hook-catalog`         |

## User Execution Test Scenarios

The hooks engine is an **SDK-level surface** (`runHooks`, `IHookTypeExecutor`, and the hook
definition types are public exports of `@robota-sdk/agent-core`), so the scenario uses public SDK /
example usage — the surface backlog-execution.md names for SDK-only features. The repository's
established form for that is `packages/*/examples/verify-*.ts` driven by `pnpm scenario:verify`
(existing instances: `verify-offline.ts`, `verify-compaction-contract.ts`,
`verify-session-record-field-preservation.ts`).

**Why not the CLI.** This paragraph originally said a credential-free CLI scenario was impossible.
That was wrong, and the DONE-GATE-STAGE-1 guard caught it: `packages/agent-provider-replay` replays
recorded provider responses including tool calls, and `packages/agent-cli/src/cli.ts:254` wires it
behind `--session-log` so a session runs with "no key is ever used". The path exists; the earlier
claim asserted its absence without looking for it.

The actual reason is narrower and stronger: **this leaf's deliverable has no CLI-observable
manifestation.** It adds `IRunHooksResult.errors`, and of the nine non-test files that call `runHooks(`, not one
reads `.errors` off the result — the only occurrences in `hook-runner.ts` are its own writes. No product surface consumes it until issue
#2093 wires enforcement onto it. A CLI run would therefore show the deny path (unchanged by this
leaf) and could not show the two `error` cases, which are the change. Public SDK usage is where the
delivered contract is visible, not a consolation for an unavailable CLI.

That distinction matters beyond wording: issue #2093 DOES deliver CLI-observable behaviour, so this
reasoning must not be carried into its gate — a replay-provider CLI scenario is available and
appropriate there.

The environment probe is retained because the Done Gate requires capability-absence claims to be
probed rather than guessed: `env | grep -iE '(API_KEY|TOKEN|KEY)'` returns only
`CLAUDE_CODE_MESSAGING_TOKEN`; no `.env` exists (only `.env.example`); `~/.robota/` contains only
`update-check.json`. That is why the scenario needs no credentials — not why the CLI was declined.

### Scenario 1 — the three outcomes are decoded and reported, end to end

- **Agent-executability:** `agent-executable`.
- **Prerequisites / environment:** a built workspace (`pnpm install && pnpm build`). No API key, no
  network egress, no external service, and no provider or `Session` at all — the example drives the
  enforcement boundary (`PermissionEnforcer.wrapTools`) and `runHooks` directly, which is the whole
  path this leaf changes. The example ships with this work and creates its own temp
  directory and hook scripts; the local HTTP endpoint is a `node:http` server bound to port 0.
- **Exact commands:**
  ```bash
  cd /home/ubunutu/dev/robota-4
  pnpm install
  pnpm build
  pnpm --filter @robota-sdk/agent-session scenario:verify
  echo "exit=$?"
  ```
- **Expected observable result:** exit code `0`, and stdout contains all four lines:
  - `PASS deny: tool blocked, reason="SEC-015 scenario: denied by command hook"`
  - `PASS error/spawn-failure: tool NOT blocked, error reported (source=command)`
  - `PASS error/malformed-response: tool NOT blocked, error reported (source=http)`
  - `PASS allow: tool executed`

  The two `error` lines are the point of the scenario: the user sees that a hook which _failed_ is
  now visibly reported rather than silently indistinguishable from approval, while — per this leaf's
  boundary — the tool is still not blocked by it.

- **Cleanup / reset:** none required; the example removes its temp directory on exit. Re-running is
  idempotent.
- **Evidence:** _(to be filled after implementation — command output and exit code)_

### Pending verification owned by a later leaf

Per backlog-execution.md § Capability Reachability, this is named rather than assumed: **this leaf
does not deliver the fail-closed capability and does not claim it.** The user-observable change —
an enforcing tool call being _blocked_ because its hook failed — arrives with issue #2093, and the
agent-run verification of that behavior through a product surface is issue #2093's gate, not this one's.
Tracker issue #2075 is not complete until it passes.

## Tasks

- [ ] SEC-015 — in-progress — `.agents/tasks/SEC-015-hook-outcome-contract.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready

- Ordering: GATE-WRITE is the entry gate (gate-catalogue.md § Prior-gate map) — no prior-gate PASS required. Input state verified: frontmatter `status: draft` and file located in `.agents/spec-docs/draft/`, matching spec-workflow.md § Spec-Document Status and Lifecycle Folders. Evidence Log was empty before this entry (first GATE-WRITE run); `git status` shows the spec as the only change on `fix/sec-015-hook-outcome-contract` and `git diff origin/develop...HEAD` is empty — no implementation preceded this gate.
- Frontmatter: file opens with a `---` YAML block; `status: draft`; `type: SECURITY` (one value from the 11-prefix list); `tags: [typescript, json-schema, async, auth]` present. `node scripts/harness/check-spec-doc-frontmatter.mjs <file>` → exit 0, "spec-doc frontmatter scan passed."
- Problem — concrete symptom: three symptoms with source anchors, each re-verified against the tree — `http-executor.ts:57-67` does bare-cast `as { ok: boolean }` + `if (!body.ok)` (so `{"ok":"false"}` returns `exitCode: 0`); `hook-runner.ts:180` is literally `if (result.exitCode !== 0) continue;`; `IRunHooksResult` carries no failure field, so `tool-hook-helpers.ts` `if (hookResult.blocked)` cannot separate "approved" from "never ran".
- Problem — reproduction condition: present and specific ("Configure any enforcing `PreToolUse` hook in `.robota/settings.json`, then make the hook fail rather than decide — point an `http` hook at an endpoint returning `{"ok": "false"}`, or a `command` hook at a path that does not exist. The tool executes.").
- Problem — no vagueness: `grep -niE 'TBD|TODO|works correctly|no errors|displays correctly'` over the whole document → 0 matches.
- Prior Art Research — section present with 3 documentation citations, all product/API/protocol docs (not third-party source code, per research.md:12-13): Kubernetes admission-webhook reference (`failurePolicy` defaults to `Fail`), Envoy `ext_authz` v3 API reference (`failure_mode_allow` defaults `false`, adds `x-envoy-auth-failure-mode-allowed`), Claude Code hooks docs (documented fail-open). All three carry http links.
- Prior Art Research — observed common behavior + Robota constraint: "All three separate the verdict from the failure to reach one … none of them folds it into the allow verdict", and the Robota constraint paragraph states `{"ok":"false"}` is a misread verdict none of the three references has, and that this leaf supplies the outcome vocabulary while issue #2093 picks the default.
- Prior Art Research — feeds Alternatives/Decision: Alternative C's Pro cites Envoy's diagnostic metadata as the prior art for `kind`/`reason`/`source`; Alternative D's Con applies the K8s/Envoy protocol-vs-policy split. Not asserted. `node scripts/harness/scan-spec-research.mjs` → exit 0, "spec-research scan passed."
- Architecture Review Checklist — all 4 items are `[x]` (lines 184-187): affected packages, sibling scan, ≥2 alternatives, decision rationale.
- Sibling scan item — `[x]` with completion evidence, not N/A. Re-verified: `git grep -l "implements IHookTypeExecutor"` returns CommandExecutor, GuardrailExecutor, HttpExecutor (agent-core), PromptExecutor, AgentExecutor (agent-framework); the hand-rolled executor literal at `packages/agent-session/examples/verify-compaction-contract.ts:84-86` exists as described. All six appear in `## Affected Files`. Noted, non-blocking: a sixth in-tree implementation, `packages/agent-framework/src/__tests__/cross-package-hooks.test.ts`, is outside the `src/hooks/__tests__/` path the Affected Files test row names; TC-10 (`pnpm build && pnpm typecheck`) covers it mechanically.
- Alternatives Considered — 4 entries (A/B/C/D), each with an explicit `_Pro:_` and `_Con:_` line. Minimum of 2 exceeded.
- Decision — names Alternative C and the driving trade-off ("a failure and a verdict share one representation, so any fix that keeps that representation (A, B) leaves the next reader — and issue #2093 — in the same position"), plus the spec-workflow.md "Validated Recommendation Before Approval" triad (reachability enumeration, capability preservation of every `IHookResult` field, adversarial pass (a)-(d)) required for a contract-boundary change.
- New-surface placement (conditional) — **N/A**: the spec introduces no new package, app, or presentation/interface surface and reclassifies no layer or product-family boundary. `verdict-decoder.ts` is a new module inside the existing `agent-core` hooks layer that already owns `IHookResult`, and the new example sits beside the existing `packages/agent-session/examples/verify-*.ts` family. The Decision records that the union stays in `agent-core`, which agent-framework/agent-session/agent-executor already depend on, so no dependency edge is added.
- Completion Criteria — 12 items, `grep -c '^- \[ \] TC-'` → 12; every item carries a TC-N prefix (TC-01…TC-12) with no gaps. No banned phrase ("works correctly" / "no errors" / "implemented" / "displays correctly") occurs anywhere in the file.
- Completion Criteria — form and coverage: command form (TC-01, TC-09, TC-10, TC-11, TC-12) or exact-observable form naming concrete values (`outcome: 'error'`, `kind: 'malformed-response'`, `reason === 'nope'`, `blocked: false`, `errors.length === <n>`). At least one criterion per sub-item of issue #2083: decoder (TC-01/02), command exit mapping (TC-03), HTTP/transport mapping (TC-04), reason/source diagnostics (TC-05/06), unchanged enforcement policy (TC-07/08), no forwarding alias (TC-09).
- Test Plan — section present; `grep -c '^| TC-'` → 13 lines = 1 header + 12 data rows, one per TC-N, count matches Completion Criteria exactly with no orphan or duplicate ID.
- Test Plan — every row has a non-empty Test Type and Tool/Approach; no "TBD" anywhere in the file.
- Test Plan — `manual` rows: **N/A**, `grep -ni '| *manual'` → 0 rows. Every row resolves to vitest, a command-form `grep`, `pnpm build && pnpm typecheck`, `pnpm harness:scan`, or the `scenario:verify` example run, so the manual-Notes justification requirement does not apply.
- Structure — `## Tasks` present with the `미생성 (GATE-APPROVAL 통과 후 생성)` placeholder; `## Evidence Log` present and empty prior to this entry (file terminated at the heading); no `## Status` and no `## Classification` heading exists in the body (`grep -n '^#\{1,3\} '` heading list checked in full).
- User Execution Test Scenarios (not a GATE-WRITE criterion; inspected as requested) — the public-SDK/example surface is legitimate under backlog-execution.md:245 ("public SDK/example usage for SDK-only features") and follows the repo's established `examples/verify-*.ts` + `scenario:verify` form, which exists today (`packages/agent-session/package.json:49` chains `verify-offline.ts`, `verify-session-record-field-preservation.ts`, `verify-compaction-contract.ts`). Scenario 1 is `agent-executable` with exact commands, prerequisites, four exact expected stdout lines plus exit code, a cleanup note, and an evidence placeholder. The credential probe was independently reproduced on 2026-08-23: `env` grep for API_KEY/TOKEN/KEY yields only `CLAUDE_CODE_MESSAGING_TOKEN`; the repo holds `.env.example` only; `~/.robota/` contains only `update-check.json` — matching the document verbatim, so the "no provider credential" claim is probed, not asserted. The pending fail-closed verification is named as issue #2093's rather than claimed here, per backlog-execution.md § Capability Reachability.

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready

**Run 2 of this gate — judged against the revised document; supersedes the run-1 entry above,** which
evaluated a superseded revision (its Problem/symptom lines no longer describe this text). The run-1
entry is left intact as the record of that run. This is not a bypass: frontmatter is still `status: draft`,
the file is still in `.agents/spec-docs/draft/`, `git status` shows it still untracked with no
implementation change on `fix/sec-015-hook-outcome-contract`, so no gate was skipped and no status this
gate governs was advanced between runs.

- Frontmatter: `---` block opens the file; `status: draft`; `type: SECURITY` (one of the 11 prefixes); `tags: [typescript, json-schema, async, auth]`. Unchanged by the revision; `check-spec-doc-frontmatter.mjs` on this file → exit 0.
- Problem — concrete symptom: met, and the revision replaced an assertion with a measurement. Symptom 1 is now a 5-row table of body → `exitCode` → verdict; symptom 2 names `127` for a missing binary and locates the flattening at `hook-runner.ts:180`; symptom 3 names the missing `IRunHooksResult` field. Every source citation re-verified in the tree: `http-executor.ts:49-55` is the `if (!response.ok)` → `exitCode: 1` path; `:57-67` is the bare cast + `if (!body.ok)` → `exitCode: 2, stderr: body.reason ?? 'Blocked by HTTP hook'`; `:68-71` is the catch → `exitCode: 1`; `prompt-executor.ts:68-74` is the `JSON.parse` catch → `exitCode: 1`; `tool-hook-helpers.ts:69` is `if (hookResult.blocked)`; `command-executor.ts:52-76` resolves `code ?? 1` on close, `1` + `'Hook timed out'` on the timer, `1` on `child.on('error')`.
- Problem — measured baseline verified, not accepted on claim: both probes exist at `scratch/src/sec-015-repro.ts` and `scratch/src/sec-015-repro-cmd.ts`, drive the shipped executors through the public `@robota-sdk/agent-core/node` export, and I re-ran both at gate time. HTTP output reproduced the document's transcript line for line (`{"ok": "false"}`→0 ALLOW, `{"ok": null}`→2 DENY, `{}`→2 DENY, `{"ok": 1}`→0 ALLOW, `"not an object"`→2 DENY). Command output likewise (`exit 127 (no binary) exitCode=127 stderr="zsh:1: command not found: definitely-not"`, `timeout exitCode=1 stderr="Hook timed out"`, `killed by signal exitCode=1`). The falsy-`ok`-denies-the-user finding is real and the document's self-correction is accurate.
- Problem — placement of that evidence: `### Measured baseline` (line 63) is a level-3 subsection of `## Problem` and is the correct home. `## Evidence Log` was NOT an option — backlog-writer reserves it for the gate guard ("All entries written by `backlog-gate-guard`. Never write manually.") and this gate's structure criterion requires it empty on the first run, so transcripts there would have failed the gate. `scratch/src/` as script home matches backlog-execution.md's Script home rule. Noted: the probes are gitignored and uncommitted, so the transcripts are not durable artifacts — acceptable here because GATE-WRITE has no durable-artifact criterion and I reproduced them directly; DONE-GATE-STAGE-2 evidence will need committed artifacts instead.
- Problem — no vagueness: `grep -niE 'TBD|TODO|works correctly|no errors|displays correctly'` over the document body (lines 1-514, excluding this log) → 0 matches.
- Prior Art Research — unchanged in citations (K8s admission webhooks `failurePolicy` default `Fail`; Envoy `ext_authz` `failure_mode_allow` default `false` + `x-envoy-auth-failure-mode-allowed`; Claude Code hooks fail-open), all three product/API/protocol docs with http links, per research.md:12-13. `scan-spec-research.mjs` → exit 0. The revised constraint paragraph is now stronger and matches the measurement: Robota "does not actually implement a posture at all… it coerces a malformed response into a verdict", which is exactly what the probe shows.
- Prior Art Research — feeds Alternatives/Decision: Alternative C's Pro cites Envoy's diagnostic metadata for `kind`/`reason`/`source`; D's Con applies the K8s/Envoy protocol-vs-policy ordering. Evidence-based, not asserted.
- Architecture Review Checklist — all 4 `[x]` (lines 245-248).
- Sibling scan — `[x]` with evidence; re-verified `git grep -l "implements IHookTypeExecutor"` → the five named executors, plus the hand-rolled literal at `verify-compaction-contract.ts:84-86`. Same non-blocking note as run 1: the test double in `packages/agent-framework/src/__tests__/cross-package-hooks.test.ts` is outside the test path Affected Files names; TC-10 catches it mechanically.
- Alternatives Considered — 4 entries (A/B/C/D), each with `_Pro:_` and `_Con:_`. ≥2 satisfied.
- Decision — names Alternative C with the driving trade-off, and the adversarial pass grew from four to five items. New item (d) is the material one: it withdraws the document's earlier "no blocking change" claim and states the consequence — malformed falsy-`ok` bodies leave the blocking set until issue #2093 — with three stated reasons for accepting it (the denial was never a decision an endpoint made; mapping malformed→`deny` would contradict issue #2083's acceptance criteria; the window is bounded by the next leaf, which is already blocked on this one). Old (d) survives as (e).
- Boundary — the enforcement consequence is adequately disclosed, and disclosed in the right register. The opening claim is now correctly narrowed to "changes no enforcement _policy_", and a dedicated paragraph ("One enforcement-visible consequence, stated rather than buried") names the exact affected bodies (`{}`, `{"ok": null}`, a non-object), states plainly that "calling it 'no behavior change' would be false", bounds the window at issue #2093, and cross-references adversarial (d). TC-02 pins it as a deliberate change by asserting `error` and specifically **not** `deny`.
- Completion Criteria — 12 items, all TC-N prefixed with no gaps (`grep -c '^- \[ \] TC-'` → 12). No banned phrase anywhere in the body. Coverage per issue #2083 sub-item intact after the revision: decoder both directions (TC-01 truthy-non-boolean, TC-02 falsy/absent), command exit mapping (TC-03), HTTP/transport (TC-04), reason/source diagnostics (TC-05/06), enforcement residual + guardrail preservation (TC-07/08), no forwarding alias (TC-09).
- Completion Criteria — form: command form (TC-01, TC-09, TC-10, TC-11, TC-12) or exact-observable form with literal values (`outcome: 'error'`, `kind: 'malformed-response'`, `error`/`nonzero-exit`, `reason === 'nope'`, `blocked: false`). The two revised criteria improved: TC-02 now names the false-denial baseline it must overturn, and TC-03 correctly stops using a missing binary for `spawn-failure` and stubs `child.on('error')` instead, which the source confirms is the only path that reaches that branch (a missing binary is reported by the shell as `127` and hits the `close` handler).
- **Finding recorded against TC-07 — non-blocking, but it must not survive to GATE-COMPLETE.** TC-07 still carries the unscoped gloss "(Boundary criterion: this leaf changes no enforcement decision.)" and opens "blocking behavior is unchanged". `## Boundary` (line 275) now says the opposite in terms — "That is a change in which tool calls are blocked, and calling it 'no behavior change' would be false" — and scopes TC-07's role to "Every other outcome". TC-07's two testable clauses (a `deny` still returns `blocked: true` with the hook's reason; an `error` still returns `blocked: false`) remain true, verifiable and in observable form, so the gate's Completion-Criteria checks (TC-N prefix / coverage / form / banned phrases) are all still met and this is not a FAIL under any criterion this gate owns. But the parenthetical is a stale claim the same document refutes, and a GATE-COMPLETE verifier who reads it literally would be asked to certify a proposition `## Boundary` calls false. Recommended before GATE-APPROVAL (author's call, not this gate's): narrow it to match Boundary — the "policy" qualifier and the "every other outcome" scope.
- Minor observations, neither a criterion breach: (i) the Problem table's `{"ok": 1}` row has no TC of its own — its class (truthy non-boolean ⇒ `error`) is covered by TC-01; (ii) the TC-03 Test Plan Notes still read "real `spawn`" without mentioning the stubbed `spawn-failure` row that TC-03's own text now specifies.
- Test Plan — present; `grep -c '^| TC-'` → 13 = 1 header + 12 data rows, one per TC-N, exact match with Completion Criteria, no orphan or duplicate ID. Every row has a non-empty Test Type and Tool/Approach; no "TBD".
- Test Plan — `manual` rows: N/A, `grep -ci '| *manual'` → 0. Every row resolves to vitest, a command-form `grep`, `pnpm build && pnpm typecheck`, `pnpm harness:scan`, or the `scenario:verify` example run, so the manual-Notes justification requirement does not apply.
- Structure — `## Tasks` carries the `미생성 (GATE-APPROVAL 통과 후 생성)` placeholder; `## Evidence Log` present, containing only guardian entries and no author-written content (the criterion's "empty" clause is scoped to the first GATE-WRITE run, which this is not); the full heading sweep shows no `## Status` and no `## Classification`, and `### Measured baseline` is a level-3 subsection rather than a new top-level section.
- New-surface placement (conditional) — N/A: no new package, app, or presentation/interface surface, and no layer/product-family reclassification. `verdict-decoder.ts` is a new module inside the `agent-core` hooks layer that already owns `IHookResult`; the new example joins the existing `examples/verify-*.ts` family; the Decision records that no dependency edge is added.
- User Execution Test Scenarios (not a criterion of this gate; inspected as requested) — unchanged by the revision and still sound. Public-SDK/example surface is the one backlog-execution.md:245 names for SDK-only features, in the repo's established `examples/verify-*.ts` + `scenario:verify` form (`packages/agent-session/package.json:49` already chains three). Scenario 1 is `agent-executable` with exact commands, prerequisites, four exact stdout lines plus exit code, cleanup, and an evidence placeholder. Credential probe independently reproduced today: env grep yields only `CLAUDE_CODE_MESSAGING_TOKEN`, the repo holds `.env.example` only, `~/.robota/` holds only `update-check.json` — probed, not asserted. Pending fail-closed verification is named as issue #2093's, per backlog-execution.md § Capability Reachability. Note for the later gate: TC-11 and Scenario 1 share a command, so DONE-GATE-STAGE-2 must draw evidence from the example's product-surface output, never from a test-suite result.

### [GATE-APPROVAL] — 🔴 NON-COMPLIANCE | 2026-08-23

**Status remains:** review-ready

**Violation:** A later gate's artifact already exists, in a state that presumes this gate and the next
one have both passed. `.agents/tasks/SEC-015-hook-outcome-contract.md` is present in the working tree
(untracked, mtime `2026-08-23 10:24:11 +0900`, 5436 bytes) and carries `status: in-progress` plus the
line "Paired spec-doc: `.agents/spec-docs/active/SEC-015-hook-outcome-contract.md`" — a path that does
not exist (`ls` → No such file or directory) and which, per spec-workflow.md § Spec-Document Status and
Lifecycle Folders, is the folder for `in-progress`/`verifying`, i.e. two transitions beyond the
`review-ready` → `approved` transition this gate governs. Its content is not a bare problem record: it
carries a `## Test Plan` (GATE-IMPLEMENT criterion 4) and a `## User Execution Test Scenarios` section
(DONE-GATE-STAGE-1's artifact), so it is the artifact GATE-IMPLEMENT exists to verify, pre-built and
pre-statused before GATE-APPROVAL ran. The tree therefore records two incompatible states for one ID:
this document says `review-ready`, awaiting approval, with `## Tasks` declaring the file
"미생성 (GATE-APPROVAL 통과 후 생성)"; the task file says the work is in progress and the plan lives in
`active/`. The forward-dated record is the newer one — the spec's mtime is `02:59:16`, the task file's
is `10:24:11`, and this gate run began at `10:25:37`. This is not stale drift; the artifact was created
~86 seconds before this gate was dispatched.

**Required action:** Resolve the contradiction between the two records for SEC-015 before re-running
GATE-APPROVAL — either withdraw `.agents/tasks/SEC-015-hook-outcome-contract.md` until GATE-APPROVAL
passes and GATE-IMPLEMENT authorizes it, or record why it legitimately predates approval and correct
its `status:` and its paired-spec pointer to the document's true state. The disposition is the
orchestrator's call, not this gate's. On re-run, GATE-IMPLEMENT must not treat that file as satisfying
its "tasks file has been created" criterion without knowing it was authored before the gate that
authorizes it.

**Scope of this violation, stated so the re-run is not re-litigated:** it is a state violation, not a
code violation, and it does not touch the approval itself. No implementation work occurred —
`git diff origin/develop...HEAD` is empty (no commits ahead of `origin/develop`),
`git diff --name-only origin/develop...HEAD -- packages apps` is empty, and
`git status --porcelain --untracked-files=all` shows exactly four entries: the two SEC-015 documents
(untracked) and `.agents/evals/lessons/{auto-lessons,weekly-digest}.md` (harness-generated, and their
diff contains no SEC-015 or hook-outcome reference). No `.ts`/`.tsx`/`.js`/`.mjs` file was created or
edited, so spec-workflow.md § User Request Implementation Gate is not breached and the catalogue's
literal "implementation work (file edits, code commits)" trigger did not fire on its own.

**Ordering check — PASS.** Prior gate GATE-WRITE shows PASS for this document: two entries in this log,
both dated 2026-08-23, run 2 explicitly superseding run 1 and stating why the re-run was not a bypass.
Input state matches the prior-gate map's `review-ready`: frontmatter reads `status: review-ready` and
the file sits in `.agents/spec-docs/backlog/`, which spec-workflow.md maps to that status. Ordering is
sound; the violation above was found while checking this gate's NON-COMPLIANCE trigger, not in ordering.

**Criteria evaluated in full (all four met — recorded so a re-run inherits the work, not the verdict):**

- Criterion 1, explicit approval in the current conversation — **met.** Verbatim, as supplied by the
  dispatching orchestrator with its presentation context: "Approved — implement SEC-015 as specified. I
  confirm the SEC-015 design: replace IHookResult with the allow/deny/error union, add the shared
  verdict decoder, surface errors on IRunHooksResult, and accept the stated consequence that falsy-`ok`
  malformed bodies stop blocking until issue #2093 lands. Proceed to implementation." Date: 2026-08-23.
  Provenance limitation recorded rather than glossed: this guardian did not observe the user's turn
  directly and cannot verify that the statement was made — only that its content is design-confirming
  and matches this document. That is the normal operating position of this gate, not an exception.
- Criterion 2, direct and unambiguous, directed at THIS document — **met**, and judged on content, not
  on input modality. The statement names the ID and four design elements that resolve against this
  document specifically: "the allow/deny/error union" ↔ `THookOutcome` (`## Solution` § The outcome
  union, lines 297-334); "the shared verdict decoder" ↔ `decodeHookVerdict` (§ The verdict decoder,
  lines 336-351); "surface errors on IRunHooksResult" ↔ `errors?: readonly IHookErrorOutcome[]`
  (§ Runner, lines 378-390); and the falsy-`ok` consequence ↔ `## Boundary` "One enforcement-visible
  consequence" (lines 283-289) and adversarial pass (d) (lines 240-250). On the catalogue's exclusion
  ("answering a clarifying question … without confirming the design"): it does not apply. The exclusion
  turns on a bare token that confirms nothing; this text enumerates the design and explicitly accepts
  the one disclosed enforcement regression. That it was selected from three options does not reduce it,
  because the three were substantively distinct — approve as specified, approve while keeping malformed
  bodies blocking (which would have required amending the leaf's scope), or hold pending the user's own
  read — so choosing the first discriminates on the exact enforcement consequence rather than assenting
  to a leading question. Recorded for the record: had the option text been a bare "Approve"/"Option A"
  with the design carried only by the surrounding prompt, or had the options not been substantively
  distinct, this criterion would have FAILED as an answer to a clarifying question.
- Criterion 3, no Architecture Review or frontmatter type/tags modified after approval — **met**, with
  the verification method stated because the instructed one was unavailable. `git diff` yields nothing
  here: the file is untracked and has never been committed on any ref
  (`git log --all -- '.agents/spec-docs/**/SEC-015*'` → empty), so there is no committed baseline to
  diff against. Verified instead by three converging checks. (i) mtime: the document was last written
  `2026-08-23 02:59:16 +0900`, and this gate ran at `10:25:37`, so it has not been modified in the
  intervening 7.5 hours. (ii) Line-anchor reconciliation against the GATE-WRITE run-2 entry, which
  recorded the Architecture Review Checklist at lines 245-248 and the `## Boundary` sentence "That is a
  change in which tool calls are blocked" at line 275. They now stand at 257-260 and 287 — both shifted
  by exactly +12, which is the size of the `### Measured baseline` probe-transcript insertion at lines
  94-105 (verified by inspection: the `sec-015-probe-abort.mjs` paragraph, fenced transcript, and
  closing sentence = 12 lines). A uniform shift means zero net line change anywhere between line 105 and
  line 287, which spans the whole of `## Architecture Review` (151-260). (iii) Content re-check: the
  run-2 entry's assertions about that section still hold verbatim — all 4 checklist items `[x]`
  (257-260), Alternatives A/B/C/D each with `_Pro:_`/`_Con:_`, adversarial pass items (a)-(e) with (d)
  the withdrawal item and (e) the stdout item. Frontmatter `type: SECURITY` and
  `tags: [typescript, json-schema, async, auth]` are byte-identical to what run 2 recorded;
  `status:` moved draft → review-ready, which is GATE-WRITE's PASS output and is outside this
  criterion's scope (it names `type`/`tags` only). The three edits the orchestrator describes as made
  between run 2 and the approval are all located and all outside the guarded regions: the probe
  transcript (94-105, inside `## Problem`), the `## Affected Files` expansion (410-427: the 13-file
  hand-rolled-executor list plus the "Size" note taking the ~600-line/~15-file PR ceiling as a stated
  exception), and the TC-07 narrowing (453-459) — which resolves run 2's recorded finding: the stale
  gloss "(Boundary criterion: this leaf changes no enforcement decision.)" is absent from the body, and
  TC-07 now carries the "**policy**" qualifier, the "every outcome the decoder does not reclassify"
  scope, and an explicit scope note pointing at `## Boundary` and TC-02. Not verifiable by any means
  available here, and therefore recorded as resting on the orchestrator's statement rather than on
  evidence: that those three edits preceded the approval rather than followed it. The mtime bound makes
  the criterion safe either way only if the approval postdates 02:59:16.
- Criterion 4, independent architecture validation (conditional) — **N/A, re-derived from the tree
  rather than inherited from the run-2 entry.** The trigger (spec-workflow.md § New-Surface
  Architecture Placement: a new package, app, or presentation/interface surface, or a reclassified
  layer/product-family boundary, incl. "a new module that could plausibly live in more than one place")
  does not fire. All four packages named in `## Affected Scope` already exist (`packages/agent-core`,
  `agent-framework`, `agent-session`, `agent-executor`); no new workspace member is proposed
  (`pnpm-workspace.yaml` unchanged, and the only `package.json` in scope is `agent-session`'s existing
  one, edited to chain the new example into `scenario:verify`). Of the three new files, none is a
  surface: `packages/agent-core/src/hooks/verdict-decoder.ts` is a module in the directory that already
  owns `types.ts`, `hook-runner.ts` and `executors/`; `__tests__/verdict-decoder.test.ts` joins that
  suite; `packages/agent-session/examples/verify-hook-outcome-contract.ts` joins the existing family
  (`verify-offline.ts`, `verify-compaction-contract.ts`, `verify-session-record-field-preservation.ts`,
  all confirmed present). On the "could plausibly live in more than one place" clause specifically: the
  decoder is shared between an `agent-core` executor (http) and two `agent-framework` executors
  (prompt, agent), but its placement is forced, not chosen — `agent-framework/package.json:64` and
  `agent-session/package.json:80` already declare `"@robota-sdk/agent-core": "workspace:*"`, so hosting
  it anywhere else would invert an existing dependency edge. A single admissible location is not a
  boundary decision. The change is an API modification within an existing package's existing public
  surface (delete `IHookResult`, export `THookOutcome` et al.), which the New-Surface rule does not
  govern. Accordingly no `proposal-reviewer` ENDORSE and no `architecture-audit-fanout` structure-channel
  result is required, and their absence from this log is not a defect.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

**Run 2 of this gate.** It does not supersede the NON-COMPLIANCE entry above; that entry remains the
record of run 1, and the violation it named has been remedied rather than reargued.

- Ordering — PASS. Prior gate GATE-WRITE shows PASS for this document (two entries, lines 549 and 574,
  both 2026-08-23, run 2 superseding run 1 with its reason stated). Input state matches the prior-gate
  map's `review-ready`: frontmatter reads `status: review-ready` and the file is in
  `.agents/spec-docs/backlog/`, the folder spec-workflow.md § Spec-Document Status and Lifecycle Folders
  maps to that status. Unchanged since run 1.
- **Run-1 violation — remedied, verified independently rather than accepted on report.**
  `find .agents/tasks -maxdepth 2 -iname '*sec-015*'` returns nothing, so the file is gone from the root
  and from `completed/` alike. `git log --all -- '.agents/tasks/SEC-015*'` is empty, confirming it was
  never committed on any ref, so nothing survives the deletion and no history needs unwinding.
  `git status --porcelain --untracked-files=all` now returns exactly three entries — this spec-doc
  (untracked) and `.agents/evals/lessons/{auto-lessons,weekly-digest}.md` (harness-regenerated, no
  SEC-015 reference in their diff). This document's `## Tasks` placeholder (line 545,
  `미생성 (GATE-APPROVAL 통과 후 생성)`) is therefore a true statement again, which it was not at run 1.
- **NON-COMPLIANCE trigger — does not fire.** No implementation work preceded this gate. No commits ahead
  of `origin/develop` (`git log --oneline origin/develop..HEAD` empty); `git diff --name-only
origin/develop...HEAD` empty; no `.ts`/`.tsx`/`.js`/`.mjs` created or edited, so spec-workflow.md
  § User Request Implementation Gate is not breached.
- **Wider sweep for any other artifact presuming a gate that has not run — clean.** `git grep -l SEC-015`
  over the tracked tree returns nothing; the only untracked file mentioning SEC-015 is this document.
  `.agents/spec-docs/todo/` (the `approved` folder) holds only ARCH-100 and `.agents/spec-docs/active/`
  holds only AGREEMENT-001, AGREEMENT-002 and INFRA-104 — no SEC-015 document has been pre-placed in a
  folder ahead of its status. The three `scratch/src/sec-015-*` files are the repro probes GATE-WRITE run 2
  verified (mtimes 02:51-02:55, pre-approval, unchanged); they live in the gitignored dev-tooling tier per
  backlog-execution.md § Script home and drive the _shipped_ executors, so they are measurement, not
  implementation of this leaf.
- Criterion 1, explicit approval in the current conversation — **met.** Verbatim, as supplied by the
  dispatching orchestrator with its presentation context: "Approved — implement SEC-015 as specified. I
  confirm the SEC-015 design: replace IHookResult with the allow/deny/error union, add the shared verdict
  decoder, surface errors on IRunHooksResult, and accept the stated consequence that falsy-`ok` malformed
  bodies stop blocking until issue #2093 lands. Proceed to implementation." Date: 2026-08-23. Provenance
  limitation recorded rather than glossed: this guardian did not observe the user's turn and cannot verify
  the statement was made — only that its content is design-confirming and resolves against this document.
- Criterion 2, direct and unambiguous, directed at THIS document — **met**, judged on content rather than
  input modality, and re-resolved against the current text this run: "the allow/deny/error union" ↔
  `THookOutcome` (`## Solution` § The outcome union, 297-334); "the shared verdict decoder" ↔
  `decodeHookVerdict` (336-351); "surface errors on IRunHooksResult" ↔
  `errors?: readonly IHookErrorOutcome[]` (§ Runner, 378-390); the falsy-`ok` consequence ↔ `## Boundary`
  (276-293, "One enforcement-visible consequence") and adversarial pass (d) (240-250). The catalogue's
  exclusion ("answering a clarifying question … without confirming the design") does not apply: it targets
  a bare token confirming nothing, whereas this text enumerates the design and explicitly accepts the one
  disclosed enforcement regression. Selection from three options does not weaken it, because the options
  were substantively distinct — approve as specified, approve while keeping malformed bodies blocking
  (which would have required amending the leaf's scope with the orchestrator), or hold pending the user's
  own read — so choosing the first discriminates on the exact enforcement consequence rather than assenting
  to a leading question. Recorded for the record: a bare "Approve"/"Option A" carrying the design only in
  the surrounding prompt, or options that were not substantively distinct, would have FAILED this criterion.
- Criterion 3, no Architecture Review or frontmatter `type`/`tags` modified after approval — **met**, and
  **run 1's arithmetic for this criterion is corrected below rather than repeated.**
  - Frontmatter: `type: SECURITY` and `tags: [typescript, json-schema, async, auth]` are byte-identical to
    what both GATE-WRITE entries recorded. This is the one part of the criterion with a recorded byte-level
    baseline, and it matches. (`status:` moved draft → review-ready, which is GATE-WRITE's PASS output and
    is outside this criterion — it names `type`/`tags` only.)
  - `## Architecture Review` (151-260) — unchanged in length and in every recorded property. Length is
    established by two anchors from the GATE-WRITE run-2 entry: `### Measured baseline` was at line 63 and
    is at line 63 now (unmoved), and the Architecture Review Checklist was at 245-248 and is at 257-260 now
    — exactly +12, which is precisely the size of the third-probe transcript inserted at lines 94-105
    (verified by inspection: paragraph + fenced transcript + closing sentence = 12 lines). Since that
    insertion is the only change above the checklist and it fully accounts for the offset, every line
    between 63 and 260 — the whole of `## Architecture Review` — is unchanged in count. Content re-verified
    against run 2's assertions: Alternatives A/B/C/D at 175/183/189/196 each with `_Pro:_`/`_Con:_`;
    `### Decision` (203) naming Alternative C (205) plus the validation triad; adversarial pass (a)-(e) at
    231/235/238/240/251 with (d) the withdrawal item and (e) the stdout item; all four checklist items
    `[x]` at 257-260.
  - **Correction to run 1.** Run 1 recorded that the checklist and the `## Boundary` anchor "both shifted by
    exactly +12". That was wrong on both counts: it cited the Boundary sentence as line 287 when
    "That is a change in which tool calls are blocked" is at line 286, and it treated run 2's citation
    "`## Boundary` (line 275)" as pointing at that sentence when the same entry's parallel citation
    "`### Measured baseline` (line 63)" points at a _heading_. Read as a heading, `## Boundary` moved
    275 → 276, a delta of +1, not +12. The two readings are not separable from the tree, because this file
    is untracked and has never been committed on any ref, so there is no diff to settle it. The Boundary
    anchor is therefore NOT relied on as verification here; the criterion rests on the Measured-baseline and
    checklist anchors above, which are unambiguous and sufficient because `## Architecture Review` lies
    entirely between them.
  - **Discrepancy surfaced, outside this criterion but not buried.** Under the heading reading, the +1 vs.
    +12 gap implies the region between the checklist (ends 260) and `## Boundary` (276) lost ~11 lines after
    GATE-WRITE run 2 — that region is `## Fallback & Degradation Declaration` (262-275), a top-level section
    _sibling to_ `## Architecture Review`, not part of it, so it is outside what this criterion guards and
    does not affect the verdict. It is recorded because it means either the orchestrator's three-edit list
    (TC-07 narrowing, `## Affected Files` expansion, probe transcript — none of which touch that section) is
    incomplete, or run 2's line citation is imprecise. GATE-WRITE has no fallback-declaration criterion and
    run 2 recorded no content baseline for that section, so nothing verifiable was lost either way; TC-12's
    `pnpm harness:scan` covers the `no-fallback` scan mechanically at GATE-COMPLETE.
  - Stability since run 1: the document was written once since — by this gate, appending the run-1 evidence
    entry — so its mtime is `2026-08-23 10:29:44`, not the `02:59:16` an unmodified file would carry. (The
    orchestrator's expectation that the mtime would be unchanged is corrected here: the gate's own authorized
    write moved it.) The body is verified unchanged across that write by total line count (726) and by all
    seventeen structural heading offsets holding their run-1 values (11, 63, 107, 151, 255, 262, 276, 295,
    392, 429, 469, 489, 543, 547, 549, 574, 607), plus byte-identical frontmatter, checklist, TC-07 text
    (453-459) and `## Tasks` placeholder.
  - **Limitation, stated because it cannot be closed here and the orchestrator did not ask it to be taken on
    faith:** that the three described edits _preceded_ the approval rather than followed it rests on the
    orchestrator's statement alone. There is no committed baseline for this file, so no evidence available to
    this gate can establish that ordering.
- Criterion 4, independent architecture validation (conditional) — **N/A**, derived from the tree, and the
  inputs re-confirmed unchanged this run. The trigger (spec-workflow.md § New-Surface Architecture Placement:
  a new package, app, or presentation/interface surface, or a reclassified layer / product-family boundary,
  incl. "a new module that could plausibly live in more than one place") does not fire. All four packages in
  `## Affected Scope` exist (`packages/{agent-core,agent-framework,agent-session,agent-executor}`);
  `pnpm-workspace.yaml` and `packages/agent-session/package.json` are both unmodified in the working tree, so
  no new workspace member is introduced — the only `package.json` edit in scope chains the new example into
  the existing `scenario:verify`. None of the three new files is a surface:
  `packages/agent-core/src/hooks/verdict-decoder.ts` joins the directory that already owns `types.ts`,
  `hook-runner.ts` and `executors/`; `__tests__/verdict-decoder.test.ts` joins that suite;
  `packages/agent-session/examples/verify-hook-outcome-contract.ts` joins the existing family
  (`verify-offline.ts`, `verify-compaction-contract.ts`, `verify-session-record-field-preservation.ts`, all
  confirmed present). On the "could plausibly live in more than one place" clause specifically: the decoder is
  shared between an `agent-core` executor (http) and two `agent-framework` executors (prompt, agent), but its
  placement is forced rather than chosen — `agent-framework/package.json:64` and
  `agent-session/package.json:80` already declare `"@robota-sdk/agent-core": "workspace:*"`, so any other host
  would invert an existing dependency edge. A single admissible location is not a boundary decision. The change
  is an API modification within an existing package's existing public surface (delete `IHookResult`, export
  `THookOutcome` et al.), which the New-Surface rule does not govern. No `proposal-reviewer` ENDORSE and no
  `architecture-audit-fanout` structure-channel result is required, and their absence from this log is not a
  defect.
- Carried to GATE-IMPLEMENT, not resolved here: the tasks file at
  `.agents/tasks/SEC-015-hook-outcome-contract.md` does not exist as of this PASS, which is the correct state
  for `approved`. GATE-IMPLEMENT owns its creation and must check its own four criteria against it — including
  the `## Test Plan` ≥50 chars requirement [AF-24] — rather than inheriting anything from this entry.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-23

**Status upgrade:** approved → in-progress

- **Ordering — PASS.** Prior gate per gate-catalogue.md § Prior-gate map is GATE-APPROVAL, which shows
  ✅ PASS for this document (run-2 entry, 2026-08-23, opening this log's fourth block; the run-1
  NON-COMPLIANCE above it is retained as the record of that run and was remedied, not reargued). Input
  state matches the required `approved`: frontmatter reads `status: approved` and the file sits in
  `.agents/spec-docs/todo/`, which spec-workflow.md § Spec-Document Status and Lifecycle Folders maps to
  that status. Agreement verified mechanically, not by eye — `node scripts/harness/scan-doc-folder-status-agreement.mjs`
  → exit 0, "every spec document sits in the folder its status maps to (7 statuses)", violations=0.
- **NON-COMPLIANCE trigger ("implementation commits exist but no tasks file was created") — does not
  fire, on both halves.** No commits: `git log --oneline origin/develop..HEAD` empty at
  `f545c536e57c1c058a75898806bbcaeba565e4fa` on `fix/sec-015-hook-outcome-contract`;
  `git diff --name-only origin/develop...HEAD` empty; the same diff restricted to `packages apps` empty.
  No uncommitted code either: `git status --porcelain --untracked-files=all` returns exactly four entries —
  the two SEC-015 documents (untracked) and `.agents/evals/lessons/{auto-lessons,weekly-digest}.md`
  (harness-regenerated) — and filtering that list for `\.(ts|tsx|js|mjs|cjs)$` returns none, so no source
  file was created or edited and spec-workflow.md § User Request Implementation Gate is not breached. The
  three `scratch/src/sec-015-{repro.ts,repro-cmd.ts,probe-abort.mjs}` files are the gitignored repro probes
  verified at GATE-WRITE run 2 (mtimes 02:51–02:55, unchanged since); they drive the _shipped_ executors,
  so they are measurement, not implementation of this leaf. And the tasks file _was_ created, so the
  trigger's second clause is false independently.
- **Run-1 recurrence check — clean.** The GATE-APPROVAL run-1 violation was a task artifact authored
  _before_ its authorizing gate. Not repeated: `.agents/tasks/SEC-015-hook-outcome-contract.md` has mtime
  `2026-08-23 10:36:26`, after GATE-APPROVAL run 2 (whose own run-1 write is recorded at `10:29:44`), and
  it carries `status: todo` — not the `in-progress` that presumes this gate — with no `active/` pointer.
  `git log --all -- '.agents/tasks/SEC-015*'` is empty, so nothing was committed ahead of a gate either.
- Criterion 1, `.agents/tasks/<ID>.md` created — **met.** `find .agents/tasks -maxdepth 2 -iname '*sec-015*'`
  returns exactly one path, `.agents/tasks/SEC-015-hook-outcome-contract.md` (8630 bytes, untracked). The
  `<ID>-<slug>.md` form matches every other file in that directory, and there is no duplicate or stale copy
  under `completed/`.
- Criterion 2, path recorded in the spec's `## Tasks` — **met.** `## Tasks` (line 543) contains
  ``- [ ] SEC-015 — in-progress — `.agents/tasks/SEC-015-hook-outcome-contract.md` `` and nothing else; the
  `미생성 (GATE-APPROVAL 통과 후 생성)` placeholder is gone. The recorded path resolves to the file found in
  criterion 1. Verified as a like-for-line replacement rather than an untracked wider edit: every `##`
  heading offset above `## Evidence Log` (11, 107, 151, 262, 276, 295, 392, 429, 469, 489, 543, 547) is
  byte-for-byte the value the GATE-APPROVAL run-2 entry recorded, so no body line was added or removed
  outside the one-line swap.
- Criterion 3, tasks correspond to the Completion Criteria (≥1 task per TC-N) — **met, and verified by
  content per criterion rather than by count.** The task file's `## Plan` holds exactly 12 items with IDs
  TC-01…TC-12, no gap and no duplicate (`grep -o '^- \[ \] TC-[0-9]*'`), matching the spec's 12
  (`grep -c '^- \[ \] TC-'` → 12 on both files). Substance resolved one by one against `## Completion
Criteria`: TC-01 truthy-non-boolean `ok` ⇒ `error`/`malformed-response` (spec 431-433 ↔ plan 54-55);
  TC-02 the falsy/absent/non-object/`[]` direction, `error` and **not** `deny`, across http/prompt/agent
  (434-437 ↔ 56-58); TC-03 the full command exit map incl. `child.on('error')` ⇒ `spawn-failure` rather
  than a missing binary (438-443 ↔ 59-61); TC-04 the `node:http` transport map (444-447 ↔ 62-63, which is a
  superset — it adds the `timeout` row the spec's per-executor mapping table carries at line 364); TC-05
  `source` on all five executors (448-449 ↔ 64); TC-06 runner aggregation into `IRunHooksResult.errors`,
  absent when every hook decided (450-452 ↔ 65-66); TC-07 policy unchanged for outcomes the decoder does
  not reclassify (453-459 ↔ 67); TC-08 guardrail verdicts preserved (460-461 ↔ 68); TC-09 `IHookResult`
  gone not aliased (462-463 ↔ 69); TC-10 build+typecheck (464 ↔ 70); TC-11 the four `PASS` lines
  (465-466 ↔ 71); TC-12 `pnpm harness:scan` (467 ↔ 72). No plan item is an unmapped restatement and no TC-N
  is left without one.
- Criterion 4, `## Test Plan` (or `## Testing` / `## 검증`) with ≥50 chars [AF-24] — **met.** The task file
  carries `## Test Plan` at line 99; its content up to the next `##` measures **994 characters**, ~20× the
  50-char floor, and is substantive rather than padded: seven executable rows, each naming a command and
  the TC-N it discharges (`pnpm --filter @robota-sdk/agent-core test src/hooks`, the `integration.test.ts`
  run, the agent-framework and agent-session suites, the TC-09 `grep`, `pnpm build && pnpm typecheck`,
  `pnpm harness:scan`). Recorded so a later gate is not misled: the catalogue's parenthetical rationale
  ("else `harness:scan` fails") no longer holds for a file under `.agents/tasks/` —
  `scripts/harness/scan-test-plan.mjs` documents at lines 49-65 that it deliberately does **not** scan that
  directory since PROC-006. The criterion itself is unaffected and was applied as written; only its stated
  mechanical backstop has moved (to `scan-unearned-done-claims` at DONE time). The scan was run anyway and
  passes on the spec-doc's new home: `node scripts/harness/scan-test-plan.mjs` → exit 0, 31 documents,
  5 live across `backlog/todo/active`.
- **`## The mutant this must kill` — judged, not accepted. The reasoning holds and TC-06 is not
  decorative.** Three sub-claims checked against source: (i) _an `error` legitimately does not block within
  this leaf_ — confirmed against `## Boundary` (line 278, "`deny` blocks, `allow` and `error` do not,
  exactly as today") and against the shipped runner, where `hook-runner.ts:180` is literally
  `if (result.exitCode !== 0) continue;` and the only two `blocked: true` returns are the `exitCode === 2`
  branch (168) and the `continue: false` / `permissionDecision` protocol branches (183-252). (ii) _asserting
  `blocked` therefore cannot catch a fold_ — correct: with `error` folded into `allow`, every enforcing path
  yields the same `blocked` value as correct code, because none of the six `THookErrorKind` cases produces
  stdout that parses to a deny protocol. (iii) _TC-06 goes red against the folded implementation_ — yes, and
  at either fold site. If an executor returns `allow` in place of `error`, or if the runner receives `error`
  and treats it as allow, `IRunHooksResult.errors` is left `undefined` in both, so TC-06's
  `errors.length === <n>` fails for any n ≥ 1. Kill point 1 alone is sufficient. Kill point 2 is
  independently real as well: `stdoutParts.push(result.stdout.trim())` sits at `hook-runner.ts:275`, on the
  exit-0 path only, so a folded outcome would contribute stdout that a correct `error` must not. The
  section's "checked rather than assumed" claim was itself re-checked and is accurate:
  `packages/agent-session/src/__tests__/selfhost-009-pretooluse-gate.test.ts` holds exactly three cases
  (exit-2 blocks with `expect(underlying).not.toHaveBeenCalled()` at :92, `permissionDecision:"deny"` blocks
  at :109, exit-0 runs at :129) and no error case at all — `grep -n exitCode` on it returns only `2`, `0`,
  `0`, so the property genuinely has zero coverage today.
- Two nuances recorded against the mutant section, neither a criterion breach: (a) it states both kill
  points are "asserted in TC-06", but the spec's TC-06 text (450-452) requires only kill point 1 — the
  no-stdout-from-an-errored-hook assertion is not pinned by any TC, so dropping it during implementation
  would still pass GATE-COMPLETE. Non-blocking because kill point 1 alone kills the mutant. (b) the claim
  "the same `blocked` value on every enforcing path" is exactly true for the six enumerated error kinds; a
  contrived hook that both fails _and_ prints a valid `{"continue": false}` would flip `blocked` under a
  fold. Neither is a case this leaf enumerates.
- **Finding recorded for the implementer — a migration-surface file the enumeration misses, non-blocking.**
  `packages/agent-core/src/hooks/__tests__/selfhost-009-single-path-neutrality.test.ts` appears in neither
  the spec's `## Affected Files` brace list (416) nor the task's migration surface, and it will go red on
  this change: it reads `hook-runner.ts` as text and asserts `expect(runner).toMatch(/exitCode\s*===\s*2/)`
  (line 51, "has a single block contract … driven by exitCode 2"), which is precisely the branch
  `outcome === 'deny'` replaces. Because it is a source-text assertion and not a type error, **TC-10
  (`pnpm build && pnpm typecheck`) will not catch it**; TC-01's `pnpm --filter @robota-sdk/agent-core test
src/hooks` will, since the file lives under that path. Not a FAIL under any criterion this gate owns —
  criterion 3 governs TC-N correspondence, not the completeness of the affected-file enumeration — and it
  is discharged by a criterion that already exists. Separately verified as correct: the task's "13 files
  hold a hand-rolled `IHookTypeExecutor`" is exactly right for the command it cites —
  `git grep -ln IHookTypeExecutor -- 'packages/**/*.test.ts' 'packages/**/examples/**'` returns 13.
- Ancillary scans run on the current tree, both green, neither a criterion of this gate:
  `node scripts/harness/check-backlog-placement.mjs` → exit 0, "backlog-placement scan passed";
  `node scripts/harness/scan-doc-folder-status-agreement.mjs` → exit 0, violations=0.

### [GATE-VERIFY] — ✅ PASS | 2026-08-23

**Status upgrade:** in-progress → verifying

- **Ordering — PASS.** Prior gate per gate-catalogue.md § Prior-gate map is GATE-IMPLEMENT, which
  shows ✅ PASS for this document (entry immediately above, 2026-08-23). Input state matches the
  required `in-progress`: frontmatter reads `status: in-progress` and the file sits in
  `.agents/spec-docs/active/`, the folder spec-workflow.md § Spec-Document Status and Lifecycle
  Folders maps to that status. Checked mechanically, not by eye —
  `node scripts/harness/scan-doc-folder-status-agreement.mjs` → exit 0, violations=0, "7 statuses".
- **Merge-before-this-gate — inspected, does not fire a NON-COMPLIANCE.** The implementation is
  already on `origin/develop`: PR #2193 (`gh pr view 2193` → state MERGED, head
  `999dfa738c527ee782355662bd435ce21d70a156`, mergeCommit `4db0235c4`, mergedAt 2026-08-23T02:55:52Z),
  and `4db0235c4` is `origin/develop`'s head. This branch (`chore/complete-sec-015`) sits exactly on
  it: `git log --oneline origin/develop..HEAD` is empty and `git diff --name-only origin/develop...HEAD`
  is empty, so what I judged is the merged tree byte-for-byte. That is not a bypass of THIS gate:
  the work was authorized by GATE-IMPLEMENT (which passed), GATE-VERIFY authorizes only the
  `in-progress → verifying` transition, and neither gate-catalogue.md nor `backlog-pipeline` §
  State Machine places a merge inside the gate order. Recorded because the ordering it does affect
  is GATE-COMPLETE's, not this gate's.
- Criterion 1, all tasks in `.agents/tasks/SEC-015-hook-outcome-contract.md` marked `[x]` — **met.**
  `grep -n '^\s*- \[.\]'` over that file returns exactly 12 checkbox lines, TC-01…TC-12 at lines
  53, 55, 58, 61, 63, 64, 66, 67, 68, 69, 70, 71, every one `- [x]`, no gap and no duplicate ID.
  `grep -c '^\s*- \[ \]'` → 0: the file contains no unchecked checkbox at all.
- Criterion 2, no task blocked or pending — **met.** The only `blocked`/`pending`/`Pending` hits in
  the file are prose, checked one by one and none of them an open work item: lines 28/34/83–85/113 and
  166–168/179–181 discuss the `IRunHooksResult.blocked` field and the scenario's expected `PASS`
  lines; `### Pending verification owned by a later leaf` (line 194) explicitly assigns the
  fail-closed verification to issue #2093 and states this Task "does not deliver … and does not claim
  it", which is a scope exclusion, not a blocked item of this Task. No `TODO`/`WIP` marker anywhere.
- Criterion 3, build passes for all affected packages — **met, re-run rather than accepted.**
  `pnpm build` at `4db0235c4` → **exit 0**, "Build complete", "✓ All build:types complete." (only
  pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` rolldown advisories, unrelated to this change). The four
  affected packages (`agent-core`, `agent-framework`, `agent-session`, `agent-executor`, per
  `## Affected Scope`) are all inside that workspace build. Corroborated independently by CI on
  PR #2193: `gh pr checks 2193` → `build pass`, `quality pass`, `examples-typecheck pass`,
  `windows-shell pass`, `scans pass`, `regression-red-proof (enforcing: accidental-green only) pass`,
  CodeQL/`Analyze (javascript-typescript)` pass — 21 `pass`, 5 `skipping`, **0 fail**.
- Criterion 4, tests pass for all affected packages — **met, re-run rather than accepted.**
  `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-framework --filter
@robota-sdk/agent-session --filter @robota-sdk/agent-executor test` → **exit 0**: agent-core 94 files
  / 1163 tests, agent-framework 186 / 1456, agent-session 46 / 321, agent-executor 14 / 104 — all
  passed, none failed. The hooks subset the Task's evidence names was re-run separately:
  `pnpm --filter @robota-sdk/agent-core exec vitest run src/hooks` → exit 0, **9 files / 104 tests**.
  Recorded as a discrepancy rather than smoothed over: the Task's `## Engineering verification
evidence` records "9 files, 97 tests" and "agent-core 1156, agent-session 244". The file count
  matches; the test counts are higher now because those figures were captured on
  `fix/sec-015-hook-outcome-contract` before the squash landed on a develop that has advanced. Both
  numbers are green in both readings, so the claim is corroborated in direction and superseded in
  magnitude. No `it.skip`/`describe.skip`/`it.todo` exists in the hooks suites (the one `skipIf` in
  `agent-session` is a platform guard in `external-payload-descriptor-stability.test.ts`, unrelated).

**Completion criteria spot-checked against the merged code, as instructed — verified, not accepted.**
These are GATE-COMPLETE's criteria, not this gate's; they are recorded here because the check was run.

- TC-06 — **genuinely met, not merely ticked.** `hook-runner.ts` collects `const errors:
IHookErrorOutcome[]` and pushes on the single `outcome.outcome === 'error'` branch; `diagnostics()`
  spreads `...(errors.length > 0 && { errors: [...errors] })`, so the field is present with content
  when a hook failed and **absent** (not `[]`) when every hook decided, and it is carried on every
  return path including the four early blocking returns. `IHookErrorOutcome` carries `kind`, `reason`
  and `source`. The assertions exist and are green: `integration.test.ts:246` (`errors` with kind,
  reason, source), `:261` (`errors` is `undefined` when every hook rendered a verdict), `:277` (an
  errored hook contributes NO stdout), `:301` (several failures, in order), `:322` (error still
  reported when a LATER hook blocks), `:350` (TC-07 deny blocks / error does not). The mutant claim
  holds by construction: folding `error` into `allow` removes the only `errors.push`, so
  `result.errors` is `undefined` and `:246`/`:301` go red while every `blocked` assertion stays green.
- TC-09 — **genuinely met.** `grep -rn "IHookResult" packages apps --include=*.ts` → **exit 1, zero
  matches**; `git grep -n IHookResult -- 'packages/**' 'apps/**'` returns only two historical
  mentions in `packages/agent-core/docs/SPEC.md` (lines 137, 475), both inside `docs/`, which the
  criterion permits. `git show origin/develop:packages/agent-core/src/hooks/types.ts | grep -c
IHookResult` → 0. The type is deleted, not aliased or re-exported: nothing named `IHookResult`
  survives in any `.ts` file in the workspace.

**`## Boundary` judged against the merged code, as instructed — the disclosure is accurate in the
fail-open direction; two accuracy gaps recorded, neither of them a criterion of this gate.**

- **The explicit-denial regression is really fixed.** `verdict-decoder.ts` consults
  `explicitBlockDirective` (`response-protocol.ts:44-65`) BEFORE returning `error` for an undecodable
  `ok`, and returns `deny` when the same body carries `continue: false`, `decision: "block"`, or
  `hookSpecificOutput.permissionDecision: "deny"`. Verified against the pre-merge code at
  `origin/develop^` (`6fb4fe92a`): `{"ok":"false","continue":false}` used to block by the LONG route —
  old `http-executor.ts` bare-cast `!body.ok` with a truthy `"false"` → `exitCode: 0`, `stdout:
JSON.stringify(body)` → `hook-runner` `json['continue'] === false` → `blocked: true`. It blocks by the
  short route now (`deny`), so the previously-blocking behaviour is preserved rather than restored by
  accident. Covered by tests at `verdict-decoder.test.ts:126-170`, including the negative case
  (`permissionDecision: "allow"` must NOT be read as a block).
- **No other previously-blocking path silently stopped blocking.** Enumerated old→new across all five
  executors, source-to-source: `command` exit 2 ⇒ deny (both); `command` exit 0 + stdout directive ⇒
  runner protocol (both, unchanged); `guardrail` `pass:false` / thrown / unknown-named ⇒ deny (both —
  the only guardrail change is the defensive mis-dispatch branch, exit-0 → `error`, non-blocking
  either way); `http`/`prompt`/`agent` `ok === false` ⇒ deny (both); `http`/`prompt`/`agent`
  truthy-`ok` + explicit directive ⇒ blocked (both, via the runner then, via `explicitBlockDirective`
  now). The residue is exactly one class: a falsy-but-not-`false` `ok` (`{}`, `{"ok":null}`, `{"ok":0}`),
  a non-object, or non-JSON, **with no explicit block directive** — old `deny`, new `error`. That is
  the one `## Boundary` discloses. The disclosure matches reality.
- **Gap 1 (conservative, not fail-open).** `## Boundary` says the coerced-`deny` cases move "out of
  the blocking set" without qualification, and `## Solution` § The verdict decoder still states the
  pre-fix rule verbatim ("anything else — a non-object, a missing `ok`, a non-boolean `ok` — → `error`").
  Neither mentions the `explicitBlockDirective` carve-out that the shipped decoder actually applies,
  so a body like `{"ok":null,"continue":false}` still blocks though the document implies it does not.
  The document therefore over-states the removal, which errs safe. Related: `## Affected Files` lists
  16 paths while the merged diff is 37, and omits the two new modules the fix introduced —
  `packages/agent-core/src/hooks/response-protocol.ts` and `hook-matching.ts` — plus
  `packages/agent-core/README.md`.
- **Gap 2 (undisclosed, and it is an INCREASE in blocking).** `explicitBlockDirective` honours
  `decision: "block"` and `hookSpecificOutput.permissionDecision: "deny"` on **every** event, whereas
  `hook-runner.ts` honours the first only on `UserPromptSubmit` and the second only on `PreToolUse`.
  So a malformed-`ok` body carrying `decision: "block"` on, e.g., `PreToolUse` blocks now and did not
  before. Narrow (reachable only when `ok` is undecodable) and fail-closed, but it is an
  enforcement-visible change beyond the "ONE" `## Boundary` claims. Second-order: the new `deny` path
  returns no `permissionDecision: 'deny'` on `IRunHooksResult` where the old stdout route did.
- Disposition: neither gap is a GATE-VERIFY criterion — this gate owns task completion, build and
  test — and neither is a false claim of work done, so neither is a NON-COMPLIANCE. Both are recorded
  for GATE-COMPLETE / a follow-up leaf to dispose of. Fixing them is not this gate's job.

**Two findings the next gate must not inherit as satisfied.** Neither is a GATE-VERIFY criterion; both
are GATE-COMPLETE criteria and will FAIL there in the document's current state.

1. The spec's `## Completion Criteria` TC-01…TC-12 (lines 443-479) are ALL still `- [ ]` — unchecked.
   `grep -c '^- \[x\] TC-'` → 0. Only the Task's `## Plan` is ticked. GATE-COMPLETE requires every
   spec checkbox `[x]` plus a `[GATE-COMPLETE: TC-N]` evidence entry per criterion; none of the
   twelve exists yet.
2. The spec's `## Tasks` line still reads ``- [ ] SEC-015 — in-progress — `.agents/tasks/SEC-015-hook-outcome-contract.md` ``
   while that task file's frontmatter reads `status: in-progress`. The path is correct and the file
   exists; the inline status and checkbox are stale.

### [GATE-COMPLETE] — 🔴 NON-COMPLIANCE | 2026-08-23

**Status remains:** in-progress

**Violation:** This gate was dispatched against a document whose recorded state is not this gate's
input state. gate-catalogue.md § Prior-gate map requires GATE-COMPLETE's input to be `verifying`.
The frontmatter reads `status: in-progress` — line 2 of the file, unchanged in the working tree and
identical at HEAD (`git show 4db0235c4:.agents/spec-docs/active/SEC-015-hook-outcome-contract.md`
→ `status: in-progress`). The token `verifying` occurs nowhere in the frontmatter; its only three
occurrences in the whole file are inside evidence prose (lines 667, 1015, 1030), one of which is the
GATE-VERIFY entry's own `**Status upgrade:** in-progress → verifying`. That upgrade was declared by a
passing gate and never written to the document.

- **Ordering check, half 1 (prior gate shows PASS) — MET.** GATE-VERIFY shows ✅ PASS for this
  document, dated 2026-08-23, at line 1013. Its verdict is not disputed here and its criteria (task
  completion, `pnpm build`, `pnpm test`) are not re-litigated by this entry.
- **Ordering check, half 2 (recorded state matches expected input) — NOT MET.** Required `verifying`;
  found `in-progress`. `in-progress` is GATE-IMPLEMENT's output and GATE-VERIFY's input, i.e. the
  document still records that the work is under way, one transition short of the state from which a
  document may be closed.
- **Why no mechanical scan caught this.** spec-workflow.md § Spec-Document Status and Lifecycle
  Folders maps BOTH `in-progress` and `verifying` to `.agents/spec-docs/active/` ("no folder change").
  The file's placement therefore agrees with either status and
  `scan-doc-folder-status-agreement.mjs` stays green — as the GATE-VERIFY entry records it did. The
  folder is correct; the status field is not. A status ambiguity the folder cannot express is exactly
  what the ordering check exists to catch and what the scan structurally cannot.
- **Pipeline consequence.** `backlog-pipeline` § State Machine dispatches by current `status`: at
  `in-progress` the next action is GATE-VERIFY; GATE-COMPLETE is dispatched only from `verifying`.
  This run is an out-of-order dispatch under the pipeline's own routing table.
- **Where the missing step belongs.** Not to this guard and not to GATE-VERIFY's guard: a status
  change follows a verdict and is never part of one (gate-catalogue.md § Post-PASS handoff states the
  same for this gate's own `verifying → done`). The write is an orchestrator output owed on the
  GATE-VERIFY PASS, and it was skipped.

**Criteria deliberately NOT evaluated.** Per the ordering rule, this run stopped before any
GATE-COMPLETE criterion. Nothing in this entry certifies, in whole or in part: the twelve
`## Completion Criteria` checkboxes, the existence of any `[GATE-COMPLETE: TC-N]` entry, the
`## Test Plan` test references or skip reasons, the `## Tasks` row, or the completeness of the
`## Boundary` disclosure. Two checks requested of this run were **not** performed and must be
performed from scratch on re-dispatch: (i) an independent old-vs-new re-derivation of the
enforcement-visible change classes against the merged code at `4db0235c4`, and (ii) execution of
TC-05 (`source` on every outcome across all five executors) and TC-12 (`pnpm harness:scan`).
GATE-VERIFY's Gap 1 / Gap 2 findings and its enumeration are that gate's record and carry no
GATE-COMPLETE result; the edits made in response to them are unjudged as of this entry.

**Required action:** Record `status: verifying` in the frontmatter as the deferred output of the
GATE-VERIFY PASS. No folder move accompanies it — `verifying` maps to `.agents/spec-docs/active/`,
where the file already sits. Then re-dispatch GATE-COMPLETE, which will evaluate all criteria fresh.
The write must not be folded into the closing commit or applied retroactively alongside a `done`
status: GATE-COMPLETE cannot carry a document to `done` from a recorded `in-progress`, and a single
commit that moves `in-progress → done` erases the transition this gate is defined to sit on.
