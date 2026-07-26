---
title: 'INFRA-060: security and scheduled workflow audit — can each scan fail, and does it check the right thing'
status: in-progress
created: 2026-07-26
priority: high
urgency: soon
area: .github/workflows, scripts/harness, .gitleaks.toml
depends_on: []
---

# INFRA-060 — security and scheduled workflow audit

Audit of the six security/scheduled workflows against two questions, because the first alone is not
sufficient:

1. **Can it fail?** Is the enforcement real, or is the green structural?
2. **Does it check the thing its name claims?** A scan that genuinely can fail is still broken if it
   examines the wrong surface, over-reaches into noise, or is satisfied vacuously. For a security
   scan this is the worse half: the name is what earns the trust, and "Scheduled security scan:
   success" is read as "this repository was scanned and is clean".

Method: falsify, don't reason. Plant the condition each check exists to catch and confirm it goes
red. Anything not falsified is recorded below as a hypothesis, not a conclusion.

## Per-workflow verdict

| Workflow                  | Purpose (one line)                                                             | Behaviour matches?                                                                                                 | Falsified?                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `gitleaks.yml`            | Catch a secret committed in a PR's diff.                                       | **Wrong thing** — the allowlist exempted every test/e2e/fixture/evals path from the ENTIRE ruleset. Fixed.         | **Yes.** Planted `ghp_…` PAT: caught in `src/`, invisible in `__tests__/`.                          |
| `security-scheduled.yml`  | Weekly osv-scan of the full lockfile, catching advisories against pinned deps. | **Wrong thing (scope)** — scanned `develop` only; `main`, the released branch, was on no schedule. Fixed (matrix). | **Yes.** Planted `lodash@4.17.15` → 4 advisories, exit 1. Clean lockfile → exit 0.                  |
| `live-provider-smoke.yml` | One real turn per credentialed provider, to catch vendor wire drift.           | **Wrong thing** — 0 providers ever called; every green run verified nothing. Disclosure fixed; posture filed.      | **Yes.** Ran the real script: 1 live Anthropic turn green; 0-provider run now annotated.            |
| `mutation-nightly.yml`    | Nightly mutation score over core logic, to find accidental-green tests.        | **Matches, narrowly** — 3 chosen FILES, not 3 packages; advisory by design. Score was unreadable. Now surfaced.    | **Partly.** Empty-mutate-glob no-op falsified (Stryker exits 1). Low score cannot fail — by design. |
| `codeql.yml`              | SAST over JS/TS, findings in the code-scanning tab.                            | **Matches.** develop analysis = 80 results = the exact open-alert inventory. Scope now documented.                 | **No — hypothesis.** Alert inventory proves it reports; no defect planted in a PR.                  |
| `dependency-review.yml`   | Gate PR-added deps by vulnerability + license allow-list.                      | **Matches.** Dependency graph verified to carry the transitive lockfile closure, not just manifest ranges.         | **No — hypothesis.** See "Open" below.                                                              |

## What was fixed

### 1. The secret scan was blind to every test path (`gitleaks.yml`, `.gitleaks.toml`)

A single global `[allowlist]` block listing `__tests__/`, `e2e/`, `*.test.ts`, `.bintest.ts` and
`.agents/evals/`. A global allowlist suppresses **all** rules, not the one that was noisy.

Falsification — the same real-shaped `ghp_…` PAT in two files, scanned with the workflow's exact
command shape:

```
BEFORE (8.21.2 + old config)   leaks found: 1   packages/agent-core/src/leak-probe-src.ts
AFTER  (8.30.1 + new config)   leaks found: 2   … and packages/agent-core/src/__tests__/leak-probe.test.ts
```

The cost of narrowing was measured rather than guessed: over the whole worktree the broad path
allowlist was hiding exactly **6** findings, all of them the `generic-api-key` heuristic on
deterministic fixture tokens. Scoping the suppression to `targetRules = ["generic-api-key"]` keeps
all 6 suppressed — **0 findings on a clean tree** — while every high-confidence credential rule now
fires in test paths. Strictly more detection, zero added noise.

A silent-config trap was found on the way: `[[allowlists]]` and `targetRules` are **silently dropped**
by gitleaks < 8.24 — no error, no warning. Verified by excluding a path under 8.21.2 and watching it
not be excluded. Hence the pin to 8.30.1. A downgrade fails loudly (the 6 fixtures reappear), so the
dangerous direction is fenced by that asymmetry rather than by a comment.

### 2. The scheduled security scan never scanned the released branch (`security-scheduled.yml`)

It checked out `develop` and only `develop`. `main` — released, tagged, deployed — was covered by
nothing on a schedule. Now a `[main, develop]` matrix with `fail-fast: false`.

The scan itself is real, falsified locally with the workflow's exact command:

```
unmodified lockfile     Scanned … 2130 packages / Filtered 5 / No issues found      exit 0
lodash 4.18.1→4.17.15   GHSA-35jh-r3h4-6jhm (8.1) + GHSA-p6mc-m468-83gw (7.4) + 2   exit 1
```

So the 2026-07-26 manual dispatch's green was a **true negative**: 2130 packages parsed, the four
`osv-scanner.toml` re-accepts applied, nothing else outstanding.

### 3. Live provider smoke was a green no-op (`live-provider-smoke.yml`)

Both runs it has ever had reported `success` having called **zero** providers. The exit code is left
at 0 deliberately — a nightly red for an unprovisioned secret gets muted within a week — so this is
fixed as a disclosure problem, plus one narrow exception:

- A run that exercised 0 providers now emits a `::warning::` annotation and a job-summary line naming
  what was not covered.
- An explicit `--provider <type>` dispatch that cannot run is now a **failure**: naming one provider
  is asking a question, and a silent green is not an answer.

The machinery is verified working, not assumed: one real Anthropic turn (chat + stream) ran green
through this exact script during the audit. The only missing piece in CI is the secret.

### 4. The mutation score was unreadable (`mutation-nightly.yml`)

The nightly does real work — 152 / 102 / 64 mutants instrumented, scores 52.63 / 74.42 / 58.62, **110
surviving mutants**, two of three targets below the config's own `low: 60`. All of it reachable only
by downloading an artifact zip. The score now goes to the job summary.

### 5. New guard: `live-smoke-provider-coverage`

Registered in `run-all-scans`. The smoke script discovers providers at runtime but can only read a
variable the workflow hands it, and the workflow holds a hand-written five-secret table. A seventh
provider would be discovered, found keyless, skipped — and the nightly would stay green covering one
provider fewer than it claims.

Proven RED against that shape (unwire `GEMINI_API_KEY` → finding names the declaring file) and GREEN
after. Worth recording: **the guard's first implementation passed its own red-proof**, because it
asked whether the name appeared anywhere in the file and the workflow header lists every consumed
secret in prose. That is the `agent-server-boundary` failure — a criterion met by a token appearing
rather than a seam being wired. It now requires a real `NAME: ${{ secrets.… }}` binding on a
non-comment line, and the vacuous pass is kept as a regression test.

## What was deliberately NOT changed

- **`dependency-review.yml`'s paths filter and advisory posture.** The header's reasoning is correct:
  the dependency graph cannot change unless a manifest or the lockfile does, and a paths-skip on a
  _required_ check reports pending forever.
- **No guard for a stryker mutate glob that matches nothing.** The obvious worry was falsified rather
  than assumed: pointing a target at a renamed path makes Stryker exit 1 with `ConfigError: No tests
were executed`. A guard there would catch nothing and add surface.
- **`thresholds.break` stays null**, and no check was made required. Both change what gates a merge.

## Filed for the owner (each changes a contract, so not taken here)

1. **Three PR-time security checks gate nothing.** Neither branch ruleset lists `Secret scan
(gitleaks)`, `CodeQL`, or `Dependency review` in required-status-checks. Required on develop today:
   build, quality, scans, security audit, commitlint, tui-e2e, examples-typecheck, windows-shell,
   review-gate. A committed secret, a high-severity SAST finding, and a copyleft dependency each go
   red and block nothing. Recommendation: promote `Secret scan (gitleaks)` first — it is now proven to
   fire, measured at 0 false positives on a clean tree, and a leaked credential is the one finding
   that cannot be undone after merge.
2. **35 open HIGH CodeQL alerts** (plus 15 medium), nothing gating them. Needs a triage decision
   before CodeQL could be made required, or the gate would be bypassed on day one.
3. **`ci.yml` downloads and executes osv-scanner with no checksum**, twice (lines 434-435 and
   488-489), including in the _required_ `security audit` job. Same defect fixed here in
   `security-scheduled.yml`; `ci.yml` is owned by another agent. The digest to pin is
   `3abcfd7126c453a00421487e721b296e0cb68085bd431d6cef60872774170fc8`. A repo-wide guard
   ("a workflow that curls an executable must verify a checksum") was deliberately NOT added, because
   it would immediately fail on `ci.yml` and turn the required `scans` job red.
4. **`live-provider-smoke` verifies nothing until a provider secret is provisioned.** Whether to
   provision one, or to accept a permanently-annotated no-op, is an owner decision.
5. **`mutation-nightly` thresholds.** 110 surviving mutants stand with no owner and no ratchet.
6. **`workflow_dispatch` on the two nightlies cannot test the ref it is dispatched from.** Both
   `mutation-nightly.yml` and `live-provider-smoke.yml` hard-code `ref: develop` in their checkout.
   The workflow FILE comes from the dispatched ref, but the CODE it runs is always develop's. Measured
   during this audit: dispatching `live-provider-smoke` from this branch ran develop's smoke script,
   so the new zero-provider annotation did not appear — the change had to be verified locally instead.
   That is correct for the unattended nightly and wrong for a dispatch, which is how a human tests a
   change before it lands. A fix would need the schedule to keep its fixed branch while a dispatch
   uses `github.ref_name`, e.g.
   `ref: ${{ github.event_name == 'schedule' && 'develop' || github.ref_name }}` — a change to what
   the nightly targets, so filed rather than taken.

## The two checks that were NOT falsified, and how to close them

Both are recorded as hypotheses. Each has strong structural evidence and no planted defect, and the
difference matters: this repo has five recent cases of a green check that was doing nothing.

**`dependency-review.yml`.** Falsifying it means opening a PR that ADDS a dependency whose license is
outside the allow-list and watching the check go red. The cleanest probe is a package with a
permissive-but-unlisted leaf rather than real copyleft — e.g. `pako`, whose SPDX expression is
`(MIT AND Zlib)`: `AND` requires every leaf to be allowed, and `Zlib` is not on the list, so it should
be denied without dragging actual copyleft into the graph.

That was deliberately not done here. It requires editing `pnpm-lock.yaml` and a `package.json` —
neither owned by this audit, and the lockfile is the single most conflict-prone file in this monorepo
while other agents are working in it. It should be done from a throwaway PR by an agent that owns the
lockfile, which is the same pattern as the throwaway #1465 used for the auto-merge permission probe.

**`codeql.yml`.** Falsifying it means landing a CodeQL-detectable defect in changed code on a PR
branch and confirming a new alert is annotated — remembering that PR analyses are diff-informed, so
the defect must be in the diff. The 80-result develop analysis proves the workflow reports; it does
not prove the PR-annotation path works.

## The mechanical ceiling

Stated plainly, because this sweep is not exhaustive and should not be read as such:

- **A weak ruleset passes every structural check.** These audits prove a scanner _runs_, _can fail_,
  and _examines the claimed surface_. None of them prove the ruleset is good. gitleaks' default rules
  will miss a credential format they do not model; CodeQL's `security-and-quality` suite will miss a
  vulnerability class it has no query for. Both would stay green, and no scan I can write detects that.
- **The gitleaks measurement covers the current tree.** "0 findings on a clean tree" is a statement
  about today's files. It bounds the noise the narrowing adds now, not forever.
- **CodeQL and dependency-review were not falsified.** Their failure paths are inferred from GitHub's
  documented behaviour plus the alert/graph inventories, not from a planted defect.
- **Scheduled workflows are only as live as the default branch.** All six exist on `main` today and
  the crons fire (mutation-nightly and live-provider-smoke both had real scheduled runs on
  2026-07-26). GitHub disables schedules after 60 days of repository inactivity; this repo is active
  daily, so the risk is theoretical but unguarded. Nothing alerts on a scheduled run that starts
  failing beyond GitHub's default author notification — nobody watches a cron by definition.
- **The gitleaks bump widens the default ruleset, and that cuts both ways.** 8.21.2 → 8.30.1 brings
  nine minor versions of new detection rules. Measured at zero findings on today's tree, but a future
  PR can trip a rule that did not exist before, and it will look like a regression the PR introduced
  rather than a rule the bump introduced. That is the correct trade — the version floor is what makes
  the rule-scoped allowlist apply at all — but the first surprise finding should be read with it in
  mind, and answered by narrowing that one rule, never by widening the path allowlist back.

## Test Plan

- `pnpm harness:scan` — includes the new `live-smoke-provider-coverage` guard.
- `pnpm harness:test` — the guard's 9 unit tests plus the 8 new live-smoke tests, each proven to fail
  against the pre-fix source.
- `pnpm harness:verify-like-ci`.
- YAML parse (PyYAML) of all six workflows, plus `bash -n` on every `run:` block touched.
- Falsification runs recorded above, each reproducible from the scratch harness scripts.

## User Execution Test Scenarios

### Scenario 1 — a secret in a test file is now caught

**Prerequisites:** gitleaks 8.30.1, a clone at this branch.

**Steps:** the probe token is GENERATED, never written down — see the note below.

```bash
TOKEN="ghp_$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 36)"
mkdir -p packages/agent-core/src/__tests__
printf 'export const T = "%s";\n' "$TOKEN" > packages/agent-core/src/__tests__/leak-probe.test.ts
git add -f packages/agent-core/src/__tests__/leak-probe.test.ts
git commit --no-verify -m "probe"
gitleaks detect --source . --config .gitleaks.toml \
  --log-opts "origin/develop..HEAD" --redact --no-banner --verbose
```

**Expected:** one `github-pat` finding naming the `__tests__` file; exit 1. Against
`origin/develop`'s `.gitleaks.toml` with gitleaks 8.21.2 the same command reports no leak.

**Cleanup:** `git reset --hard origin/develop`

**Evidence:** Run during the audit. BEFORE `leaks found: 1` (src only); AFTER `leaks found: 2`
(src + `__tests__`). Whole-worktree scan with the new config: `no leaks found`.

**And then it caught this very document.** The first version of this scenario pasted a literal
PAT-shaped token into the command above. `Secret scan (gitleaks)` on PR #1477 went **red in CI**
within 10 seconds, naming this file and line — the strengthened rule firing on a real pull request,
unprompted, on its first outing. The correct fix was to stop committing a PAT-shaped string (the
token is now generated at run time), NOT to add `.agents/backlog/` to an allowlist. Widening the
suppression to silence a true positive is the exact move that produced the defect this item is
about.

### Scenario 2 — the live smoke discloses that it called nothing

**Prerequisites:** provider closure built
(`pnpm --filter @robota-sdk/agent-provider-defaults... build:js`).

**Steps:**

```bash
env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GEMINI_API_KEY \
    -u DEEPSEEK_API_KEY -u DASHSCOPE_API_KEY \
    GITHUB_ACTIONS=true GITHUB_STEP_SUMMARY=/tmp/summary.md \
  node scripts/harness/live-provider-smoke.mjs
node scripts/harness/live-provider-smoke.mjs --provider gemini   # explicit, uncredentialed
```

**Expected:** the first exits 0 and prints
`::warning title=live provider smoke exercised 0 providers::…`, and `/tmp/summary.md` reads
`Providers actually called: **0**`. The second exits **1** with
`--provider gemini: GEMINI_API_KEY not set`.

**Cleanup:** `rm -f /tmp/summary.md`

**Evidence:** Both run during the audit with exactly those outputs. A credentialed run was also
executed end to end: `PASS anthropic (model=claude-sonnet-4-6) chat=4 chars, stream=2 chunks`.

### Scenario 3 — the provider-coverage guard catches an unwired credential

**Steps:**

```bash
node scripts/harness/scan-live-smoke-provider-coverage.mjs          # passes
# remove the `GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}` line from the workflow env block
node scripts/harness/scan-live-smoke-provider-coverage.mjs          # fails
```

**Expected:** exit 0, then exit 1 with
`[credential-not-wired] GEMINI_API_KEY declared in packages/agent-provider-gemini/src/gemini/provider-definition.ts`.
Note the workflow header still names `GEMINI_API_KEY` in prose — the guard must not be satisfied by
that.

**Cleanup:** restore the removed line.

**Evidence:** Run during the audit: passed, then failed with exactly that finding, then passed again
after restoring. The mention-vs-wiring distinction is covered by a regression test.
