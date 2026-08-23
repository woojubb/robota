---
title: 'SEC-016: per-event fail-closed and advisory hook policy'
status: in-progress
created: 2026-08-23
priority: critical
urgency: now
area: agent-core, agent-session, scripts/harness
depends_on: []
---

Registered as GitHub issue #2093 (execution leaf of tracker issue #2075, unblocked by issue #2083).

Paired spec-doc: `SEC-016-per-event-hook-enforcement-policy.md` under `.agents/spec-docs/` — the
measured baseline, the alternatives, the decision and the prior-art comparison live there. Its
lifecycle folder tracks its gate status and is deliberately not hardcoded here. This file is the
problem record and the verification plan; it does not restate the design.

## Problem

Issue #2083 made a failed hook representable — `runHooks` returns `IRunHooksResult.errors`, each
carrying a `kind` and the `source` executor — and nothing consumes it.
`packages/agent-session/src/tool-hook-helpers.ts:69` reads `if (hookResult.blocked)` and nothing
else, so at the enforcement boundary a `PreToolUse` hook that timed out, could not spawn, or answered
with an undecodable body is indistinguishable from one that approved.

Measured against `origin/develop@36090e2e6`: of the sixteen `THookEvent` members, **one** can block.
The other fifteen are advisory by construction — seven fire `void`, five are called without `await`,
and three await a result they never inspect for `blocked`. So the policy table this issue asks for
would be fifteen-sixteenths inert, and unfalsifiable in the direction that matters: marking a
sixteenth event `enforcing` would change nothing while reading as though it had.

## Scope

In: the per-event posture table, the `enforcementReachable` field that records whether a row's fire
site can honour an enforcing posture, a harness scan that refuses a dishonest row, and making
`PreToolUse` deny on `error`, timeout and unknown executor.

Out: converting any advisory fire site into an enforcing one (Alternative B, declined — it changes
product behaviour at eleven call sites); startup validation of executor reachability (issue #2099);
operator-configurable posture (Alternative D, deferred to a sibling under tracker issue #2075).

## Plan

One item per Completion Criterion in the paired spec.

- [x] TC-01 — a `PreToolUse` hook whose process cannot start blocks; the wrapped tool's `execute` is
      never called.
- [x] TC-02 — the same for a timeout and for a non-boolean `ok`; both blocked where both previously
      allowed.
- [x] TC-03 — an unknown hook type blocks on `PreToolUse` and does not on `PostToolUse`.
- [x] TC-04 — the denial reason names the failure `kind` and the `source` executor.
- [x] TC-05 — the fifteen advisory events are unchanged.
- [x] TC-06 — the policy has exactly one entry per `THookEvent` member, asserted against the union.
- [x] TC-07 — the reachability scan exits 0 clean, non-zero on a dishonest row, non-zero on an
      unresolvable fire site, and non-zero on a policy with zero `enforcing` rows. **This carries the
      wide mutant** (see below).
- [x] TC-08 — everything that blocked before still blocks.
- [x] TC-09 — `pnpm build && pnpm typecheck` exit 0.
- [x] TC-10 — `pnpm harness:scan` exits 0 with the new scan present in its output.
- [ ] TC-11 — the user-execution scenario runs: denied run carries `spawn-failure`/`command`/the
      hook path, allowed run carries none, both exit 0.
- [x] TC-12 — the table-internal invariant: `posture: 'enforcing'` with
      `enforcementReachable: false` is rejected, asserted independently of the scan.

## The mutant this must kill

A policy table is worthless if it can assert a posture the code cannot honour. The mutant has two
forms, and an earlier version of this section claimed TC-07 kills both. It does not — the
GATE-IMPLEMENT guard decomposed it, and the distinction changes what has to be tested.

**Narrow form: `posture` flipped to `enforcing`, `enforcementReachable` left `false`.** The row is
now self-contradictory, and catching it needs no scan at all — a table-internal invariant does it.
That invariant was not stated as a criterion, so TC-12 now states it.

**Wide form: both fields flipped together.** The row is internally consistent and asserts a gate that
does not exist. Nothing behavioural catches this: `isEnforcing` is consulted only at
`tool-hook-helpers.ts`, the only site in the tree that reads a `runHooks` result's `blocked`, so a
flipped posture on any other event reaches no branch. TC-01/02/03/04/08 all drive `PreToolUse`; TC-06
asserts only cardinality; and **TC-05 is a negative assertion — "no denial, no thrown error" — which
the mutant satisfies.** This is TC-07's unique load.

One design consequence worth recording rather than discovering later: the finding is contingent on
placement. If the posture check were centralised inside `runHooks` instead of at the enforcement
boundary, TC-05 would become the catcher and TC-07's unique load would shrink. The design keeps it at
the boundary — the runner must not decide policy — so the scan is what carries it.

**The scan's own failure modes matter as much as the mutant.** Three ways it could report green
having checked nothing, all of which TC-07 asserts against:

1. A fire site it cannot resolve is **failed**, never skipped. The precedent is `commitlint` in
   `.github/workflows/ci.yml:783-807` (INFRA-058), whose comment records the measured case: `set -e`
   does not fire on a command substitution used as a word-list, so an unresolvable range produced an
   empty list, the loop body never ran, and a required check reported green having linted nothing.
2. A policy that parses but contains **zero** `enforcing` rows is failed, not passed. `commitlint`
   guards this arm too — it refuses a range that resolves but is empty, on the reasoning that a
   degenerate range is not a clean one. A policy with no enforcing row is the same shape.
3. The scan declares what it examined, so "checked and clean" is distinguishable from "found nothing
   to check" in its own output.

## Engineering verification evidence

Recorded 2026-08-23 on branch `fix/sec-016-per-event-hook-enforcement`, base `origin/develop@87d1caf8d`:

- `pnpm typecheck` — 0 errors. `pnpm build` — exit 0.
- `pnpm harness:scan` — 142 passed, 2 skipped, 0 failed, including the new
  `hook-enforcement-reachable`.
- Suites: agent-core 1172, agent-session 338, agent-framework 1508, agent-executor 104, harness 4874
  — all passing.
- **Red proof (TC-01…TC-05).** Reverting only the enforcement block in `tool-hook-helpers.ts` turns
  five tests red. The mutation was confirmed applied before the result was read (`grep -c SEC-016`
  → 0), because a mutation test whose mutation silently failed to apply reports the reassuring
  answer:

  ```
  × TC-01 … → expected null not to be null
  × TC-02 … → timeout should block: expected null not to be null
  × TC-04 … → timeout reason should name the kind: expected '' to contain 'timeout'
  × TC-03 … → expected null not to be null
  × TC-05 … → expected null not to be null
  ```

  `null` is the pre-fix return for "proceed", so each red is the tool call being allowed.

- **Scan mutants (TC-07).** Each of the three broken policies is rejected with a distinct finding
  naming the event: the wide mutant → `[inert-enforcing-row]`, the narrow → both
  `[inert-enforcing-row]` and `[reachability-contradiction]`, a zero-enforcing policy →
  `[no-enforcing-rows]`. An unparseable policy, a missing policy file, and an empty fire-site
  enumeration each fail rather than report clean.
- **Table invariant (TC-12).** `assertPolicyCoherent` rejects the narrow contradiction independently
  of the scan, and names every dishonest row rather than the first.

## Test Plan

Engineering verification. The spec's `## Test Plan` table is the owner; this is the execution record.

- `pnpm --filter @robota-sdk/agent-core exec vitest run src/hooks` — the policy table and its
  exhaustiveness against the `THookEvent` union (TC-06).
- `pnpm --filter @robota-sdk/agent-session exec vitest run` — the enforcement boundary: TC-01 through
  TC-05 and TC-08, at `tool-hook-helpers.test.ts` and `selfhost-009-pretooluse-gate.test.ts`.
- `node scripts/harness/scan-hook-enforcement-reachable.mjs` clean, plus its own test running it
  against two deliberately broken policy fixtures (TC-07).
- `pnpm build && pnpm typecheck` (TC-09).
- `pnpm harness:scan` (TC-10).

## User Execution Test Scenarios

**The surface is the Robota CLI, unlike SEC-015.** That leaf added a field nothing read, so it had no
CLI-observable manifestation. This leaf's deliverable IS the observable: a tool call that previously
ran now stops, and the user sees the denial and its reason.

A `PreToolUse` hook fires only behind a model-issued tool call, which normally needs provider
credentials — but `packages/agent-provider-replay` replays recorded provider responses including tool
calls, and `packages/agent-cli/src/cli.ts:254` wires it behind `--session-log` so a session runs with
"no key is ever used". SEC-015's record wrongly asserted no such path existed; this scenario uses it.

### Scenario 1 — a hook that cannot evaluate stops the tool call

- **Agent-executability:** `agent-executable`.
- **Prerequisites:** a built workspace (`pnpm install && pnpm build`). No API key, no network egress.
  A recorded session log containing a tool call, shipped with this work as a fixture. A temp project
  whose `.robota/settings.json` declares a `PreToolUse` command hook pointing at a path that does not
  exist.
- **Exact commands.** These are the commands as RUN, not as imagined — the earlier version named a
  fixture path that does not exist and used fences that did not render. `robota` is not on `PATH` in
  this repo (`command -v robota` exits 1, `node_modules/.bin/robota` is absent), and Volta resolves
  Node through `HOME`, so the real Node binary is captured before `HOME` is overridden.

```bash
REPO="$(git rev-parse --show-toplevel)"
CLI="$REPO/packages/agent-cli/bin/robota.cjs"
FIXTURE="$REPO/packages/agent-cli/src/__tests__/e2e/fixtures/sec-016-tool-call.jsonl"
REALNODE="$(node -e 'console.log(process.execPath)')"   # not the Volta shim

TMP="$(mktemp -d)"; HOMEDIR="$TMP/home"; mkdir -p "$HOMEDIR/.robota" "$TMP/proj"
echo "SEC-016 probe" > "$TMP/proj/SEC-016-PROBE.txt"

# A provider profile must exist even for replay: config-loader.ts throws "currentProvider is
# required" without one. `--session-log` swaps in the replay provider, so no key is ever used.
cat > "$HOMEDIR/.robota/settings.json" <<'JSON'
{ "currentProvider": "anthropic",
  "providers": { "anthropic": { "type": "anthropic", "model": "claude-test-model", "apiKey": "sec016-dummy-key" } },
  "hooks": { "PreToolUse": [ { "matcher": "",
    "hooks": [ { "type": "command", "command": "/nonexistent/sec-016-hook" } ] } ] } }
JSON

cd "$TMP/proj"
HOME="$HOMEDIR" "$REALNODE" "$CLI" -p "read the probe file" \
  --output-format stream-json --no-session-persistence --session-log "$FIXTURE"
echo "denied-run exit=$?"

# Contrast: the SAME settings minus the hooks block, so the provider profile survives. Deleting
# .robota outright would trip "currentProvider is required" and prove nothing about the gate.
python3 - "$HOMEDIR/.robota/settings.json" <<'PY_INNER'
import json, sys
p = sys.argv[1]; d = json.load(open(p)); d.pop("hooks", None); json.dump(d, open(p, "w"))
PY_INNER
HOME="$HOMEDIR" "$REALNODE" "$CLI" -p "read the probe file" \
  --output-format stream-json --no-session-persistence --session-log "$FIXTURE"
echo "allowed-run exit=$?"
rm -rf "$TMP"
```

- **Expected observable result.** The denied run's `stream-json` output contains a tool result whose
  text carries all three of `spawn-failure`, `command`, and `/nonexistent/sec-016-hook` — the failure
  kind, the source executor, and the hook that could not evaluate. The allowed run's output contains
  none of those and instead shows the tool result the fixture records. Both runs exit `0`: the tool
  call is denied, the SESSION is not, and asserting a non-zero exit would be asserting a behaviour
  this leaf does not deliver.

The contrast is the observable. One run alone could be explained by the fixture; the pair cannot.

- **Cleanup:** the scenario removes its temp project.
- **Evidence: TC-11 AS SPECIFIED IS UNMET — its surface is the CLI and no CLI run was achieved.**
  The Task stays `in-progress` because of it. But a product-surface scenario DID execute and does
  demonstrate this leaf's behaviour, and recording only "unmet" would understate what is verified.

  **What executed.** `pnpm --filter @robota-sdk/agent-session scenario:verify` — the SDK-surface
  chain — refused the push until it was updated, because SEC-015's scenario asserted the behaviour
  this leaf changes. Under SEC-015 alone the two error cases printed "tool NOT blocked"; they now
  block. After updating the expectations to the shipped behaviour:

  ```
  PASS deny: tool blocked, reason="SEC-015 scenario: denied by command hook"
  PASS error/spawn-failure: tool BLOCKED, error reported (source=command)
  PASS error/malformed-response: tool BLOCKED, error reported (source=http)
  PASS allow: tool executed
  SEC-015 hook outcome contract scenario passed.
  ```

  That drives the real `PermissionEnforcer.wrapTools` boundary and `runHooks`, and the two BLOCKED
  lines are exactly what SEC-016 delivers — a tool call stopped because its hook reached no verdict,
  with the failure kind and source named. It is a genuine end-to-end demonstration.

  **Why that does not tick TC-11.** The criterion names the CLI, and the reason it does is recorded
  above: this leaf's deliverable IS CLI-observable, unlike SEC-015's. Ticking it on a different
  surface would be moving the criterion to fit what I could run, which `backlog-execution.md`
  forbids in spirit even though its literal prohibition is about rewriting an expected RESULT. The
  criterion stands as written and unmet; the SDK evidence is recorded beside it rather than in place
  of it.

  **A consequence worth flagging beyond this leaf.** SEC-015's own user-execution evidence, recorded
  in `.agents/tasks/completed/SEC-015-hook-outcome-contract.md`, quotes the pre-SEC-016 output and is
  now historically true but behaviourally stale. It is left as recorded — a closed record is a
  record of what was observed then — and this note is where a reader learns the behaviour moved.

  **What could not be produced:**

  The scenario was attempted against the completed implementation and did not execute. The replay
  fixture is correct in isolation — `createReplayProviderFromNodeLogFile` yields the recorded tool
  call, verified directly:

```

recorded responses: 2
response 1: role=assistant content=null toolCalls=[{"id":"call-1","type":"function",
"function":{"name":"Read","arguments":"{\"filePath\":\"SEC-016-PROBE.txt\"}"}}]
response 2: role=assistant content="SEC_016_TURN_COMPLETE" toolCalls=NONE

```

Driving the same fixture through the real CLI completes the turn and emits only `text_delta` /
`content_block_delta` — no tool event, so the tool never runs and no `PreToolUse` hook fires.
`Read` is the correct registered name (`packages/agent-tools/src/builtins/read-tool.ts:178`).

**Recorded as unmet rather than ticked on a run that proves nothing.** A scenario whose turn
succeeds without executing the tool exercises none of the behaviour this leaf delivers; asserting
"the run succeeded" would pass for the same reason a correct run would. That is not a scenario
needing a final touch — it is a scenario that does not yet exist.

Blocker filed as **issue #2225**, which states what is established and — deliberately — what is
not: I did NOT determine why the tool call goes undispatched, so whether this is a product
testability gap or an error in this setup is undetermined. The fixture is committed at
`packages/agent-cli/src/__tests__/e2e/fixtures/sec-016-tool-call.jsonl` so whoever resolves it does
not rebuild it.

Consequence for this record: `backlog-execution.md` § Done Gate forbids `status: done` while a
scenario is unexecuted, so this Task remains `in-progress` after its PR merges. The two are
different gates.
