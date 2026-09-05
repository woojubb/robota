---
title: 'TEST-013: no global seam prevents a test from being satisfied by host home state'
issue: https://github.com/woojubb/robota/issues/2300
status: todo
created: 2026-09-04
priority: high
urgency: soon
area: vitest.shared.ts, packages/agent-framework/src
depends_on: []
---

# TEST-013: no global seam prevents a test from being satisfied by host home state

Registered as issue #2300. Succeeds
`.agents/tasks/completed/TEST-012-framework-session-init-reads-the-real-user-home-with-no-seam.md`,
which was set `status: skipped` on 2026-08-29 and returned to that issue; no open Task owns the
class today.

## Lane

`Lane: L1`.

Derived from the diff. `vitest.shared.ts` is tooling configuration matching no L2 row in
`.agents/rules/spec-workflow.md` § "Lane floors", so it is L0 on its own. The floor test that keeps
the isolation honest must run **inside** a test process and assert what that process sees, which
places it under `packages/*/src/__tests__/` — a non-comment change under `src/`, floor L1. That is
the diff's highest floor. No new scan is registered, so `scripts/harness/run-all-scans.mjs` (an L2
row with no qualifier, meaning any change to it is L2) is not touched.

## Objective

Make a test that depends on the runner's home directory **fail loudly** instead of passing for a
reason unrelated to the code under test — by giving every vitest process an empty home by default,
in the one file every config inherits, and pinning that with a test that cannot silently stop
working.

## Confirmed defect

Verified on 2026-09-04 against `develop` at `a81cc85b7`.

**The host-defaulting signature is still there.**
`packages/agent-framework/src/contributions/initial-contribution-sources.ts:11-21`:

```ts
export function createDefaultUserContributionSources(
  userHome: string = homedir(),
): readonly IContributionSource[] {
  return [createNodeHostContributionSource(userHome)];
}

/** Compose the initial contribution sources from one explicit trusted-or-restricted decision. */
export function createContributionSourcesForProjectAccess(
  projectAccess: TWorkspaceProjectAccess,
  userHome: string = homedir(),
): readonly IContributionSource[] {
```

**There is no global home isolation.** Across 35 tracked `vitest.config.*` files there is exactly one
`setupFiles` entry (`packages/agent-playground/vitest.config.ts:18`, which imports a jest-dom
matcher), no `env:` key in any config, and no workflow in `.github/workflows/` mentions `HOME` at
all. Isolation today is per-file and ad hoc: 31 test files set `process.env.HOME` by hand, out of
1364 tracked test files.

**Four production signatures default to host home**, plus one that defaults to a factory which does:

- `packages/agent-framework/src/config/settings-source.ts:38` — `userHome: string = process.env.HOME ?? process.env.USERPROFILE ?? '/',`
- `packages/agent-framework/src/contributions/initial-contribution-sources.ts:12` and `:20` — `userHome: string = homedir(),`
- `packages/agent-framework/src/update-check/update-check-cache.ts:33` — `home = process.env.HOME ?? process.env.USERPROFILE ?? '/',`
- `packages/agent-framework/src/commands/skill-execution-port.ts:47` — `contributionSources: readonly IContributionSource[] = createDefaultUserContributionSources(),`

**The precedent for the fix is in the target file already.** `vitest.shared.ts:93-106` does this
exact thing for git's ambient environment, and states why it lives there:

> It lives in the shared ceiling because that is the one file every vitest config in the workspace
> inherits — the same reason the resource limits are here. A fix in one test file would protect one
> test file.

```ts
const GIT_AMBIENT_ENV: string[] = JSON.parse(
  readFileSync(new URL('./scripts/harness/git-ambient-env.json', import.meta.url), 'utf8'),
).variables;

// DELETED, not set to ''. `GIT_DIR=` (empty) is not the same as absent — git reads the empty value
// and the fixture's own `git init` then fails, which turned a silent corruption into four red tests
// pointing at nothing. Deleting in this process is enough: vitest forks inherit its environment.
for (const name of GIT_AMBIENT_ENV) delete process.env[name];
```

## The measurement, run

`ls ~/.claude/skills | wc -l` on this machine reports **79** entries — six times the 13 the original
incident had — so the divergence the issue describes is reproducible here with a wide margin.

Issue #2300's own sizing method, run on `a81cc85b7` over `@robota-sdk/agent-framework` (201 test
files, 1631 tests), same head, only `HOME` differing:

```
===== REAL HOME =====
 Test Files  4 failed | 189 passed | 8 skipped (201)
      Tests  7 failed | 1550 passed | 74 skipped (1631)
REAL_EXIT=1
===== EMPTY HOME =====
 Test Files  4 failed | 189 passed | 8 skipped (201)
      Tests  7 failed | 1550 passed | 74 skipped (1631)
EMPTY_EXIT=1
```

The failing set is byte-identical between the two runs (`diff` of the failing file lists reports no
difference). **Nothing moves with `HOME`, and 7 tests fail either way.** Two things this does and
does not establish, kept apart deliberately:

- It reproduces the issue's finding that the **loud half of the class is currently empty** — for
  this package, on this machine. It says nothing about the other 1163 test files, which were not
  run.
- The 7 failures are a separate condition of this working tree, present under both homes. Whether
  CI agrees was **not** established: `.github/workflows/ci.yml` last ran on `develop` on
  2026-06-15, because it is a pull-request workflow, so there is no CI result for this head to
  compare against. No claim about a local/CI divergence is made here.

So the value of this Task is **preventing recurrence, not clearing a backlog** — which is the
issue's own conclusion, and it is why remedy (1) is preferred over an audit.

## Plan

- [x] TC-01 — Point `process.env.HOME` (and `USERPROFILE`) at a per-run empty directory in
      `vitest.shared.ts`, beside the existing ambient-git scrub, so every vitest config in the
      workspace inherits it. Create the directory rather than pointing at a path that does not
      exist, so a read fails as "empty" rather than as "missing".
- [x] TC-02 — Add the floor test that keeps TC-01 honest: assert inside a test process that
      `os.homedir()` returns the isolated directory. Assert `homedir()` directly rather than
      `pool: 'forks'`, so the floor survives a pool change instead of silently becoming vacuous —
      `homedir()` follows `process.env.HOME` in a forked child and not in a worker thread, and
      `vitest.shared.ts:110` currently sets `pool: 'forks'`.
- [x] TC-03 — Run the full suite under the change and record the result beside the two-run
      measurement above, so the introduction order below is decided by a number rather than an
      estimate.
- [ ] TC-04 — For each test that TC-03 turns red, give it the host state it needs **explicitly** —
      a fixture home it constructs — rather than restoring the real one.
- [x] TC-05 — Add a negative-assertion fixture for the vacuous half named in the issue: a
      `not.toContain(...)` assertion that passes only because host state is absent is shown capable
      of failing by constructing the state it denies, in the suite that owns the original incident.

## Test Plan

- TC-02: the floor test is executed by the normal suite; falsify it by removing the TC-01 assignment
  and confirm it goes red, and by switching the pool to threads in a scratch config and confirming it
  goes red rather than passing vacuously. A floor that stays green under either mutation is not
  measuring the isolation.
- TC-03: `pnpm test` at the workspace root, its summary recorded in this Task.
- TC-05: falsify by deleting the constructed state and confirming the negative assertion goes red —
  that is the whole point of the fixture, and without the falsification it is another vacuous pass.
- `pnpm harness:scan -- --context integration` exits 0 on the branch.

## Execution record

Recorded 2026-09-05 on `develop`, working tree only (nothing committed).

### TC-01 — done

`vitest.shared.ts` creates one `mkdtempSync(join(tmpdir(), 'robota-vitest-home-'))` per vitest
process and assigns `HOME`, `USERPROFILE` and `ROBOTA_VITEST_ISOLATED_HOME` to it, immediately below
the ambient-git scrub and for the same stated reason. **Assigned, not deleted** — the inverse of the
git block directly above it, because with `HOME` absent `os.homedir()` falls back to the password
database and returns the real home anyway, which is the state being removed. The directory is
removed on the config process's `exit`.

### TC-02 — done, and red before TC-01

`packages/agent-framework/src/__tests__/vitest-home-isolation.test.ts`. Six assertions, in the shape
the Task requires: `homedir()` is asserted directly, never the pool.

Before TC-01 (`npx vitest run src/__tests__/vitest-home-isolation.test.ts` in `packages/agent-framework`):

```
 ❯ src/__tests__/vitest-home-isolation.test.ts (5 tests | 4 failed) 13ms
   × publishes the isolated home directory it created
     → ROBOTA_VITEST_ISOLATED_HOME must be set by vitest.shared.ts: expected undefined to be truthy
   × gives this test process the isolated home through HOME, USERPROFILE and homedir()
     → expected '/Users/jungyoun' to be undefined
   × is not the machine's real home
     → expected '/Users/jungyoun' not to be '/Users/jungyoun'
   × the production default, called with NO argument, discovers no user skill
     → expected [ 'agents-sdk', 'arch-audit', …(22) ] to deeply equal []
   ✓ and that emptiness is not the discovery path being broken
```

The fourth line is the defect itself, named: **24** skills from the runner's own `~/.claude/skills`
reached a session assembled through the production default. After TC-01: `Tests 6 passed (6)`.

**The pool mutation did NOT falsify the floor, and the Test Plan's premise for it is stale.** Run
against a scratch config identical but for `pool: 'threads'`, the file stayed green (`6 passed`).
Measured directly on Node v24.13.0: a `worker_thread` inherits the parent's `HOME` and `os.homedir()`
follows it (`main homedir: /tmp | worker homedir: /tmp | passwd: /Users/jungyoun`), so TEST-012's
observation that a worker thread returns the real home does not reproduce on this runtime. The
mutation is therefore not a valid falsification here — it asserts a defeat that does not occur — and
the floor's non-vacuity rests on the removal mutation above, which turned four of its six assertions
red. Asserting `homedir()` rather than the pool remains the right choice: it is what stays true if a
future runtime does diverge.

The `statSync(...).isDirectory()` assertion exists for a second mutation the removal one misses:
deleting the `mkdtempSync` and pointing `HOME` at a bare path would leave every other assertion in
the file green, because an ENOENT root makes host reads a no-op that is indistinguishable from an
empty read.

### TC-03 — full suite run, twice, only `vitest.shared.ts` differing

`pnpm run -r --if-present --no-bail test` — `--no-bail` because plain `pnpm test` stops at the first
failing workspace and never reaches the packages that matter here.

```
===== WITHOUT TC-01 (HEAD vitest.shared.ts) =====
Test Files  18 failed | 1018 passed | 12 skipped
Tests       43 failed | 9865 passed | 136 skipped
NOBAIL_BASELINE_EXIT=1
===== WITH TC-01 =====
Test Files  16 failed | 1019 passed | 12 skipped
Tests       39 failed | 9858 passed | 136 skipped
NOBAIL_EXIT=1
```

The failing FILE sets differ by three entries, and none of the three is TC-01:

| File                                                                      | Side          | Standalone re-run                                                                                                                                                           |
| ------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-framework src/__tests__/vitest-home-isolation.test.ts`             | baseline only | the TC-02 floor, red by construction when TC-01 is absent                                                                                                                   |
| `agent-cli src/subagents/__tests__/git-worktree-isolation-redos.test.ts`  | baseline only | passes with TC-01 (`3 passed`, 6.13s) — a ReDoS timing assertion under a loaded machine                                                                                     |
| `agent-transport-webrtc src/__tests__/pairing-e2e.test.ts`                | baseline only | passes with TC-01 (`2 passed`, 21.07s) — a 20-second WebRTC end-to-end                                                                                                      |
| `agent-command src/plugins/__tests__/project-scope-plugin-loader.test.ts` | TC-01 only    | passes with TC-01 (`3 passed`) — failed as `(0 , createTrustedProjectAccessFixture) is not a function`, a cross-package resolution artefact of the concurrent recursive run |

So **TC-01 turns no existing test red**, and the population TC-04 would migrate is **empty** — which
is what the partial measurement recorded above predicted for one package, now measured across the
whole recursive suite. This is case 2 of the introduction order below: TC-01 lands with no
migration.

### TC-04 — left unchecked deliberately

Its condition — "for each test that TC-03 turns red" — has an empty population, measured above. No
test was migrated, so the box is not ticked: a tick would claim work that was not done. Nothing is
outstanding behind it.

### The 39 remaining failures are the working tree's, not this change's

Present under BOTH homes and in identical form. `packages/agent-framework` standalone, the same
command run twice with only `vitest.shared.ts` differing, reports the same eight failures in the same
five files in the same order (`workspace-project-authority`, `contribution-source`,
`interactive-session-authorized-context-refresh`, `interactive-session-skill-command`,
`interactive-session`), all of the form `The project path resolved outside the trusted workspace
root.` / `Root-anchored access cannot contain empty, current-directory, or parent-directory
segments.` — a workspace-trust condition of this tree, unrelated to `HOME`. `pnpm test` therefore
does NOT exit 0 at the workspace root, and did not before this change either; that completion
criterion is unmet for a reason this Task neither caused nor owns, and no baseline, allowlist or
suppression was added to hide it.

### Rejected instrument, recorded so it is not re-run

`npx vitest run` at the repository root (the root `vitest.config.ts`) reports 87 failed files. It is
not a measurement of this change: that config runs every package under one `environment: 'node'`
process with no package `setupFiles`, so `agent-playground`'s jsdom suites fail on environment
alone, and it collects `scripts/**/__tests__` — which are dispatched by
`scripts/harness/harness-test-tiers.mjs`, not by that config — into a fan-out where single hook
tests take 300–600 s and time out. `pnpm run -r` is the instrument; the root config is not.

### TC-05 — done

`packages/agent-framework/src/__tests__/semantic-role-projection-in-assembled-session.test.ts` (the
suite PR #2296 created, which is where the incident happened) gains
`describe('the negative skill assertions are falsifiable')`. `assembledSystemMessage` takes an
optional home override so the pair runs the same code path twice: once against a home without the
decoy skill, asserting `not.toContain('host-supplied-decoy')`, and once against a home that holds
`.claude/skills/host-supplied-decoy/SKILL.md`, asserting `toContain` — the constructed state the
negative denies. `6 passed (6)`.

### `pnpm harness:scan -- --context integration` — exits 1, for other work

No finding names `vitest.shared.ts`, `vitest-home-isolation.test.ts` or
`semantic-role-projection-in-assembled-session.test.ts`, and `vitest-resource-ceiling` — the scan
that owns the file TC-01 edits — is `✓`. The 20 failing scans belong to other changes present in the
same shared working tree.

## Baseline and introduction order

**This gate can turn existing tests red, and the number is not yet known.** That is the whole risk of
the change, so the order is:

1. TC-01 and TC-02 on a branch, then TC-03 — measure the full suite before anything else is decided.
2. If TC-03 is green, TC-01 lands with no migration: it is then a seam that catches the next
   instance, and the population it would have caught is zero, exactly as the partial measurement
   above suggests for one package.
3. If TC-03 is red, **the red tests are fixed by TC-04 in the same change**. No allowlist, no
   opt-out flag, no per-file suppression: a suppression list here would preserve precisely the
   silent dependence the change exists to remove, and the population is bounded and nameable.

**No baseline file is appropriate for this class**, and that is a deliberate difference from the
ratchet used elsewhere in the harness: a frozen list of tests permitted to read the real home is a
list of tests whose result still moves with the machine.

Two limits of the remedy, stated where the reader meets them rather than discovered later:

- **`HOME` is one surface.** `os.tmpdir()` contents, a globally installed binary, git config, an
  authenticated CLI and a populated package store can satisfy an assertion the same way. This Task
  closes `HOME` and nothing else.
- **It cannot see vacuous negatives.** An assertion that passes only because host state is absent
  passes identically before and after TC-01. TC-05 addresses one instance of that by construction;
  it does not find the others, and no exit-code comparison can.

## Completion criteria

- `vitest.shared.ts` points `HOME` at a created, empty, per-run directory.
- A test asserts that `os.homedir()` inside a test process equals that directory, and goes red when
  the assignment is removed.
- `pnpm test` exits 0 at the workspace root with the change in place.
- The suite result under the change is recorded in this Task next to the two-run measurement above.
- A `not.toContain(...)` assertion in the suite that owns the original incident is shown capable of
  failing, by a fixture that constructs the state it denies.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The change is confined to the test runner's shared configuration and to test files. It
alters no shipped code path, adds no Robota CLI command, no TUI action, no browser flow and no
public SDK export, so a user of the published packages has no product surface whose observable
behaviour changes; the production signatures keep their existing defaults for real callers, and the
effect is visible only inside the repository's own test processes.
