---
title: 'INFRA-063: the release sweep calls itself FULL and walks past five workspaces — one of which has a suite'
status: in-progress
created: 2026-07-26
priority: medium
urgency: soon
area: package.json, .github/required-status-checks.json, scripts/harness
depends_on: []
---

# INFRA-063 — the release sweep is not the FULL sweep it is declared as

Filed out of INFRA-060 **D7**, split from it deliberately. D5 (the `security audit` →
`dependency audit` rename) and D7 look like the same over-claim, and the first thing this item
records is that **they are not the same shape and must not get the same fix.**

## Why this is not a rename

D5's over-claim lived in the **required-context NAME**, which is the string branch protection
matches on — so correcting it was a ruleset change with a merge-window hazard, and the behaviour
underneath was already correct.

D7's over-claim is not in a context name. `release-grade verification` does not itself claim to be
full. The word **FULL** appears in the DECLARATION PROSE:

- `.github/required-status-checks.json` → `branches.develop.deliberately_not_required` →
  "`release-grade verification` subsumes them: it runs the FULL build and the **FULL
  scan/test/typecheck/lint sweep**"
- `.github/required-status-checks.json` → `branches.main` → `release-grade verification` →
  "full build, full scan suite, harness suite, **package tests**, binary e2e, typecheck, lint"

So **no ruleset change is required to fix D7**, and it carries none of D5's hazard. That is the
whole reason it can be worked at any time rather than against an empty PR queue.

## The measurement

```
$ node -e "console.log(require('./package.json').scripts['harness:verify:release'])"
pnpm build:deps && pnpm harness:scan && pnpm harness:test && pnpm test
  && pnpm --filter @robota-sdk/agent-cli test:bin && pnpm typecheck && pnpm lint

$ node -e "console.log(require('./package.json').scripts.test)"
pnpm run -r --if-present test
```

`--if-present` walks past every workspace with no `test` script, silently. Measured — five
workspaces, with their source counts and what they DO declare:

| Workspace                | `test`? | Other suite      | Source files | Test files |
| ------------------------ | ------- | ---------------- | ------------ | ---------- |
| `packages/agent-cli-web` | no      | **`test:e2e`** ✱ | 2            | 0          |
| `apps/docs`              | no      | —                | 27           | 0          |
| `apps/www`               | no      | —                | 20           | 0          |
| `apps/blog`              | no      | —                | 9            | 0          |
| `apps/starter-nextjs`    | no      | —                | 3            | 0          |

✱ **This is the real finding, and it is a coverage gap rather than a wording one.**
`packages/agent-cli-web` declares a `test:e2e` script. `pnpm run -r --if-present test` matches the
script named exactly `test`, so `test:e2e` is never invoked by the release gate — a suite that
exists, is maintained, and is not run on a promotion.

It is also a gap the repository has already recognised once and closed by hand for a different
package: `harness:verify:release` explicitly appends
`pnpm --filter @robota-sdk/agent-cli test:bin`, a suite under a non-`test` name that had to be named
individually to be run at all. `agent-cli-web`'s `test:e2e` is the identical case, and simply was
not added.

The other four are private Astro/Next/Docusaurus site workspaces with genuinely no suite to run.
They are not uncovered — the same release command runs `pnpm typecheck` and `pnpm lint` over them —
but `pnpm test` legitimately has nothing to execute there.

## Nothing guards the absence

`scripts/harness/check-test-coverage-scripts.mjs` exempts a workspace from the coverage requirement
by the absence of the very script the requirement is about:

```js
export function isCoverageScriptRequired(scope) {
  const testScript = scope.scripts?.test;
  if (typeof testScript !== 'string') {
    return false; // no `test` script → nothing required
  }
  return /\b(vitest|jest)\b/.test(testScript);
}
```

A workspace that never grows a `test` script is therefore permanently and silently exempt, and a
workspace that puts its suite under any other name (`test:e2e`, `test:bin`) is exempt too. So the
class is not five workspaces — it is "any suite not named `test`", which is why a per-instance fix
is not enough on its own.

## What to do

1. **Run the suite that exists.** Add `agent-cli-web`'s `test:e2e` to `harness:verify:release` the
   way `agent-cli`'s `test:bin` already is — or, better, stop hand-maintaining that list.
2. **Enumerate rather than pattern-match.** A guard that lists every workspace-declared script
   matching `^test(:|$)` and asserts each is reachable from `harness:verify:release` would have
   caught both instances, and catches the next one. Prove it RED against the live defect (drop
   `test:bin` from the release script and require the guard to report it) before landing it.
3. **Correct the prose either way.** Whatever coverage lands, the two declaration strings above
   should state what the sweep actually spans. If four site workspaces are deliberately test-free,
   the declaration should say so — a named, reasoned exclusion is honest where "FULL" is not.
4. Decide, and record the number, whether the four site workspaces should be required to carry a
   suite at all. This item's position is no — but the position should be written down, because an
   unexamined absence is what produced this finding.

## Test Plan

- The new guard run RED against the reverted defect (release script with `test:bin` removed) and
  GREEN after — the guard must be falsified, not merely observed passing.
- `pnpm harness:scan`, `pnpm harness:test`, `pnpm harness:verify-like-ci` green.
- `pnpm harness:verify:release` executes `agent-cli-web`'s `test:e2e` — shown by its output, not
  inferred from the script text.

## User Execution Test Scenarios

Not applicable — a CI/verification-gate change delivers no runnable user-facing surface. The
evidence is the guard's red-then-green proof and the release sweep's own output.

---

# Implementation record (2026-07-26)

## The premise above was wrong in one specific, load-bearing way

This item was filed on the reading that `packages/agent-cli-web` declares "a suite that exists, is
maintained, and is not run on a promotion". Measured, it does not exist:

```
$ pnpm --filter @robota-sdk/agent-cli-web run test:e2e
Error: Cannot find module '/…/packages/agent-cli-web/e2e/run-smoke.mjs'
  code: 'MODULE_NOT_FOUND'

$ git rev-list --all -- 'packages/agent-cli-web/e2e/*'
(no output — the directory has never existed in any commit on any branch)
```

`"test:e2e": "node e2e/run-smoke.mjs"` shipped with GUI-007 (#1249) pointing at a file that was
never written. **So action 1 as filed — "add `agent-cli-web`'s `test:e2e` to
`harness:verify:release`" — would have made `release-grade verification` fail on every promotion
from the moment it landed**, on a context required by `protect-main`. The script was removed
instead (`packages/agent-cli-web/package.json`), which is a change to that package's test script
with the reason on the record, per the item's own action 1 being unsatisfiable as written.

The generalisation the item asks for is what actually catches this class, and it catches this
instance too: a hand-maintained list cannot notice a dead entry point, because a list only knows
what someone remembered to write down.

## What landed

**`scripts/harness/release-test-suites.mjs`** — enumerates every workspace script matching
`^test(:|$)` and sorts each into exactly one bucket: swept by `pnpm test`, run by this module, or
excluded with a KIND and a reason. It replaces the hand-written
`pnpm --filter @robota-sdk/agent-cli test:bin`, which it now discovers rather than being told, so
the second hand-written `--filter` line the item warned about was never added. Workspace membership
comes from `pnpm-workspace.yaml`, not from a hardcoded `packages`/`apps` pair.

**`scripts/harness/scan-release-sweep-coverage.mjs`** — registered in `pnpm harness:scan`. Five
rules: R0 vacuity (zero discovered scripts is a failure), R1 classification completeness, R2
reachability against the ACTUAL release string (expanded through the root scripts it calls), R3
exclusion integrity, R4 liveness. 17 fixture tests in
`scripts/harness/__tests__/scan-release-sweep-coverage.test.mjs`.

Registered in `guard-scope-fail-closed`'s `MANDATORY_TREE_GUARDS` on a **measured** verdict, not an
assumed one — `measureFinder` was run against a bare root before the entry was written, and returns
`fail-closed` because `readWorkspaceGlobs` throws deliberately rather than enumerating zero
manifests. `MANDATORY_TREE_GUARDS` is now 12 guards proven fail-closed by execution (was 11).

## The guard's red proof

**Against the live defect, unmodified tree** — the state this item was filed over:

```
$ node scripts/harness/scan-release-sweep-coverage.mjs
release-sweep-coverage scan failed (INFRA-063):
  - packages/agent-cli-web#test:e2e: is a suite under a non-`test` name, so `pnpm run -r
    --if-present test` walks past it in silence — and `harness:verify:release` neither invokes
    `scripts/harness/release-test-suites.mjs` nor names `@robota-sdk/agent-cli-web test:e2e`
    itself. …
  - packages/agent-cli-web#test:e2e: runs `node e2e/run-smoke.mjs`, and
    `packages/agent-cli-web/e2e/run-smoke.mjs` does not exist. …
EXIT=1
```

**Against the reverted hand-patch** — `pnpm --filter @robota-sdk/agent-cli test:bin` deleted from
the release script, which is this item's Test Plan requirement verbatim:

```
$ node -e '…delete " && pnpm --filter @robota-sdk/agent-cli test:bin" from harness:verify:release…'
RELEASE SCRIPT NOW: pnpm build:deps && pnpm harness:scan && pnpm harness:test && pnpm test
  && pnpm typecheck && pnpm lint

$ node scripts/harness/scan-release-sweep-coverage.mjs
  - packages/agent-cli#test:bin: is a suite under a non-`test` name, so `pnpm run -r --if-present
    test` walks past it in silence — and `harness:verify:release` neither invokes
    `scripts/harness/release-test-suites.mjs` nor names `@robota-sdk/agent-cli test:bin` itself. …
EXIT=1
```

**Green after the fix:**

```
release-sweep-coverage scan passed — 172 test-named script(s) accounted for: 81 swept by `pnpm
test`, 1 run by scripts/harness/release-test-suites.mjs, 90 excluded by declaration (2 of those
unwired debt: apps/agent-app#test:e2e, apps/agent-app#test:e2e:bundled).
This is not a claim that the release gate runs every suite.
```

The fixture tests were falsified by mutation rather than observed passing: `if (runnerWired)
continue` → `if (true) continue` fails exactly the R2 red case, and removing R4's `existsSync`
fails exactly the dead-entry-point case, with no other test moving.

## What the release gate now covers, and what it does not

RUNS: every workspace script named exactly `test` (81), plus every other `test:*` suite the
enumerator finds — `packages/agent-cli`'s `test:bin` today, and whatever is added next with no edit
to any list.

DOES NOT RUN, by declaration rather than by silence. Each is re-verified by the scan on every run;
a `covered-elsewhere` claim naming a workflow that does not invoke the suite is a finding.

| Suite                                                | Kind                 | Why not on the promotion gate                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-transport-tui` `test:pty`                     | `covered-elsewhere`  | **judged too flaky to add.** PTY e2e against the built binary; runs as the REQUIRED `tui-e2e` context on the develop PR of every commit a promotion carries. Adding it re-runs a satisfied gate and puts terminal-timing flake in front of every promotion — a required gate that flakes gets bypassed. The scan asserts ci.yml really invokes it. |
| `agent-cli` `test:bun`                               | `not-runnable-in-ci` | exits 0 when `bun` is off PATH (DIST-001). No runner here has Bun, so adding it adds a step that passes without executing anything — this item's own defect in miniature.                                                                                                                                                                          |
| `agent-command-workflows` `test:live`                | `not-runnable-in-ci` | `RUN_LIVE_LLM=1` against a real provider; needs credentials the gate does not hold and its verdict depends on a third party.                                                                                                                                                                                                                       |
| `apps/agent-app` `test:e2e`, `…:bundled`             | `unwired`            | Electron + xvfb, and a packaged electron-builder output no CI job produces. **Run by no workflow at all** — recorded as DEBT and printed on every scan pass so it cannot go quiet.                                                                                                                                                                 |
| `test:coverage`, `test:watch`, `agent-web` `test:ci` | `sweep-variant`      | the same suite the recursive sweep already runs, under another reporter or in watch mode. The scan requires the workspace to declare a plain `test`, so a lone suite cannot hide behind the label.                                                                                                                                                 |

## `harness:verify:release` wall-clock

**198.57 s (3 m 18.6 s)**, measured end to end on this machine with `/usr/bin/time`, exit 0. CI's
own figure on promotion #1427 was 7 m 31 s; a hosted runner is slower than this host, so treat the
local number as a floor rather than a prediction.

It is a required context on `protect-main`, so this cost is paid by every promotion. The
enumerating runner adds nothing to it: `test:bin` is the one suite it runs, and the hand-written
line it replaced was already running exactly that. Everything else the enumerator found was
excluded, so no new wall clock and no new flake surface entered a required gate — which was the
constraint, not an afterthought.

The sweep executing the suite, from the run's own output rather than inferred from the script text:

```
release extra test suites: 1 to run (81 swept by `pnpm test`, 90 excluded by declaration,
2 of those unwired debt).

> @robota-sdk/agent-cli test:bin
> vitest run --config vitest.bin.config.ts
 ✓ src/__tests__/e2e/serve-mode.bintest.ts (3 tests) 5666ms

release extra test suites: 1 suite(s) passed.
```

## The `--if-present` class sweep

`--if-present` silently skipping is a pattern, so every repo-wide command was measured, not
inspected. **Question asked: does the command walk past a workspace that has the capability under a
different script name?**

| Command                                                                   | Skips | Any skipped workspace with the capability under another name?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test` = `-r --if-present test`                                      | 21    | **NONE, after this change.** `packages/agent-cli-web` was the only one and its dead `test:e2e` is gone. The other 20 (4 site apps, 15 examples, `scratch`) declare no test-named script at all. `scan-release-sweep-coverage` now keeps this at zero.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm typecheck` = `-r --workspace-concurrency=-1 --if-present typecheck` | **3** | NONE. `examples/github-pr-reviewer`, `examples/slack-bot`, `scratch` declare no typecheck under any name. Not an alias gap — a genuine absence. Worth noting: examples are workspace members specifically so typecheck catches public-surface drift, and two of them opt out of the only check they exist for. **Not fixed here** (`examples/**` is outside this item's file ownership). NB the figure carried in agent memory was "5 workspaces"; measured today it is 3.                                                                                                                                                                                                  |
| `pnpm test:coverage` = `-r --if-present test:coverage`                    | 21    | NONE — same 21 as `pnpm test`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm clean` = `-r --if-present clean`                                    | 24    | NONE. Housekeeping; no verification claim rests on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm lint` = `eslint packages apps --ext .ts,.tsx --cache`               | —     | **Not this class at all.** One eslint invocation over two directories; no per-workspace `lint` script is consulted, so none can be skipped by name. Its blind spot is different: `examples/` and `scratch` are outside both roots, and only `.ts`/`.tsx` are linted (so every `.mjs` under `scripts/harness/` is linted by the pre-commit hook but not by `pnpm lint`).                                                                                                                                                                                                                                                                                                     |
| `pnpm build` = `pnpm --filter "./packages/**" build:js && …`              | **1** | **YES — one live instance, same shape, different command.** `packages/agent-cli-web` is the only `packages/*` with no `build:js`; it declares `build` (`vite build`). So the root build never builds the CLI's web monitor SPA. Nothing is broken today because `packages/agent-cli`'s own `build` shells out to `pnpm --filter @robota-sdk/agent-cli-web build` — but root `pnpm build` runs `build:js` (`tsdown --no-dts`), which does not. **Filed as an observation, not fixed here:** changing the root build script's behaviour is a different blast radius from a verification-gate correction, and belongs with whoever owns the two-name `build`/`build:js` split. |

## Verification

All run in this worktree on 2026-07-26, foreground, after a full `pnpm install` (the first attempt
used `--ignore-scripts`, which left `better-sqlite3` unbuilt and made `dag-adapters-sqlite` fail for
reasons unrelated to this change — a local environment defect, fixed by fetching the prebuilt
binary, not by touching that package).

| Command                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm harness:verify:release` | **exit 0, 198.57 s.** `✓ release-sweep-coverage`; `all 79 scans passed`; `test:bin` executed by the enumerator (output above)                                                                                                                                                                                                                                                                                                               |
| `pnpm harness:scan`           | **`all 79 scans passed`** (78 before — `release-sweep-coverage` is the new one)                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm harness:test`           | **97 files, 1303 tests passed**, including the 17 new fixture cases and `guard-scope-fail-closed`'s ledger-freshness re-measurement                                                                                                                                                                                                                                                                                                         |
| `pnpm harness:verify-like-ci` | **10 of 11 stages green** — `harness-self-test`, `scan-suite-dist-free`, `typecheck`, `build`, `scan-suite`, `affected-verify` (86 scopes), `binary-e2e`, `examples-typecheck`, `tui-e2e`, `commitlint`. `format-check` was red on the first pass (prettier not yet run over the prose files) and green after. Three stages are declared un-mirrorable locally (`dependency audit`, `windows-shell`, `review-gate`) and print their reason. |

## Item action 4 — should the four site workspaces be required to carry a suite?

Recorded, as the item asked. **No**, and now with the number attached: `apps/blog`, `apps/docs`,
`apps/www` and `apps/starter-nextjs` are private Astro/Next/Docusaurus content shells, 59 source
files between them and 0 test files. They are not uncovered — `pnpm typecheck` and `pnpm lint` both
reach all four. Mandating a suite there would produce four `--passWithNoTests` scripts, which is a
green step that asserts nothing: the precise shape this item exists to remove. What was actually
wrong was that their absence was indistinguishable from `agent-cli-web`'s dead script; the scan now
tells those two states apart.

## Left undone, deliberately

- `.github/workflows/ci.yml` carries the same "FULL test/typecheck/lint sweep" prose in the comment
  above the develop-side jobs (~line 205). That file is outside this change's ownership, so the
  wording there still over-claims and should be corrected by whoever next touches that block.
- `apps/agent-app`'s two Electron e2e suites remain wired to nothing. Recorded as `unwired` debt and
  surfaced on every scan pass rather than closed here — wiring them needs the desktop release
  pipeline, not a promotion gate.
- `pnpm build`'s `build:js` skip of `packages/agent-cli-web`, per the sweep table above.
