---
title: 'INFRA-061: security and scheduled workflow audit — can each scan fail, and does it check the right thing'
status: done
completed: 2026-08-21
created: 2026-07-26
priority: high
urgency: soon
area: .github/workflows, scripts/harness, .gitleaks.toml
depends_on: []
---

> **Cadence removed 2026-08-04 (owner directive: "크론은 다 꺼").** Every `schedule:` trigger in this
> repository is gone; the workflow this item concerns now runs on `workflow_dispatch` only, and its
> name no longer claims a cadence. Read every mention of "nightly"/"weekly"/"scheduled" below as
> describing the design at the time of writing, not a cadence that exists. Whatever this item still
> asks for must be satisfied by an on-demand run.

# INFRA-061 — security and scheduled workflow audit

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

| Workflow                  | Purpose (one line)                                                             | Behaviour matches?                                                                                                 | Falsified?                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `gitleaks.yml`            | Catch a secret committed in a PR's diff.                                       | **Wrong thing** — the allowlist exempted every test/e2e/fixture/evals path from the ENTIRE ruleset. Fixed.         | **Yes.** Planted `ghp_…` PAT: caught in `src/`, invisible in `__tests__/`.                           |
| `security-scheduled.yml`  | Weekly osv-scan of the full lockfile, catching advisories against pinned deps. | **Wrong thing (scope)** — scanned `develop` only; `main`, the released branch, was on no schedule. Fixed (matrix). | **Yes.** Planted `lodash@4.17.15` → 4 advisories, exit 1. Clean lockfile → exit 0.                   |
| `live-provider-smoke.yml` | One real turn per credentialed provider, to catch vendor wire drift.           | **Wrong thing** — 0 providers ever called; every green run verified nothing. Disclosure fixed; posture filed.      | **Yes.** Ran the real script: 1 live Anthropic turn green; 0-provider run now annotated.             |
| `mutation-nightly.yml`    | Nightly mutation score over core logic, to find accidental-green tests.        | **Matches, narrowly** — 3 chosen FILES, not 3 packages; advisory by design. Score was unreadable. Now surfaced.    | **Partly.** Empty-mutate-glob no-op falsified (Stryker exits 1). Low score cannot fail — by design.  |
| `codeql.yml`              | SAST over JS/TS, findings in the code-scanning tab.                            | **Matches.** develop analysis = 80 results = the exact open-alert inventory. Scope now documented.                 | **Yes** (2026-08-21). Four alerts annotated on PR #1945's own new lines; one blocked the merge gate. |
| `dependency-review.yml`   | Gate PR-added deps by vulnerability + license allow-list.                      | **Matches, for RUNTIME deps only** — a development-scoped dep is outside the gate entirely (issue #1951).          | **Yes** (2026-08-21). Planted `GPL-3.0-only` runtime dep in PR #1950 → named and refused.            |

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

### 6. This audit's own guard was vacuous, and HARNESS-052 caught it

`scan-guard-scope-fail-closed` (landed mid-audit) executes every registered root finder against a
root lacking its governed tree. Handed the half-root case — smoke workflow present, provider packages
absent — `findUncoveredProviderCredentials` discovered zero credential declarations, reported zero
findings, and **passed**. A provider-coverage floor answering "all covered" when it found no
providers. Measured, not read:

```
bare root                       → fail-closed
workflow present, no packages/  → VACUOUS      (before)
workflow present, no packages/  → fail-closed  (after: no-provider-declarations-found)
```

Now pinned in `MANDATORY_TREE_GUARDS`, so the property is re-executed on every run rather than
asserted once. That is twice this one guard shipped the defect it was written to catch — first
satisfied by a mention instead of a wiring, then green over an empty subject. Both are recorded here
rather than quietly fixed, because the pattern is the finding: a guard author is the last person able
to see their own guard's blind spot.

### 7. `harness:test` was red on develop, unrelated to this branch

The ci.yml audit (PR #1474) landed two scans after `scan-guard-scope-fail-closed` (PR #1480) without
classifying them, which that guard fails on by design. Measured both by execution, twice each, and
recorded them honestly rather than pinning them as sound:

| finder                           | measured    |
| -------------------------------- | ----------- |
| `findRequiredCheckNeedsFindings` | fail-closed |
| `findTestSelectionFindings`      | **vacuous** |

`scan-test-selection-tolerance` is a live instance of the audited defect — handed a root with no CI
workflow it reports nothing to fix, the same answer it gives for a correct one. Recorded unfixed in
`PENDING_CLASSIFICATION` and owned by INFRA-060 (the ci.yml audit), not silently promoted.

### 8. `ci.yml` ran an unverified downloaded binary, twice (filed as owner item 3, then taken)

Both osv-scanner call sites in `ci.yml` — including the one inside the **required** `dependency audit`
job — did `curl … | chmod +x | execute` with no integrity check. Pinning the version does not pin the
bytes: a GitHub release asset can be replaced under an existing tag. That is arbitrary code execution
on a runner with the repository checked out, in the job whose entire purpose is to prove the tree is
clean.

Filed for the owner originally on the reasoning that `ci.yml` was owned by another agent, not that it
was a contract decision. It is not one: verifying a download changes nothing about what gates a merge,
what a check is named, or when it runs. A correct artifact produces the identical result. So it was
taken once `.github/workflows/` ownership allowed.

Both sites now `sha256sum -c -` **before** `chmod +x`, reading `OSV_SCANNER_VERSION` and
`OSV_SCANNER_SHA256` from one workflow-level `env` block so the two cannot drift apart. The digest was
recomputed from the asset rather than copied from this document, and matches the pin already in
`security-scheduled.yml`.

Falsified against the defect, not merely observed green. The two step bodies were extracted from the
PARSED workflow — so the thing under test is what CI will run, not a re-typed copy — and executed with
the download shimmed to serve either the genuine 41,324,728-byte asset or the same bytes plus one
appended `\0`:

| ci.yml revision | artifact | exit | left executable |
| --------------- | -------- | ---- | --------------- |
| pre-fix         | tampered | 0    | **yes**         |
| post-fix        | tampered | 1    | no              |
| post-fix        | genuine  | 0    | yes             |

The pre-fix row is the point: the old body accepted the swapped binary, marked it executable and ran
it. The genuine post-fix run went all the way through the real scan — `2130 packages`, 5 filtered,
`No issues found`.

This was the LAST unverified executable download in `.github/workflows` (`gitleaks.yml` and
`security-scheduled.yml` already verified theirs), which retires the reason the repo-wide
"a workflow that curls an executable must verify a checksum" guard was deferred — it would no longer
turn the required `scans` job red. The guard itself is not added here: `scripts/harness/` is outside
this change's ownership.

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
   build, quality, scans, dependency audit, commitlint, tui-e2e, examples-typecheck, windows-shell,
   review-gate. A committed secret, a high-severity SAST finding, and a copyleft dependency each go
   red and block nothing. Recommendation: promote `Secret scan (gitleaks)` first — it is now proven to
   fire, measured at 0 false positives on a clean tree, and a leaked credential is the one finding
   that cannot be undone after merge.
2. **35 open HIGH CodeQL alerts** (plus 15 medium), nothing gating them. Needs a triage decision
   before CodeQL could be made required, or the gate would be bypassed on day one.
3. ~~**`ci.yml` downloads and executes osv-scanner with no checksum.**~~ **RESOLVED** — see "What was
   fixed" §8. On re-reading, this was never a contract decision: verifying a download changes nothing
   about what gates a merge, what a check is named, or when it runs, and a correct artifact produces
   an identical result. It was only an OWNERSHIP blocker, so it was taken rather than filed. The
   repo-wide guard is now unblocked (no unverified download remains in `.github/workflows`) and is
   listed as a follow-up rather than a permanent exception.
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

**`dependency-review.yml` — FALSIFIED 2026-08-21, and it found more than the audit expected.**

Done from the throwaway PR this section called for: PR #1950, opened against `develop` and closed
unmerged, carrying `@substrate/connect-extension-protocol@2.2.2` — `GPL-3.0-only` with ZERO
dependencies, so the lockfile moved by seven lines.

A real copyleft package rather than the `pako` probe suggested here, and that turned out to be the
stronger choice: it exercises the case the policy actually exists for, and `pako`'s
permissive-but-unlisted leaf would not have exposed what follows.

**Two runs, and only the second means anything.** Same package, version, license and lockfile entry;
only the dependency SCOPE differs:

| form              | `Licenses` group                  | check       |
| ----------------- | --------------------------------- | ----------- |
| `devDependencies` | **empty**                         | SUCCESS     |
| `dependencies`    | `…@2.2.2 – License: GPL-3.0-only` | **FAILURE** |

So the check CAN fail and it names the right thing — for runtime dependencies. A DEVELOPMENT-scoped
dependency is outside the gate entirely: the action defaults `fail-on-scopes` to `runtime` and the
workflow sets no override. The empty `Licenses` group in the first run is what "not evaluated" looks
like, as distinct from "evaluated and allowed".

That is exactly the failure shape this audit exists to find — a green trusted for more than it
measures — and it was invisible to the structural evidence that put this row at "Matches". Filed as
issue #1951 rather than fixed here, because choosing between "state the exemption" and "extend the
gate" is a licence-policy decision.

INFRA-047's Test Plan is the corroboration: it says "a test PR introducing a GPL DEV-dep is BLOCKED",
which is a case that cannot fail. Written by someone who believed dev deps were gated.

**`codeql.yml` — FALSIFIED 2026-08-21, by an unplanted defect.**

The PR-annotation path this section says was unproven is proven by PR #1945, and the defect was real
rather than planted — which is the stronger evidence, because a planted one is written to be found.

Four alerts were annotated by `github-advanced-security` on lines the PR itself added, in
`scripts/harness/__tests__/redirect-target-has-one-owner.test.mjs`:

| alert                                            | severity | outcome                             |
| ------------------------------------------------ | -------- | ----------------------------------- |
| `js/unnecessary-use-of-cat`                      | error    | **blocked the merge gate**          |
| `js/shell-command-injection-from-environment` ×3 | warning  | annotated on lines 125, 176 and 193 |

So the workflow reports, the alerts reach the PR as review threads on the exact lines, and
`review-gate` routes on the blocking one. Both halves of the path are exercised.

Both alerts were fixed rather than acknowledged: `readFileSync` in place of the `cat` process, and
the library path passed as an ARGUMENT rather than interpolated into a `bash -c` program text.

This leaves NO check in this audit resting on a hypothesis.

## The mechanical ceiling

Stated plainly, because this sweep is not exhaustive and should not be read as such:

- **A weak ruleset passes every structural check.** These audits prove a scanner _runs_, _can fail_,
  and _examines the claimed surface_. None of them prove the ruleset is good. gitleaks' default rules
  will miss a credential format they do not model; CodeQL's `security-and-quality` suite will miss a
  vulnerability class it has no query for. Both would stay green, and no scan I can write detects that.
- **The gitleaks measurement covers the current tree.** "0 findings on a clean tree" is a statement
  about today's files. It bounds the noise the narrowing adds now, not forever.
- **Every check in this audit has now been falsified** (the last two on 2026-08-21). That closes the
  audit's own weakest claim, and it was worth doing: falsifying `dependency-review` found a scope gap
  the structural evidence had rated "Matches". The ceiling below still applies — a falsified check is
  one proven able to fail on the case tried, not one proven to catch everything.
- **"All 76 scans passed" is weaker evidence than it reads.** This audit's own verification leans on
  `pnpm harness:scan` being green, and HARNESS-052 measured ~30 entries of that same suite reporting a
  pass over an absent governed tree. None of THIS item's findings rest on those scans — every one is
  backed by a planted defect or a real run — but the suite-level green underneath the verification
  section inherits that weakness, and saying so is cheaper than being caught by it later.
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
token is now generated at run time), NOT to add `.agents/tasks/` to an allowlist. Widening the
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

### Scenario 4 — `ci.yml` refuses a swapped osv-scanner binary

**Prerequisites:** a clone at this branch; `curl`, `sha256sum`.

**Steps:** run what `ci.yml` runs, against a good artifact and then a tampered one. The step body is
never re-typed — it is read out of the workflow, so the thing under test is what CI executes.

```bash
cd "$(git rev-parse --show-toplevel)"
eval "$(python3 - <<'PY'
import yaml
d = yaml.safe_load(open('.github/workflows/ci.yml'))
for k, v in d['env'].items():
    print(f'export {k}={v}')
PY
)"
export RUNNER_TEMP="$(mktemp -d)"
curl -fsSL "https://github.com/google/osv-scanner/releases/download/${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64" \
  -o "$RUNNER_TEMP/osv-scanner"

# 1. genuine bytes — the verification CI performs
echo "${OSV_SCANNER_SHA256}  $RUNNER_TEMP/osv-scanner" | sha256sum -c -; echo "exit=$?"

# 2. one byte appended: the smallest possible supply-chain swap
printf '\0' >> "$RUNNER_TEMP/osv-scanner"
echo "${OSV_SCANNER_SHA256}  $RUNNER_TEMP/osv-scanner" | sha256sum -c -; echo "exit=$?"
```

**Expected:** `OK` / `exit=0`, then `FAILED` / `exit=1`. Under `set -e` (both steps set it) the second
aborts the job before `chmod +x`, so the swapped binary is never executed.

**Cleanup:** `rm -rf "$RUNNER_TEMP"`

**Evidence:** Run on this branch, driven by a harness that extracted both step bodies from the parsed
`ci.yml` and executed them with the download shimmed:

```
pre-fix  ci.yml + tampered artifact   exit 0   left executable: YES   ← the defect
post-fix ci.yml + tampered artifact   exit 1   left executable: no
post-fix ci.yml + genuine artifact    exit 0   Scanned … 2130 packages / Filtered 5 / No issues found
```

Both osv-scanner steps were exercised in every row. Independently recomputed digest:
`3abcfd7126c453a00421487e721b296e0cb68085bd431d6cef60872774170fc8` (41,324,728 bytes).

## Progress

### 2026-08-21 — the two hypotheses are now measurements

This item's per-workflow table carried two rows at "No — hypothesis", and its own text says why that
mattered: "this repo has five recent cases of a green check that was doing nothing". Both are closed.

**`dependency-review.yml`** — falsified from the throwaway PR the item called for (PR #1950, closed
unmerged). It found more than the audit expected: the check fires correctly on a runtime dependency
and does not evaluate a DEVELOPMENT-scoped one at all. Filed as issue #1951, because choosing between
"state the exemption" and "extend the gate" is a licence-policy decision rather than a CI fix. The
audit had rated this row "Matches" on structural evidence; falsification is what corrected it.

**`codeql.yml`** — falsified by PR #1945, from a defect nobody planted. Four alerts annotated on
lines that PR added, one of them blocking `review-gate`. An unplanted defect is stronger evidence
than a planted one, because a planted defect is written to be found.

Neither needed new tooling. What they needed was a change that actually carried a defect through the
gate, which is the point the item makes about structural evidence.

The mechanical ceiling stated in this item is unchanged and still applies: a falsified check is one
proven able to fail on the case tried, not one proven to catch everything.
