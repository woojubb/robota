---
title: 'CORE-049: permission patterns match by argument kind'
issue: https://github.com/woojubb/robota/issues/2350
status: in-progress
created: 2026-08-29
priority: high
urgency: now
area: packages/agent-core
depends_on: []
---

# CORE-049: permission patterns are globbed over the raw argument, whatever kind of argument it is

## Problem

`globToRegex` in `packages/agent-core/src/permissions/permission-gate.ts:41-47` turns `*` into `.*`
and `**` into `.+` with no delimiter excluded, and `matchesPattern` (`:176-195`) anchors the result
against the tool's primary argument as a raw string. One matcher serves every argument kind: a
`WebFetch` URL, a `Read`/`Write`/`Edit` path, a `Bash` command. For a URL that is not a wildcard
over hostnames — it is a wildcard over the whole URL, and the matched text can live in the query,
the fragment, the userinfo or the path, none of which is the host the operator meant.

## Evidence

Measured 2026-08-29 on `origin/develop` `dd46c9183`, the shipped function copied verbatim:

```
pattern: https://*.example.com/**
MATCH   https://sub.example.com/ok                      ← intended
MATCH   https://evil.tld/?a=.example.com/x              ← query carries the match
MATCH   https://evil.tld/#.example.com/x                ← fragment carries the match
MATCH   https://169.254.169.254/?x=.example.com/y       ← cloud metadata endpoint
MATCH   https://evil.tld/.example.com/x                 ← path carries the match
```

An operator who writes `WebFetch(https://*.corp.example.com/**)` has written a pattern that matches
every host an attacker can name, including the link-local metadata service. Today `WebFetch` is
`inspect`, which every mode resolves to `auto` (`permission-mode.ts:62-66`), so the allow side changes
nothing yet — the exposure materialises the moment issue #2026 reclassifies `WebFetch`; the DENY side is
live now: a deny written to stop a host is bypassed by a shorthand IP or by placing the matched text
in the query. The same shape holds for paths: `Read(/home/me/**)` is a wildcard over a string, and
`Read(/src/*)` matches `/src/a/b/c` because `*` crosses `/`. Tool profiles today declare only
`argumentKey` (`agent-tools/src/tool-permission-profiles.ts`, `agent-framework/src/tools/…`), so
the gate has no way to know what kind of thing it is matching.

## Reproduction condition

Any allow or deny pattern with a wildcard, evaluated against an argument whose delimiters the
wildcard is allowed to cross: every `WebFetch(scheme://host…)` pattern, every path pattern with `*`.

## Depth

Root, not symptom: one function serving paths, URLs and commands is how this happened (the issue's
own analysis, and finding-depth.md — the egress boundary of issue #2026 is reachable only because
this exists and declares `depends_on` this item). The fix is in the foundation package the gate
lives in and in the profiles the tool packages contribute.

## Test Plan

- TC-01, TC-02, TC-03 — URL matcher: `https://*.example.com/**` matches `https://sub.example.com/ok` and refuses the four
  placements from the evidence (query, fragment, path, metadata host) plus userinfo
  (`https://sub.example.com@evil.tld/`) and port (`https://sub.example.com:8443/` without a port in
  the pattern); a host wildcard covers subdomain depth; a deny `WebFetch(http://127.0.0.1/**)` matches
  `http://0x7f.1/`, `http://2130706433/` and `http://127.1/` — the anti-goal stated: the verdict
  comes from `new URL` canonicalisation, which no string glob can produce.
- TC-04 — Path matcher: `*` does not cross `/` (`Read(/src/*)` refuses `/src/a/b`); `**` does.
- TC-05 — Command matcher: `Bash(git *)` still matches `git status` and `git add src/x` (unchanged
  semantics; the separator residual is issue #2427, not fixed here).
- TC-06 — Kind resolution: a tool profile declares its argument as one object, `argument: { key, kind }`
  (`IToolPermissionArgument`); the shipped profiles declare `path`, `url`, `command`, `text`; a key
  without a kind does not type-check (a `// @ts-expect-error` registration pins it); a keyless tool
  under `Tool(*)` is denied/allowed by the bare-wildcard rule (today it prompts).
- TC-06 — Shipped declarations: a test in `agent-tools` and one in `agent-framework` assert each registered
  profile's `argument.kind` (`WebFetch` → `url`, `Read`/`Write`/`Edit` → `path`, the command tools →
  `command`, `Glob`/`Grep`/`WebSearch` → `text`), so a missing declaration is red rather than a silent
  `text` default. Unparseable URL argument: not `auto` under an allow; under a deny in `default` mode
  the verdict is `approve` (a prompt), the fail direction stated.
- TC-07 — Applied-check mutation: reverting the URL matcher to the string glob makes the placement cases
  red; reverting the path matcher makes the `/`-crossing case red.
- TC-08 — `pnpm build`, `pnpm test --filter agent-core --filter agent-tools --filter agent-framework`,
  `pnpm harness:scan` exit 0; `packages/agent-core/docs/SPEC.md` names `IToolPermissionArgument` and the
  per-kind semantics.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 3`

Drafted by `user-execution-scenario-author`, 2026-08-29, ledger run `r20260828152917`; rewritten to the
canonical form after DONE-GATE-STAGE-1 failed on FORM only (entry below). This REPLACES the
orchestrator's `not-applicable | 0`: the gate's verdict is observable through the shipped `robota`
binary, and every command below was run against the pre-change tree (`origin/develop` `dd46c9183`,
built `packages/agent-cli/bin/robota.cjs`) before being written. The "today" values are measured.

**Surface (level 2 — fixtures the product ships).** `robota -p` is the non-interactive path;
`--session-log <jsonl>` swaps in the replay provider (no model key, no network — the dummy key in the
scratch `settings.json` only boots the CLI); a local `node:http` server on `127.0.0.1:48731` is the
fetch target and records every request it receives; the persisted session record under the scratch
`HOME`'s `.robota/sessions/` carries the tool result, so a denial is readable as text. The canonical
entrypoint is `robota` itself: `pnpm exec robota` does not resolve in this workspace (no
`node_modules/.bin/robota` link — measured by the guardian and by the author), so the prerequisite
block puts a one-line `robota` launcher on `PATH` that execs the package's shipped `bin/robota.cjs` —
exactly the file the package manifest's `bin.robota` publishes. Level 1 was rejected because the gate
has no CLI of its own; level 3 is not needed.

**Two facts that shaped the scenarios, both measured:**

- `RISK_CLASS_POLICY.default.inspect === 'auto'` (`permission-mode.ts:62-66`), and `WebFetch` is
  `inspect`. So in the shipped CLI an **allow** pattern on `WebFetch` never changes the verdict — the
  fall-through is already `auto` in every mode. The Task's "auto-approved every host" narrative is
  therefore not observable on the allow side today; the spec's "prompts for `inspect` in `default`
  mode" is also not what the matrix says. The URL matcher IS observable on the **deny** side (a deny
  match → `Permission denied`, a non-match → the fetch runs), which is where Scenarios 1 and 3 look.
  The path matcher is observable on the allow side through `Write` (`modify` → `approve` in `default`
  mode, and print mode fails closed with no approver — measured: exit 0, file absent, no hang, with
  stdin attached).
- A project-level `.robota/settings.json` in a fresh scratch cwd is NOT read (`settings-source.ts`
  reads the project layer through `assertWorkspaceProjectReader`, the workspace-trust gate) — measured:
  the exact deny in it had no effect. The rules therefore go in the scratch `HOME`'s user-level
  `~/.robota/settings.json`, which is read unconditionally and keeps the developer's real `~/.robota`
  untouched.

**Stdout carries no verdict** in any output format (`text`, `json`, `stream-json` all print only the
replayed `CORE_049_DONE` — measured), so the observable type is `product-state-file`: the session
record the product writes below `.robota/sessions/` in the scratch `HOME`. The discriminating read of
that record, and of the fixture server's request log, is listed under "Post-run reads" after the
three scenarios; the gate executor records it in each `evidence:` field.

**Shared prerequisite block** (run once; every scenario's `prerequisites:` line refers to it). Nothing
is written inside the repository.

```bash
S=/tmp/core-049
rm -rf "$S"; mkdir -p "$S/home/.robota" "$S/ws" "$S/bin"
NODE="$(node -e 'console.log(process.execPath)')"   # resolve BEFORE exporting HOME: the volta shim dies without it (measured)
printf '#!/bin/sh\nexec "%s" /home/ubunutu/dev/robota/packages/agent-cli/bin/robota.cjs "$@"\n' "$NODE" > "$S/bin/robota"
chmod +x "$S/bin/robota"                            # requires `pnpm --filter @robota-sdk/agent-cli build`
cat > "$S/server.mjs" <<'JS'
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
createServer((req, res) => { appendFileSync(process.argv[2], `${req.method} ${req.url}\n`); res.end('ok'); }).listen(48731, '127.0.0.1');
JS
mklog() {  # $1=tool  $2=arguments JSON (inner quotes backslash-escaped)  $3=output path
  printf '%s\n' \
  '{"timestamp":"2026-08-29T00:00:00.000Z","sessionId":"core-049","event":"provider_request","executionId":"e1","round":0}' \
  "{\"timestamp\":\"2026-08-29T00:00:01.000Z\",\"sessionId\":\"core-049\",\"event\":\"provider_response_normalized\",\"executionId\":\"e1\",\"round\":0,\"response\":{\"role\":\"assistant\",\"content\":null,\"id\":\"a1\",\"state\":\"complete\",\"timestamp\":\"2026-08-29T00:00:01.000Z\",\"toolCalls\":[{\"id\":\"call-1\",\"type\":\"function\",\"function\":{\"name\":\"$1\",\"arguments\":\"$2\"}}]}}" \
  '{"timestamp":"2026-08-29T00:00:02.000Z","sessionId":"core-049","event":"provider_request","executionId":"e1","round":1}' \
  '{"timestamp":"2026-08-29T00:00:03.000Z","sessionId":"core-049","event":"provider_response_normalized","executionId":"e1","round":1,"response":{"role":"assistant","content":"CORE_049_DONE","id":"a2","state":"complete","timestamp":"2026-08-29T00:00:03.000Z"}}' \
  > "$3"
}
settings() {  # $1 = the "permissions" object
  printf '{"currentProvider":"anthropic","providers":{"anthropic":{"type":"anthropic","model":"claude-test-model","apiKey":"dummy-never-used"}},"permissions":%s}\n' "$1" > "$S/home/.robota/settings.json"
}
mklog WebFetch '{\"url\":\"http://127.1:48731/probe-shorthand\"}' "$S/ws/short.jsonl"
mklog WebFetch '{\"url\":\"http://127.0.0.1:48731/?a=.example.com/x\"}' "$S/ws/query.jsonl"
mklog Write '{\"filePath\":\"/tmp/core-049/ws/out/deep/file.txt\",\"content\":\"hello\"}' "$S/ws/write.jsonl"
"$NODE" "$S/server.mjs" "$S/ws/hits.log" & SRV=$!; sleep 0.5
export HOME="$S/home"; export PATH="$S/bin:$PATH"; cd "$S/ws"
```

Before each scenario: `rm -rf "$HOME/.robota/sessions" /tmp/core-049/ws/hits.log /tmp/core-049/ws/out`
and the scenario's `settings …` call. Cleanup for all three: `kill $SRV; rm -rf /tmp/core-049`. Do not
use `pkill -f server.mjs` — it matches the invoking shell's own command line (measured: it killed the
harness).

### Scenario 1: a deny on the canonical loopback host catches the IPv4-shorthand spelling (URL kind, the anti-goal, deny side)

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: shared prerequisite block above (fixture server listening on 127.0.0.1:48731, `robota` launcher on PATH, HOME=/tmp/core-049/home, cwd /tmp/core-049/ws); then `settings '{"deny":["WebFetch(http://127.0.0.1:48731/**)"]}'` and the per-scenario reset; offline — no model key, no network beyond the loopback fixture
- command: `robota -p "go" --output-format text --permission-mode default --session-log /tmp/core-049/ws/short.jsonl`
- observable type: product-state-file
- product state path: .robota/sessions
- expected observable: change=created
- observable rationale: source=robota-state-artifact
- cleanup: `kill $SRV; rm -rf /tmp/core-049`
- evidence: pending — filled at gate time with the Post-run reads for Scenario 1

### Scenario 2: `Write(<dir>/*)` in the allow list no longer covers a file one directory deeper (path kind, allow side)

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: shared prerequisite block above (the fixture server is not used here); then `settings '{"allow":["Write(/tmp/core-049/ws/out/*)"]}'` and the per-scenario reset; offline — no model key, no network
- command: `robota -p "go" --output-format text --permission-mode default --session-log /tmp/core-049/ws/write.jsonl`
- observable type: product-state-file
- product state path: .robota/sessions
- expected observable: change=created
- observable rationale: source=robota-state-artifact
- cleanup: `kill $SRV; rm -rf /tmp/core-049`
- evidence: pending — filled at gate time with the Post-run reads for Scenario 2

### Scenario 3: text in the query string no longer satisfies a host wildcard (URL kind, placement, deny side)

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: shared prerequisite block above (fixture server listening on 127.0.0.1:48731, `robota` launcher on PATH, HOME=/tmp/core-049/home, cwd /tmp/core-049/ws); then `settings '{"deny":["WebFetch(http://*.example.com/**)"]}'` and the per-scenario reset; offline — no model key, no network beyond the loopback fixture
- command: `robota -p "go" --output-format text --permission-mode default --session-log /tmp/core-049/ws/query.jsonl`
- observable type: product-state-file
- product state path: .robota/sessions
- expected observable: change=created
- observable rationale: source=robota-state-artifact
- cleanup: `kill $SRV; rm -rf /tmp/core-049`
- evidence: pending — filled at gate time with the Post-run reads for Scenario 3

### Post-run reads (the discriminating observation for each scenario)

Every run exits `0` and prints `CORE_049_DONE` before and after the change; the verdict lives in the
session record the product created below `$HOME/.robota/sessions/` and in whether the fetch reached
the fixture. After each command, read:

```bash
grep -c 'Permission denied' "$HOME"/.robota/sessions/*.json    # DENIED = 1, EXECUTED = 0
cat /tmp/core-049/ws/hits.log 2>/dev/null                      # a line = the fetch went out
ls /tmp/core-049/ws/out/deep/file.txt 2>/dev/null              # Scenario 2 only
```

| Scenario | Measured today (`dd46c9183`)                                                                                                  | Expected after the change                                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | count `0`; `hits.log` = `GET /probe-shorthand` — the deny on the loopback host was bypassed by `127.1` and the fetch went out | count `1`; no `hits.log` — `new URL` canonicalises `127.1` to `127.0.0.1`, the deny matches                                                                       |
| 2        | count `0`; `file.txt` EXISTS — the single-star allow covered a subdirectory the operator never named                          | count `1`; `file.txt` ABSENT — `*` stays inside one segment, so `default` mode's `approve` for `modify` reaches print mode's fail-closed approver                 |
| 3        | count `1`; no `hits.log` — `.example.com/` in the query satisfied a host pattern                                              | count `0`; `hits.log` = `GET /?a=.example.com/x` — host `127.0.0.1` is not under `*.example.com`, the query never participates, `inspect` falls through to `auto` |

Controls measured today and unchanged by the design (run them if a read looks wrong, not as gates): the
exact deny `WebFetch(http://127.0.0.1:48731/**)` against `http://127.0.0.1:48731/probe-exact` gives
count `1`, no hit; a non-matching allow `Write(/tmp/core-049/ws/elsewhere/*)` against the same write
gives count `1`, file absent — which is what proves a deny and a fail-closed prompt are observable
through this surface at all. Scenario 3 is deliberately the direction in which the new matcher is LESS
restrictive: it proves query text is ignored — the same property that, on the allow side once
`WebFetch` is no longer `auto` (issue #2026), stops `https://evil.tld/?a=.example.com/x` from being
approved. Read it with Scenario 1, not instead of it.

### Concerns recorded by the author

- The allow-side `WebFetch` P1 as narrated in this Task is **not user-observable in the shipped CLI**
  today, because `inspect` is `auto` in every mode regardless of the allow list. Nothing here is
  wrong with the fix — the matcher is exercised by Scenarios 1 and 3 through the deny list — but the
  spec's Fallback section ("prompts for `inspect` in `default` mode") contradicts `RISK_CLASS_POLICY`
  and should be corrected before it is read as a guarantee.
- A `hooks.PermissionDecision` command hook in the same user-level `settings.json` wrote nothing in
  print mode in every run, while `permissions` from the same file took effect. It would have been the
  cleanest observable of the verdict; it was not chased because the server log and the session record
  suffice. Worth a separate look — it may be a defect, or hooks may be loaded from a layer print mode
  does not read.
- The mechanical observable (`change=created` on `.robota/sessions`) is true before and after the
  change; the parser's `product-state-file` shape has no "contains" form. The Post-run reads table is
  the real acceptance and the evidence field must quote its three values, not just the file's
  existence.

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-08-29

**Status remains:** scenario drafted
**Failed criteria:**

- Executability decision (catalogue § DONE-GATE-STAGE-1, criterion 2): each of S-1, S-2, S-3 carries
  `**Executability:** automatable, offline (…)`; the catalogue requires the decision token
  `agent-executable` (or `manual-only: <specific technical reason>`), and `scan-user-execution-plan-order`
  (`scenarioContract`) accepts exactly `executability: agent-executable` for an `automatable` outcome.
  The scenarios ARE agent-executable — the guardian ran the shared prerequisite block and both S-1 arms
  read-only against the current build (`dist/node/bin.js`, `HEAD` `dd46c9183`): control exited 0,
  printed `CORE_049_DONE`, no `hits.log`, denied count `1`; shorthand case exited 0, printed
  `CORE_049_DONE`, `hits.log` = `GET /probe-shorthand`, denied count `0` — identical to the author's
  "measured today" values. The decision token is what is missing, not the property.
  **Required action:** write `- executability: agent-executable` once per scenario.
- Canonical product-surface identity and matching invocation (criterion 3, `backlog-execution.md` >
  Scenario Design Preference Order): no scenario carries `product surface:`, `surface rationale:`,
  `observable type:` or `observable rationale:`; the invocation is a `;`-chain of shell functions
  (`mklog …; run …; echo …; cat …; grep -c …`) around `"$NODE" "$BIN" -p …`, and the rule admits only a
  single product command beginning with `robota` or `pnpm exec robota` (one `| grep` pipe allowed, no
  chaining or substitution). The expected result is prose; a `product-output` observable takes the shape
  `exit=<code>; output-contains=<literal>` and a `product-state-file` observable takes
  `change=created|updated|deleted` plus `product state path:` below `.robota/`. Semantic half of the
  criterion: the observable IS product behavior — the shipped `robota` binary in `-p` mode with the
  replay provider, its stdout, its persisted session record under the scratch `~/.robota/sessions/`, and
  whether the fetch reached the loopback fixture server; none of it is a build, test, lint, harness, CI
  or repository-text inspection. The canonical binding cannot be issued because the fields that carry it
  do not exist. Measured while judging: `pnpm exec robota` resolves in neither the repository root nor
  `packages/agent-cli` (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL … "robota" not found`; no
  `node_modules/.bin/robota` link anywhere under `apps/` or `packages/`) — the author must establish a
  canonical invocation the rule's parser accepts, not just the shim path.
  **Required action:** per scenario, add `- product surface: robota-cli`,
  `- surface rationale: shipped-entrypoint=robota`, one `- command:` holding a single canonical `robota …
-p "go" --output-format text --permission-mode default --session-log <literal path>` invocation (move
  `mklog`/`settings`/server startup into `- prerequisites:`, and the post-run reads into the expected
  observable or a second scenario), `- observable type:` + `- observable rationale:` matching the type, and
  `- expected observable:` in the type-specific shape.
- Section parseability (the caller-named floor; `scan-user-execution-plan-order.mjs`): `exactPlanSignal`
  requires exactly one line of the form `**Author verdict:** \`SCENARIO DRAFTED: <outcome> | <n>\``; the
signal here is inline in a prose paragraph, so the scan finds no author verdict and GATE-IMPLEMENT
cannot bind the planning checkpoint. `scenarioEntries`recognises only`### Scenario N`/`### Scenario N: <title>`headings;`### S-1 —`, `### S-2 —`, `### S-3 —`yield zero scenarios against a
declared count of 3. Field labels`Prerequisite state:`, `Commands:`, `Expected observable result:`match
none of`prerequisites?:`, `command:`, `expected (observable|result):`, and the numbered `1.`/`2.`sub-steps are lines the parser treats as unknown fields (every line of a scenario body must be a known
field).
**Required action:** one`**Author verdict:** \`SCENARIO DRAFTED: automatable | 3\``line as the first
content of the section; headings`### Scenario 1 — …`, `### Scenario 2 — …`, `### Scenario 3 — …`; every
scenario line a single canonical `- <label>: <value>` field; prose (the measured facts, the level-2
  surface rationale, the author's concerns) outside the scenario bodies.

Criteria met:

- Every scenario written with exact commands, prerequisites, expected observable result and an evidence
  field (criterion 1): met in substance — S-1, S-2, S-3 each state a prerequisite block, exact commands
  (verified executable as written, above), an expected result with exit code, output literal and file /
  count observations, cleanup, and an `Evidence:` field left empty for gate time; only the canonical
  shape is missing (recorded under criterion 3).
- Live credentials / external service (criterion 4): met — each scenario states it is offline, the
  replay provider (`--session-log`) needs no model key (the scratch `settings.json` key is a dummy that
  only boots the CLI), and the only network is the scenario's own `node:http` server on
  `127.0.0.1:48731`; an executor learns this from the scenario, not from a failure.
- Exception clause: not invoked — all three scenarios are written; N/A.
- Ordering: DONE-GATE-STAGE-1 has no prior gate (catalogue § Prior-gate map). Task at
  `.agents/tasks/`, `status: todo`, untracked with its draft spec; worktree otherwise clean at `HEAD`
  `dd46c9183` = `origin/develop`; no implementation path present; PLAN ledger record `r20260828152917`
  (`converged`, 1 round, 3 findings) has `ref` = this Task path.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-29

**Status upgrade:** scenario drafted → scenario written

Re-run after the FORM FAIL above (same date). Judged by `backlog-gate-guard` against
`.agents/specs/gate-catalogue.md` § DONE-GATE-STAGE-1 and `backlog-execution.md` > Scenario Design
Preference Order; parseability checked by running `exactPlanSignal`, `scenarioEntries` and
`scenarioContract` from `scripts/harness/scan-user-execution-plan-order.mjs` over this file.

- Ordering: PASS — `DONE-GATE-STAGE-1` has no prior gate (catalogue § Prior-gate map). Task at
  `.agents/tasks/`, frontmatter `status: todo`, untracked alongside its draft spec; branch
  `fix/2350-permission-patterns-match-by-argument-kind` at `dd46c9183` = `origin/develop`; the only
  tracked change is the ledger line `r20260828152917` (`converged`, `ref` = this path). No
  implementation has preceded the gate: `permission-gate.ts` still ships the string glob.
- Parseability: PASS — `exactPlanSignal` → `{outcome: automatable, count: 3}` (exactly one
  `**Author verdict:**` line); `scenarioEntries` → 3, numbered 1, 2, 3 in order; `scenarioContract`
  returns a complete contract for each (every body line a known canonical field, each label once,
  `product state path` `.robota/sessions` normalises below `.robota/`). The "Post-run reads",
  "Concerns" and the FAIL entry sit under their own `###` headings, outside every scenario body.
- Scenario 1: a deny on the canonical loopback host catches the IPv4-shorthand spelling (URL kind, the anti-goal, deny side) — surface=robota-cli; surface-rationale=shipped-entrypoint=robota; invocation=robota -p "go" --output-format text --permission-mode default --session-log /tmp/core-049/ws/short.jsonl; observable-type=product-state-file; observable=change=created; observable-rationale=source=robota-state-artifact; product-state-path=.robota/sessions; guardian-observable-verdict=product-behavior; executability=agent-executable; prerequisites=shared block + `settings '{"deny":["WebFetch(http://127.0.0.1:48731/**)"]}'` + per-scenario reset, offline; command=the single `robota` invocation above; expected observable=`change=created` on `.robota/sessions`, acceptance row 1 of Post-run reads (denied count `0`→`1`, `hits.log` `GET /probe-shorthand`→absent); cleanup=`kill $SRV; rm -rf /tmp/core-049`; evidence=pending field bound to Post-run reads for Scenario 1.
- Scenario 2: `Write(<dir>/*)` in the allow list no longer covers a file one directory deeper (path kind, allow side) — surface=robota-cli; surface-rationale=shipped-entrypoint=robota; invocation=robota -p "go" --output-format text --permission-mode default --session-log /tmp/core-049/ws/write.jsonl; observable-type=product-state-file; observable=change=created; observable-rationale=source=robota-state-artifact; product-state-path=.robota/sessions; guardian-observable-verdict=product-behavior; executability=agent-executable; prerequisites=shared block + `settings '{"allow":["Write(/tmp/core-049/ws/out/*)"]}'` + per-scenario reset, offline; command=the single `robota` invocation above; expected observable=`change=created` on `.robota/sessions`, acceptance row 2 of Post-run reads (denied count `0`→`1`, `file.txt` EXISTS→ABSENT); cleanup=`kill $SRV; rm -rf /tmp/core-049`; evidence=pending field bound to Post-run reads for Scenario 2.
- Scenario 3: text in the query string no longer satisfies a host wildcard (URL kind, placement, deny side) — surface=robota-cli; surface-rationale=shipped-entrypoint=robota; invocation=robota -p "go" --output-format text --permission-mode default --session-log /tmp/core-049/ws/query.jsonl; observable-type=product-state-file; observable=change=created; observable-rationale=source=robota-state-artifact; product-state-path=.robota/sessions; guardian-observable-verdict=product-behavior; executability=agent-executable; prerequisites=shared block + `settings '{"deny":["WebFetch(http://*.example.com/**)"]}'` + per-scenario reset, offline; command=the single `robota` invocation above; expected observable=`change=created` on `.robota/sessions`, acceptance row 3 of Post-run reads (denied count `1`→`0`, `hits.log` absent→`GET /?a=.example.com/x`); cleanup=`kill $SRV; rm -rf /tmp/core-049`; evidence=pending field bound to Post-run reads for Scenario 3.
- Criterion 1 (exact commands, prerequisites, expected observable, evidence field): PASS — each
  scenario carries one exact `command:`, a `prerequisites:` line naming the shared block plus its
  own `settings` call and reset, a canonical `expected observable:`, a `cleanup:`, and an `evidence:`
  placeholder. The shared block is complete and reproducible: the guardian ran it verbatim in
  `/tmp/core-049` (node `v22.14.0` via the launcher exec'ing `bin/robota.cjs`) and removed it after.
- Criterion 2 (executability decision): PASS — `executability: agent-executable` once per scenario;
  verified, not assumed: the Scenario 3 arm run verbatim today exited `0`, printed `CORE_049_DONE`,
  created `session_<uuid>.json` under `$HOME/.robota/sessions/`, denied count `1`
  (`Permission denied. The user did not approve this action.` in the record), no `hits.log` — the
  author's "measured today" row 3 exactly; the previous run reproduced both Scenario 1 arms.
- Criterion 3 (canonical surface, matching invocation, product behaviour): PASS — `product surface:
robota-cli` with `shipped-entrypoint=robota`; the command's first token is `robota`, no chain, no
  substitution, no pipe. The `robota` on `PATH` is a one-line launcher exec'ing
  `packages/agent-cli/bin/robota.cjs`, the file `package.json` `bin.robota` publishes — a
  prerequisite, not a substituted command (`pnpm exec robota` does not resolve here: no
  `node_modules/.bin/robota` link, re-checked). Observable: the product's own persisted session record
  below `.robota/sessions/`, the loopback fixture's request log, and the file the `Write` tool does or
  does not create — none is a build, typecheck, lint, test, harness, CI or repository-text read.
  On `change=created`: the catalogue contract for `product-state-file` is exactly
  `change=created|updated|deleted` plus a path below `.robota/`; the field is truthful (the product
  creates the record on every run) but non-discriminating on its own, as the author states. The
  discriminating acceptance is in-section, per scenario, and measured: the Post-run reads table row.
  Stage 2 matches that row (denied count, `hits.log`, `file.txt`) and quotes those values in each
  `evidence:` field; a Stage-2 entry that records only the record's existence does not match this
  scenario's expected result.
- Criterion 4 (credentials / external service): PASS — every `prerequisites:` line states offline,
  no model key, no network beyond the loopback fixture; the replay provider (`--session-log`) is the
  provider, and the `apiKey` in the scratch `settings.json` is a dummy that only boots the CLI
  (confirmed: the run made no outbound request). `RISK_CLASS_POLICY.default.inspect === 'auto'` at
  `permission-mode.ts:62-66` confirmed, which is why the URL matcher is read on the deny side.
- Exception clause: N/A — all three scenarios are written.

## Bound spec document

`.agents/spec-docs/active/CORE-049-permission-patterns-match-by-argument-kind.md`
