---
id: PERF-006
title: Run TypeScript 6 and 7 side by side — retire the 5.x line entirely
status: done
priority: high
type: INFRA
depends_on: [PERF-004, PERF-005]
created: 2026-07-26
completed: 2026-07-26
---

> **DONE (2026-07-26).** All four acceptance boxes are ticked; see
> [Outcome](#outcome-done-2026-07-26) at the end of this file for the measurement, the before/after
> lint diff, the transitive-consumer audit, the timing, the guard's red/green proof, and the four
> things the work found that this item's premise had wrong.

# PERF-006: TypeScript 6 + 7 side by side, no 5.x

## Decision

Owner decision, 2026-07-26: **stop using TypeScript 5.** Adopt the side-by-side arrangement the
TypeScript team itself prescribes — the native compiler for everything we compile and type-check,
and a 6.x line kept solely for the tools that still need a programmatic compiler API.

## Why this is the arrangement, not a compromise

Researched against primary sources on 2026-07-26.

**TypeScript 7.0 ships no programmatic API.** From the official release announcement:

> "TypeScript 7.0 is here, it does not ship with an API. We expect TypeScript 7.1 to ship with a new
> (and different) API"

**Microsoft's own recommendation is exactly this arrangement.** Same announcement:

> "we have made it a priority to ensure TypeScript can be run side-by-side with TypeScript 6.0 for
> utilities that still need some programmatic access to the compiler"

It names typescript-eslint as the motivating case and ships `@typescript/typescript6` (currently
`6.0.2`) with a `tsc6` binary so the two can coexist without a name collision.

**typescript-eslint cannot support 7 yet, and says so.** Issue
[#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518) was closed
`NOT_PLANNED` 38 minutes after filing. Maintainer `kirkwaiblinger`:

> "typescript-eslint isn't compatible with TS 7 at this time, because there is no TS 7 API at this
> time. There is nothing we can do about this until TS 7 provides an API."

The tracking issue [#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940) is
open and labelled **`blocked by external API`**. Maintainer `bradzacher`: _"We can't integrate without
an API."_

**The mechanism, measured locally.** `@typescript-eslint/typescript-estree@8.61.0` calls
`require("typescript")` in **10 places**, and its published peer range is `>=4.8.4 <6.1.0`. On
`typescript@7`, `require("typescript")` exposes only `version` and `versionMajorMinor`, so it
crashes in `create-program/shared.js`. And the native package has **no parser at all** — PERF-005
established that `unstable/ast` exports `createScanner` and a node factory, with the real parser
inside the Go binary — so aliasing `typescript` at the native package is not a workaround either.

## What actually changes

Less than the framing suggests. **No alias package is needed here.** `@typescript/typescript6` exists
to let `typescript@7` occupy the `typescript` name; this repo never installs `typescript@7` — it uses
`@typescript/native-preview` under its own name. So there is no collision, and the change is a
version bump:

|                             | now                              | after                   |
| --------------------------- | -------------------------------- | ----------------------- |
| type-check / build compiler | `@typescript/native-preview` 7.x | unchanged               |
| tool-side compiler API      | **`typescript@^5.9.3`**          | **`typescript@^6.0.3`** |
| first-party imports of it   | zero (PERF-005)                  | zero                    |

`6.0.3` sits inside typescript-eslint's `<6.1.0` ceiling, so nothing is being forced.

## The work

1. **Bump `typescript` to `^6.0.3`** across every manifest that declares it. PERF-005 measured **177**
   such files — this is the bulk of the change and it is mechanical, but see the risk below.
2. **Prove ESLint still works.** Run the full lint over the workspace before and after and **diff the
   findings**. A parser version bump that silently stops reporting is the failure mode; identical
   output is the acceptance criterion, exactly as PERF-005 required of its four migrated scans.
3. **Prove the 7.x path is untouched** — `pnpm typecheck` still runs `tsgo`, still 99/99, and the
   PERF-004 timing does not regress.
4. **Watch for 5→6 breaking changes.** A major bump is not a no-op: 6.x removed deprecated APIs and
   tightened defaults. The four TS-API consumers PERF-005 migrated no longer touch this package, so
   the blast radius is the ESLint parse path and anything else resolving `typescript` transitively —
   enumerate those before assuming there are none.
5. **Update the guard.** `scan-legacy-typescript.mjs` currently fences new imports; extend it so a
   `typescript` dependency **below 6** is also a finding, otherwise the 5.x line can creep back one
   manifest at a time.

## Exit condition — this arrangement is temporary by design

`typescript@7.1.0-dev.20260725.1` is already published, and 7.1 is the release the announcement says
will carry the new API. When typescript-eslint supports it, the tool-side line goes away and the
repository is single-compiler. **Re-check both issues above rather than waiting for an announcement**;
#10940 is the one that will move.

## Acceptance

- [x] No manifest declares a `typescript` below 6, enforced mechanically.
- [x] Lint findings identical before and after, over the whole workspace, with the diff shown.
- [x] `pnpm typecheck` unchanged in result and not materially slower.
- [x] The guard fails on a reintroduced 5.x declaration (proven red).

## References

- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- typescript-eslint [#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518),
  [#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)
- `.agents/backlog/PERF-005-remove-legacy-typescript.md` — phase 1, and the 177-manifest measurement
  (re-measured here as **97**; see [Outcome §1](#1-the-manifest-count--re-measured-and-it-is-not-177))

---

## Outcome (DONE 2026-07-26)

`typescript` moved from five different 5.x ranges to a single `^6.0.3` across every manifest that
declares it. `6.0.3` was re-confirmed as the latest stable 6.x at the time of the change
(`npm view typescript dist-tags` → `latest: 7.0.2`, `beta: 6.0.0-beta`, and `6.0.3` the highest
non-prerelease below 7).

### 1. The manifest count — re-measured, and it is not 177

This item and PERF-005 both quote **177**. Re-established from scratch by parsing every tracked
`package.json` rather than grepping, the real number is **97**:

| measurement                                                          | count  |
| -------------------------------------------------------------------- | ------ |
| tracked `package.json` files in the repo                             | 103    |
| **manifests declaring `typescript` in a dependency section**         | **97** |
| declarations (file × dependency-key) — no manifest declares it twice | 97     |
| manifests whose raw text matches `/"typescript"\s*:/`                | 97     |
| line hits for `/typescript/i` across all manifests (the grep shape)  | 124    |

124 is the closest grep-shaped figure, and it only reaches that by counting
`@typescript-eslint/eslint-plugin` (4), `@typescript-eslint/parser` (4),
`@typescript/native-preview` (1) and the `harness:scan:legacy-typescript` script name (1). **177 is
not reproducible under any counting rule tried** and appears to be an error carried forward.

97 is consistent with PERF-005's own guard: `legacy-typescript-baseline.json` holds 96 manifests,
plus the root's reasoned exemption = 97.

**The lesson is the method, not the corrected number: parse, do not grep.** The original figure came
from grepping `"typescript"` across manifests, which is a substring match against a namespace where
`@typescript-eslint/*`, `@typescript/native-preview` and even a script name all contain the package
name as a prefix or infix. There is no regex refinement that fixes this reliably — the fix is to
`JSON.parse` each manifest and look up the literal `typescript` key inside a known dependency
section, which is exactly what `scan-legacy-typescript.mjs` already does and is why its baseline had
the right number all along. A wrong count from a grep is not a harmless approximation: it sized this
item's "bulk of the change" at nearly double reality and propagated into three documents before
anyone re-derived it. When a number will be quoted as a measurement, it has to come from a parser.

The ranges that collapsed into one:

| before   | manifests |
| -------- | --------- |
| `^5.9.3` | 47        |
| `^5.3.3` | 32        |
| `^5.5.0` | 12        |
| `^5.7.3` | 4         |
| `^5.7.2` | 2         |

### 2. Lint findings — identical, over two scopes

Captured as ESLint JSON, normalised to one sorted
`file/line/col/endLine/endCol/severity/rule/message` record per finding, and diffed. Both scopes are
byte-identical; `diff` output is empty and the sha256 matches.

| scope                                                                | files | findings | errors | warnings | parse errors | sha256 before | sha256 after |
| -------------------------------------------------------------------- | ----- | -------- | ------ | -------- | ------------ | ------------- | ------------ |
| `pnpm lint`'s exact scope (`eslint packages apps --ext .ts,.tsx`)    | 1,702 | 1,882    | 0      | 1,882    | 0            | `53267f39…`   | `53267f39…`  |
| wider `--no-ignore` sweep — adds test files, `examples/`, `scripts/` | 2,919 | 2,704    | 369    | 2,335    | 11           | `6f2de674…`   | `6f2de674…`  |

The wider sweep exists because `pnpm lint`'s scope is not the whole workspace: `.eslintignore` and
`.eslintrc.json`'s `ignorePatterns` exclude `scripts/**` (652 findings), `examples/`, `apps/docs/`,
`apps/agent-web/` and every `*.test.ts`. Its 369 errors and 11 parse errors are a far more sensitive
signal than the primary scope's uniform 0-error set.

Both captures were taken against the same post-build tree. A first attempt compared a pre-build
before against a post-build after and inflated the file count by 352 `dist/` files; that comparison
was discarded and the before re-captured after reinstalling 5.9.3, rather than explained away.

**Two controls, because "identical" is exactly what a dead parser also produces.**

- **The parse path really loads 6.0.3.** Resolved from ESLint's own require context:
  `@typescript-eslint/parser@7.18.0` → `typescript-estree@7.18.0` → `.pnpm/typescript@6.0.3/…`,
  `ts.version === '6.0.3'`. A stale link to the old copy would have produced the same clean diff and
  meant nothing.
- **Type-aware linting still works under 6.** The baseline has **zero**
  `@typescript-eslint/no-floating-promises` findings, so a checker that silently stopped working
  would be invisible in the diff. Planting a floating promise in `packages/agent-core/src` made the
  rule fire under 6.0.3 — proving `createProgram` and the type checker are live, not just the parser.

### 3. Transitive-consumer audit — every declaration, with its range

Enumerated by walking every manifest materialised in `node_modules/.pnpm` (2,153 store entries)
rather than reading `pnpm why`, which prints a tree and hides optional peers. `devDependencies` of
published packages are excluded — they are never installed for a consumer and cannot constrain
anything.

| package                         | installed | kind           | declared range for `typescript`  | admits 6.0.3? | enforcement               |
| ------------------------------- | --------- | -------------- | -------------------------------- | ------------- | ------------------------- |
| `config-file-ts`                | 0.2.8-rc1 | `dependencies` | `^5.4.3`                         | **NO**        | installs its own copy     |
| `cosmiconfig`                   | 9.0.2     | peer           | `>=4.9.5`                        | YES           | optional peer (warn only) |
| `cosmiconfig-typescript-loader` | 6.3.0     | peer           | `>=5`                            | YES           | peer (install-blocking)   |
| `eslint-config-next`            | 15.4.1    | peer           | `>=3.3.1`                        | YES           | optional peer (warn only) |
| `rolldown-plugin-dts`           | 0.27.14   | peer           | `^5.0.0 \|\| ^6.0.0 \|\| ~7.0.0` | YES           | optional peer (warn only) |
| `ts-api-utils`                  | 1.4.3     | peer           | `>=4.2.0`                        | YES           | peer (install-blocking)   |
| `tsdown`                        | 0.22.14   | peer           | `^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0` | YES           | optional peer (warn only) |
| `tsup`                          | 8.5.1     | peer           | `>=4.5.0`                        | YES           | optional peer (warn only) |

**Zero hard blockers.** `pnpm install` is clean and no new peer warning appeared (the pre-existing
`eslint@9.39.4` vs `^8.56.0` warnings under `eslint-config-next` are unchanged and unrelated).

Named in the brief but absent from the table, because they declare no relationship to `typescript`
at all: `vitest`, `@commitlint/cli`, `next`, `electron-builder`, `next-intl`.

**The one finding: a second 5.x copy now exists.** `config-file-ts@0.2.8-rc1` — reached only via
`apps/agent-app` → `electron-builder@25.1.8` → `app-builder-lib` — takes `typescript@^5.4.3` as a
real **dependency**, not a peer. Before the bump it deduplicated onto the shared 5.9.3 and the tree
held exactly one copy; after, the lockfile carries **both** `/typescript@5.9.3` (used by nothing but
`config-file-ts`) and `/typescript@6.0.3`. Nothing first-party resolves the 5.9.3 copy, and it is a
devDependency that ships in nothing, but the 5.x line has not left the tree entirely — and the guard
cannot see it, because the guard checks _our_ manifests and this declaration is upstream's.

**Say this plainly, because the next person will trip on it.** The goal as stated is "TypeScript 5
is gone", and it is gone from everything this repository declares or resolves. It is **not** gone
from `node_modules`. Anyone running

```bash
find node_modules -name typescript -maxdepth 4    # or: ls node_modules/.pnpm | grep '^typescript@'
```

will still see a `typescript@5.9.3` directory, and that is **expected, not a broken guard**. It is
`config-file-ts`'s own private copy, materialised because the declaration is a hard `dependencies`
entry in a package three levels down from `apps/agent-app`'s `electron-builder`. The guard is
working exactly as designed: it enforces the floor on manifests we own, and it has no authority over
what a third-party package declares for itself. The check that answers "is our compiler 5.x?" is
`node -p "require('typescript/package.json').version"` from the workspace root, which returns
`6.0.3`.

It disappears on its own when `electron-builder` updates the dependency or `apps/agent-app` stops
using it. Forcing it out sooner would mean a `pnpm.overrides` entry pinning someone else's private
dependency to a major it never declared support for — a worse trade than one unused directory.

### 4. The 7.x path is untouched

|                             | before                      | after                                        |
| --------------------------- | --------------------------- | -------------------------------------------- |
| projects reporting `Done`   | 99 / 99                     | 99 / 99                                      |
| `error TS…` lines           | 0                           | 0                                            |
| compiler per project        | 98 `tsgo` + 1 `astro check` | 98 `tsgo` + 1 `astro check`                  |
| `pnpm typecheck` wall clock | **6.240 s**                 | **6.436 / 6.307 / 6.257 / 6.374 s** (4 runs) |

No regression against PERF-004's 6.2 s; the spread across four consecutive after-runs
(6.257–6.436 s) is wider than the difference from the baseline. `pnpm build` 1:35.8 before,
1:25.8 after.

### 5. The one real 5 → 6 breaking change, enumerated rather than absorbed

`pnpm harness:scan` went **68/69** on the bumped tree. The `doc-examples` scan failed with:

```
error TS5101: Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7.0.
Specify compilerOption '"ignoreDeprecations": "6.0"' to silence this error.
```

`scripts/harness/check-doc-examples.mjs` generates a throwaway tsconfig to typecheck README code
blocks, and that tsconfig set `baseUrl`. In 6.0 the deprecation became a hard **error**, not a
warning. Confirmed as version-caused rather than incidental by compiling the identical generated
config with both binaries: `typescript@5.9.3` exit 0, `typescript@6.0.3` exit 1.

It was the **last `baseUrl` anywhere in the tree** — PERF-004 had already cleared every checked-in
tsconfig, which is why nothing else moved, and why the whole blast radius of the tightened default
is one line. Fixed by dropping `baseUrl` and making the `paths` values absolute, not by
`ignoreDeprecations: "6.0"`, which would only re-arm the same failure at 7.0.

Proven behaviour-preserving rather than merely green: same 150 blocks typechecked / 29 skipped, the
new config compiles clean under both 5.9.3 and 6.0.3, `--traceResolution` confirms
`@robota-sdk/agent-core` still resolves to `packages/agent-core/src/index.ts` (source types, not the
built `.d.ts`), and a planted drift — a field absent from `IAgentConfig` — still fails.

### 6. The guard, RED then GREEN

`scan-legacy-typescript.mjs` gains a fifth finding kind, `legacy-typescript-version`: a declared
range that can resolve below 6. It is **not waivable** by the path baseline or the root exemption —
those excuse the dependency's _presence_ while upstream forces it, never its version. Without that,
a baselined manifest reverting `^6.0.3` to `^5.9.3` would be invisible.

- **RED:** with the guard extended and only the manifests reverted to `HEAD`, it reports **97**
  `[legacy-typescript-version]` findings — one per manifest, each quoting its real pre-bump range
  (`^5.7.2`, `^5.9.3`, …). Exit 1.
- **GREEN:** the bumped tree passes, exit 0.
- **The restore is exact:** re-running the bump reproduces a byte-identical diff
  (`sha256 de7714c7…` before and after the round trip), so the proof did not perturb the tree.
- **The tests bind to the floor:** flipping `MINIMUM_MAJOR` to 5 fails 2 of the new tests. 15 new
  tests, 32 in the file; harness suite 1,090 tests / 87 files green.

`lowestMajorAdmitted` is hand-rolled rather than importing `semver`: nothing else in
`scripts/harness` uses it, it is only a transitive dependency of this repo, and a mechanical floor
must not be breakable by an unrelated lockfile change. The input domain is ranges we write in our
own manifests, and every form is covered — each lower-bound operator, `||` unions (lowest
alternative wins), hyphen ranges (right side is an upper bound), x-ranges, comparator sets with no
lower bound. A range it cannot parse is **reported**, not passed: for a ratchet, "cannot prove
`>= 6`" and "is `< 6`" deserve the same answer.

### 7. Four things this item's premise had wrong

1. **177 manifests → 97.** See §1. Not reproducible under any counting rule.
2. **The peer range `>=4.8.4 <6.1.0` is not this repo's.** That is `@typescript-eslint` **v8**'s.
   This repo pins `@typescript-eslint/*@^7.0.0`, resolving **7.18.0**, which declares **no peer range
   for `typescript` at all** — only `peerDependenciesMeta.typescript.optional: true`. Its supported
   range lives in `warnAboutTSVersion.js` as `>=4.7.4 <5.6.0`, a _runtime warning_ rather than an
   install constraint. So the framing "6.0.3 sits inside the `<6.1.0` ceiling, so nothing is being
   forced" does not describe this repo: **5.9.3 was already past 7.18.0's ceiling**, and the bump
   does not introduce a new unsupported-version state, it extends an existing one. The warning stays
   silent because it only prints when `process.stdout.isTTY` — never in CI or a scripted run. It all
   works regardless, and the finding sets prove it, but the reason it works is empirical, not a peer
   range admitting us.
3. **PERF-005's "no first-party code depends on the legacy compiler" is not quite true.**
   `scripts/harness/check-doc-examples.mjs` shells out to `pnpm exec tsc` — the legacy compiler
   **binary**. The PERF-005 guard cannot see it: it detects `import`/`require` of the package and
   manifest declarations, not binary invocations. That is what made the `baseUrl` breakage land on a
   harness scan rather than nowhere. Left as a follow-up rather than widened here, to keep the
   version bump separable.
4. **PERF-005's "ESLint does not use type-aware linting" is false.** True of the root
   `.eslintrc.json`, but `packages/agent-core`, `packages/agent-framework` and
   `packages/agent-transport` each set `parserOptions.project` and enable
   `@typescript-eslint/no-floating-promises` (the INFRA-040 rollout), and `packages/agent-playground`
   pins `tsconfigRootDir`. So the bump exercises `createProgram` and the **type checker**, not just
   the parser — a materially larger API surface for a major to break, and the reason the
   floating-promise control in §2 was worth running.

### Follow-ups, not closed here

- `config-file-ts` keeps a private `typescript@5.9.3` in the tree (§3). Nothing first-party resolves
  it; it disappears when `electron-builder` updates the dependency or `apps/agent-app` drops it.
- The guard does not detect **invocations of the legacy `tsc` binary** (§7.3). Moving
  `check-doc-examples` onto `tsgo` would remove the last such consumer; its tsconfig is already
  `baseUrl`-free and therefore TS7-ready.
- PERF-005 phase 2 — removing `typescript` outright — is unchanged and still gated on upstream.

### Exit condition — recorded, and it is an issue to poll, not an announcement

`typescript@7.1.0-dev.20260725.1` is published and 7.1 is the release that carries the new
programmatic API. When typescript-eslint adopts it the tool-side line disappears and the repository
is single-compiler. **Re-check typescript-eslint issue
[#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)** (open, labelled
`blocked by external API`) rather than waiting to be told. This is now recorded in the guard's own
module header and in the root exemption's stated reason, next to the code it governs.

`findBelowMinimumDeclarations` takes the minimum major as a parameter and is tested at 7, so raising
the floor when that day comes is a one-constant change.

### Verification

| command                       | result                                           |
| ----------------------------- | ------------------------------------------------ |
| `pnpm install`                | clean, no new peer warning, exit 0               |
| `pnpm build`                  | green, 1:25.8                                    |
| `pnpm typecheck`              | 99/99 Done, 0 errors, 6.26–6.44 s                |
| `pnpm lint`                   | 0 errors, 1,882 warnings — identical to baseline |
| `pnpm harness:scan`           | **69/69**                                        |
| `pnpm harness:test`           | **1,090 tests, 87 files**                        |
| `pnpm harness:verify-like-ci` | all 11 mirrored stages green                     |

Two stages `verify-like-ci` flags as relevant but cannot mirror locally, both because the diff
touches manifests and the lockfile: `security-audit` (needs network plus the `osv-scanner` binary)
and `windows-shell` (needs a Windows host).
