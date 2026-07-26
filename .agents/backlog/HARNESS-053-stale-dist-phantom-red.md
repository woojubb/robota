---
id: HARNESS-053
title: 'HARNESS-053: a stale dist makes `pnpm typecheck` report a phantom breakage of a healthy branch'
status: in-progress
priority: medium
urgency: soon
type: INFRA
area: scripts/harness
created: 2026-07-26
depends_on: [HARNESS-052]
---

## Problem

HARNESS-052 records the class "a check that reports success over work it did not do". This item
records the **inverse** of the same root cause, which has now cost a full investigation cycle: a
check that reports **failure over work that is fine**.

`pnpm typecheck` resolves a cross-package import (`@robota-sdk/agent-tools` from
`packages/agent-framework`) to the producing package's built `dist/*.d.ts`, not to its source. When
that `dist/` predates the source, `tsgo` compares NEW consumer source against an OLD producer type
surface. Every resulting error is a real TypeScript error about an unreal state of the repository.

**Reproduced 2026-07-26.** `origin/develop` @ `39cb7a074` was reported broken with three specific
failures. All three were artifacts of a partially stale `dist/` in one working tree:

| Reported failure                                                                                      | Actual cause                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isPathInside` "not exported from `agent-core/src/index.ts`"                                          | It **is** exported, transitively: `src/index.ts` → `export * from './utils'` → `utils/index.ts` → `export * from './path-containment'`. Present in `dist` since SEC-006.                                                                                                                                                                                                                                                                                                                |
| `assertSafeSessionId` / `isSafeSessionId` "missing from the `agent-session` barrel"                   | `packages/agent-session/src/index.ts:63` exports both. The **stale** `agent-session/dist` (built 07-25 23:44, before SEC-006 landed) did not contain them.                                                                                                                                                                                                                                                                                                                              |
| `TS2559` on `createGlobTool(options)` / `createGrepTool(options)` in `assembly/create-tools.ts:66-67` | Stale `agent-tools/dist` still declared the pre-SEC-007 `createGlobTool(options?: IBuiltinToolDescriptionOptions)`. That type is `{ description?: string }` — a **weak type** with zero properties in common with `ICreateDefaultToolsOptions` (`sandboxClient?`/`cwd?`/`retrievalAdapter?`/`computerDriver?`), which is exactly what TS2559 reports. Current source takes `IContainedBuiltinToolOptions` (`extends IBuiltinToolDescriptionOptions` + `cwd?`), and the call typechecks. |

The barrel exports were correct **in the SEC-006 commit itself** (`git show
0c0dcd247:packages/agent-core/src/utils/index.ts` and `:packages/agent-session/src/index.ts` both
contain them). No PR ever landed the described breakage, so there is no "how did this reach develop
green" to answer and no scope-calculator gap: the scope calculator was never the reason, because
there was never a defect for it to miss.

The danger is symmetric and the _other_ direction is the serious one. A stale `dist` can equally
**hide** a real cross-package type error, and that failure mode is silent.

## Why the existing guard does not catch it

`scripts/harness/scan-dist-freshness.mjs` is a **presence** gate wearing a temporal name — its own
header says so (HARNESS-052), and the falsification is recorded there: `touch
packages/agent-core/src/index.ts` leaves the source newer than its dist and the scan still exits 0.
So `pnpm harness:scan` is green on precisely the tree that makes `pnpm typecheck` red.

The one entrypoint that is immune is `pnpm harness:verify-like-ci`, whose `build` stage exists
for this exact reason and rebuilds rather than trusting the presence scan. On the tree investigated
here it reported `PASS — all 11 stage(s) passed`, while a bare `pnpm typecheck` against the stale
tree reported the three failures above.

## Proposed guard

Make dist staleness **detectable** rather than inferable, so a stale local tree cannot masquerade as
a branch breakage:

1. Give `scan-dist-freshness.mjs` an actual freshness comparison: for each buildable package, the
   newest `src/**` mtime must not exceed the newest `dist/**` mtime. Emit a **warning** (not a
   failure) — mtimes are not a correctness oracle and a false red here would be its own vacuous
   gate. The point is a legible message at the moment of confusion, not a new blocking check.
2. Have `pnpm typecheck` fail _fast and explanatorily_ when it is about to compare source against a
   dist older than that source, naming `pnpm build` / `pnpm harness:verify-like-ci` in the message.
3. Route the diagnostic instruction: "a cross-package type error that only appears in a
   whole-workspace typecheck" should first be re-checked after `pnpm build`, before it is treated as
   a branch defect.

Each must be proven RED before the fix per `check-regression-red-proof` — a guard for a staleness
bug that was never demonstrated to detect staleness is the HARNESS-052 defect recurring inside its
own remedy.

## What was built

Point 1 only, done properly. Points 2 and 3 are **not implemented** and the reason is ownership,
not judgement — see [Not implemented](#not-implemented-and-why).

`scripts/harness/scan-dist-freshness.mjs` now performs a genuine freshness comparison alongside the
presence gate it already was. Per buildable package: the newest **emitted-source** file under `src/`
versus the newest artefact under `dist/`. Tests, mocks, fixtures and non-source extensions are
excluded — `tsconfig.build.json` keeps them out of the build, so they move no declaration and a
stale verdict drawn from one would be a false alarm.

The rule is decomposed into four separately-testable pieces (`isEmittedSourceFile`, `walkTree`,
`freshnessVerdict`, `presenceResults`) precisely because HARNESS-052's own guard shipped three
defects of which **two masked each other** — a defect pair only reachable when rules are exercised
together and never alone.

### mtime, deliberately

The item asked for a considered answer rather than a default, so: **mtime is the oracle, it is
evidence and not proof, and each caveat was traced to which direction it cuts.**

| Situation                                                    | Effect on this rule                              | Verdict                                                                                          |
| ------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| fresh clone / cold checkout                                  | no `dist` at all ⇒ nothing to compare            | **silent** — pinned by a test                                                                    |
| `git checkout` / rebase / stash pop                          | touched sources newer than the other tree's dist | **true positive** — that dist _is_ stale                                                         |
| restored build cache / CI artefact download                  | `dist` arrives with a new mtime ⇒ reads fresh    | **false negative** — as silent as the presence-only check already was; it never fabricates a red |
| source reverted to the exact content its dist was built from | newer mtime, identical content                   | **false positive** — the only realistic one, and the reason the rule is advisory                 |

Only the last row produces a wrong red, and only advisorily. The sound alternative — a **content
hash of the emitted-source set stamped into the build output** at build time and compared here —
removes every row above. It is not implemented because stamping requires changing the build
pipeline (`tsdown` config, package `build` scripts, or the root `build` script), all outside this
item's ownership. Recorded as the upgrade path; **not** judged unnecessary.

### Blocking vs advisory

**Advisory. Staleness never changes the exit code**, and that decision is itself pinned by a test
(`reports staleness but EXITS 0`) so it cannot drift silently. Four reasons, in descending weight:

1. **It can fire on correct state.** The reverted-file row above is a real false positive. The
   item's own instruction is that a check firing on correct state is not an acceptable outcome.
2. **The suppression path is already wired.** `ci.yml` carries a `--skip dist` argument. A gate that
   reddens on a legitimately-cold or legitimately-reverted tree would be routed through it within a
   week, and then neither half of the scan runs.
3. **The blocking enforcement already exists and is sound.** `verify-like-ci`'s `build` stage
   rebuilds rather than trusting this scan — it does not need a second, weaker gate beside it.
4. **Precedent.** The same reasoning is recorded in this repo for `review-gate`'s severity split and
   for the slug-equality rule that would have fired on 34 of 111 correct pairs.

The presence half stays blocking, unchanged.

### Two HARNESS-052 findings in the same file, repaired alongside

- **The operator-precedence bug** (`scan-dist-freshness:59` in HARNESS-052's notes) that downgraded
  a genuine missing-dist ERROR to a non-blocking warning for a `main`-only package. Blast radius
  **measured**: 3 packages change classification (`apps/action`, `apps/agent-app`,
  `apps/agent-server`), all `private: true` and short-circuited before that branch, so no live
  verdict moves.
- **The banner's universal claim.** `All 86 buildable packages have dist/` was measured to assert
  presence for **31**; the other 55 produce no presence result at all. Same shape as HARNESS-052's
  G1. It now states the count it actually covered.

### The audited defect, found live inside this item's own remedy

Registering the finder in `scan-guard-scope-fail-closed` **by measurement** — as instructed, and as
HARNESS-052's guard was caught not doing — went in three steps, and the third one paid:

1. `measureFinder` on `collectDistFreshnessResults` against a bare root: still `fail-closed`, so the
   existing ledger entry is accurate and unchanged.
2. But **incidentally** so: `finder(bare)` supplies one argument, `scopes` is undefined, and
   `scopes.filter` throws. A missing-argument crash, not a governed-tree check. This finder has no
   tree of its own — its subject is the package set the _caller_ enumerates. It therefore stays in
   `PENDING_CLASSIFICATION` rather than being promoted to `MANDATORY_TREE_GUARDS`, where it would
   certify a property it does not hold. The ledger now records that reasoning instead of the bare
   verdict.
3. The gap step 2 leaves was **measured rather than asserted**: the CLI's `main()` _does_ enumerate,
   via `listWorkspaceScopes()`. Run against a `pnpm-workspace.yaml` resolving to zero packages, it
   printed `dist/ present on all 0 package(s)` and **exited 0** — a green pass over a scan that
   measured nothing, which is exactly the class HARNESS-052 audits. Now an exit 1, pinned by a test.
   (A root with no manifest at all already threw out of `listWorkspaceScopes` — also measured, not
   assumed.)

## Falsification record

### 1. The HIDING direction — proven

The dangerous, symptomless direction. Constructed with the repo's own toolchain (`tsc` to emit,
`tsgo` to check), reproducible via the fixture script recorded in this item's PR discussion.

| Step | State                                                                         | `typecheck`                                           |
| ---- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1    | producer built from v1 `export function greet(): string`                      | —                                                     |
| 2    | src → v2 `export function greet(name: string): string`; **dist not rebuilt**  | —                                                     |
| 3    | consumer `greet()` — genuinely broken against v2 — checked against stale dist | **exit 0**                                            |
| 5    | producer rebuilt, **identical consumer source** re-checked                    | **exit 1**: `TS2554: Expected 1 arguments, but got 0` |

The stale dist silently hid a real cross-package type error. At step 4 the new rule reported
`@fx/producer: dist/ may be STALE — src/index.ts is 1s newer than the newest artefact
dist/index.d.ts`, tally `{measured:1, fresh:0, stale:1, unmeasurable:0}`; at step 6, after the
rebuild, it was silent with `{measured:1, fresh:1, stale:0, unmeasurable:0}`.

### 2. The PHANTOM direction — proven

| Step | State                                                       | `typecheck`                                                                     |
| ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1    | producer built from v1 (exports `greet`)                    | —                                                                               |
| 2    | src adds `export function farewell()`; **dist not rebuilt** | —                                                                               |
| 3    | consumer imports `farewell` — **correct** source            | **exit 1**: `TS2305: Module '"@fx/producer"' has no exported member 'farewell'` |
| 5    | producer rebuilt, identical consumer source                 | **exit 0** — the breakage was never real                                        |

Same error family (`TS2305`) as two of the three failures in the incident table above. Again the
rule reported the staleness at step 4 and went silent at step 6.

### 2b. The same falsification HARNESS-052 recorded, replayed on the real repo

`touch packages/agent-core/src/index.ts` on a freshly-built tree:

- **old scan** (`origin/develop`): `All 86 buildable packages have dist/`, **exit 0** — and
  `✅ @robota-sdk/agent-core: dist/ present` printed for the stale package itself.
- **new scan**: `🕒 @robota-sdk/agent-core: dist/ may be STALE — src/index.ts is 5m 35s newer than
the newest artefact dist/node/index-Bcx57CtY.d.ts`, `freshness: 1 stale / 75 compared`,
  **exit 0** (advisory).

### 3. No regression — proven, both halves

- **Genuinely fresh tree.** Immediately after a green `pnpm build`, on the real workspace:
  `freshness: 0 stale / 75 compared (11 not comparable: no src/ or no dist/)`. **Zero false
  positives on correct state.** No timing tolerance was needed; the 11 not-comparable scopes are
  ten `apps/*` that `pnpm build` does not build plus `packages/agent-cli-web` — every package under
  `packages/**` that has a dist is compared.
- **Genuinely cold checkout, no `dist` at all.** Reported `unmeasurable`, not stale — the presence
  rule still owns the missing dist and freshness adds no second verdict on top. This is the case
  that separates a freshness check from the presence check it replaces, and it is pinned twice
  (unit + integration).

### Per-rule mutation testing, and the one it caught

Seven single-rule mutations were applied to the shipped scan and the suite re-run against each.
Six failed 1–9 tests. **The seventh — reinstating the banner overclaim — failed ZERO**, because the
CLI fixture had one package, so `presenceAsserted === buildableCount` and the mutation was
invisible. A test with the two counts deliberately different was added and the mutation re-run
until it went red.

That is the item's own warning landing: a rule was shipped, reviewed and green with no test
underneath it, and only mutation found it. It was found by **measuring**, not by reading.

| Mutation                                    | Tests failed                               |
| ------------------------------------------- | ------------------------------------------ |
| freshness comparison removed (always fresh) | 4                                          |
| cold-checkout guard removed                 | 2                                          |
| test/mock/fixture exclusion removed         | 9                                          |
| extension allowlist removed                 | 3                                          |
| freshness made blocking                     | 1                                          |
| presence precedence bug reinstated          | 2                                          |
| banner overclaim reinstated                 | **0 → 1** after the missing test was added |

## Not implemented, and why

Stated plainly rather than quietly dropped:

- **Point 2 — `pnpm typecheck` failing fast and explanatorily.** Requires editing the root
  `package.json` `typecheck` script, outside this item's ownership. The diagnostic text it would
  have carried is instead emitted by this scan when staleness is found.
- **Point 3 — routing the diagnostic instruction into the rules/skills tree.** `.agents/rules/**`
  and `.agents/skills/**` are outside this item's ownership. The instruction ("a cross-package type
  error seen only in a whole-workspace typecheck should be re-checked after `pnpm build` before it
  is treated as a branch defect") is emitted verbatim by the scan when it finds staleness, so it is
  at least reachable at the moment of confusion.
- **The content-hash oracle.** See [mtime, deliberately](#mtime-deliberately). Blocked on
  build-pipeline ownership, not on judgement. This is the one upgrade that would make a **blocking**
  freshness gate defensible.

## Known ceilings

- **`run-all-scans` discards a passing scan's output.** Under `pnpm harness:scan` the freshness
  advisory is counted in this scan's own summary but its per-package lines are not displayed. That
  is HARNESS-052's still-open "`run-all-scans` distinguishes ran-and-found-nothing from
  ran-and-measured-nothing" item and cannot be fixed from inside this file. Run the scan directly —
  the diagnostic moment it exists for — to see the packages named.
- **A restored cache or downloaded artefact reads fresh.** False negative, unchanged from the
  presence-only behaviour.
- **The rule compares timestamps, not content.** It cannot see a `dist` that is byte-identical to
  what the current source would emit, nor one whose staleness is confined to a file the newest-mtime
  comparison does not reach.

## Acceptance

- [x] Falsification recorded: with a deliberately stale `dist` the new check warns; with a fresh one
      it is silent. Both directions (hiding **and** phantom) proven, plus the real-repo replay.
- [x] `scan-dist-freshness`'s name and behaviour agree — it now measures freshness, so HARNESS-052's
      open "rename it to match what it checks" line is moot rather than pending. The `--skip dist`
      argument in `ci.yml` needs no change.
- [x] No new blocking check that can fire on a correct tree: freshness never changes the exit code,
      measured at 0 stale / 75 compared on a freshly-built workspace.
- [x] Each rule of the check tested separately, and the one rule that had no test found by mutation.
- [x] Registered in `guard-scope-fail-closed` by measurement — which surfaced and fixed a live
      pass-over-nothing in this scan's own CLI.
- [ ] Content-hash build stamp replaces mtime, making a blocking freshness gate defensible
      (needs build-pipeline ownership).
- [ ] `pnpm typecheck` fails fast with the staleness explanation (needs root `package.json`).
- [ ] The diagnostic is routed into the rules/skills tree (needs `.agents/rules|skills` ownership).
