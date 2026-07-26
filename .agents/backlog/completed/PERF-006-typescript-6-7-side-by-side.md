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

> **DONE (2026-07-26).** All five acceptance boxes are ticked; see
> [Outcome](#outcome-done-2026-07-26) at the end of this file for the measurement, the before/after
> lint diff, the transitive-consumer audit, the timing, the guard's red/green proof, and the four
> things the work found that this item's premise had wrong.
>
> **The goal is fully met as of the follow-up later that day: TypeScript 5 is gone from the
> repository, `node_modules` included.** The first pass left one 5.x copy on disk and argued it was
> acceptable; that reasoning was wrong on three counts and is corrected in
> [§8](#8-the-last-5x-copy-removed-2026-07-26). The fix was an `electron-builder` 25 → 26 upgrade,
> not the `pnpm.overrides` entry this file originally called the only lever.

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
- [x] **No `typescript` below 6 RESOLVES anywhere in the installed store, enforced mechanically**
      (added by the [§8](#8-the-last-5x-copy-removed-2026-07-26) follow-up — the declaration-only
      boxes above were all green while a 5.x copy sat in `node_modules`).

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

> **SUPERSEDED — the two paragraphs below were wrong, and the goal is now actually met.** They are
> kept verbatim rather than deleted, because the reasoning error is the useful part. See
> [§8 The last 5.x copy, removed](#8-the-last-5x-copy-removed-2026-07-26) for what was measured and
> what shipped. In short: the fix was not an override, it was an honest dependency upgrade, and
> "expected, not a broken guard" was the wrong call — it was a broken guard.

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

### 8. The last 5.x copy, removed (2026-07-26)

**The goal is met. `typescript@5` is gone from the repository, including from `node_modules`.**

```
$ find node_modules -name typescript -maxdepth 6 -type d
node_modules/.pnpm/typescript@6.0.3/node_modules/typescript

$ ls node_modules/.pnpm | grep '^typescript@'
typescript@6.0.3
```

#### What §3 got wrong

Three claims in the superseded block above, each corrected by measurement:

1. **"An override is the only lever."** It was not. The chain was
   `apps/agent-app` → `electron-builder@25.1.8` → `app-builder-lib@25.1.8` → `config-file-ts@0.2.8-rc1`,
   and **`app-builder-lib@26` dropped `config-file-ts` entirely**, replacing it with `jiti`
   (changeset 26.0.18: _"feat: use jiti instead of config-file-ts for loading TypeScript config"_).
   Upgrading `electron-builder` 25 → 26 deletes the chain at its source. Upgrading `config-file-ts`
   itself really does lead nowhere — its own latest `0.2.8-rc1` still pins `^5.4.3` — which is
   probably why the search stopped there, but the dependency one level up was the removable one.
2. **"Expected, not a broken guard."** It was a broken guard. Every edge the guard had inspected a
   DECLARATION; none could see what was INSTALLED. A guard that reports success while the stated
   goal is visibly unmet is not working as designed, whatever its scope statement says. Fixed by
   adding the `legacy-typescript-installed` edge — see below.
3. **"It disappears on its own."** Nothing was going to make it disappear on its own: the
   dependency was ours to bump. `electron-builder` 26.0.0 had by then been out for 18 months.

#### The upgrade, treated as the major it is

`electron-builder` **25.1.8 → 26.15.7**, pinned EXACTLY rather than with a caret.

**Breaking-change audit.** Researched against primary sources only (v26.0.0 release notes, the
changesets at tag `electron-builder@26.15.7`, and 26-era docs read at the tag). There is **no
official 25→26 migration guide**, and the release notes under-report key-level removals — so the
audit was done against the published config JSON Schema
(`unpkg.com/app-builder-lib@<version>/scheme.json`), diffed 25.1.8 → 26.15.7. That diff is the
exhaustive ground truth, and the **complete** set of removed config keys is:

```
includeSubNodeModules
NotarizeNotaryOptions.teamId          (mac.notarize object form → boolean + env vars)
win.additionalCertificateFile  win.certificateFile  win.certificatePassword
win.certificateSha1  win.certificateSubjectName  win.publisherName
win.rfc3161TimeStampServer  win.sign  win.signDlls  win.signingHashAlgorithms  win.timeStampServer
```

| 26.0.0 breaking change                   | Applies to `apps/agent-app`?                                               |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `win` signing moved to `signtoolOptions` | **No** — artifacts are unsigned; no `win` signing block exists             |
| `mac.notarize` object → boolean + env    | **No** — no `mac.notarize` key                                             |
| `linux.desktop` string-map → object      | **No** — no `desktop` key                                                  |
| `includeSubNodeModules` removed          | **No** — never set; behaviour is now unconditional                         |
| HFS+ DMG conditional removed             | **No** — 26.15.7 still defaults `dmg.filesystem: HFS+`; APFS is a v27 flip |
| node_modules in other subdirectories     | **Yes** — see the asar diff below                                          |

`artifactName`, `directories.{output,buildResources}`, `files`, `extraResources`, `npmRebuild`,
`linux.{target,category,maintainer}`, `mac.{category,target}`, `win.target`, `appId`, `productName`
and `copyright` are **byte-identical in both schemas** — same names, same documented defaults.
`engines.node` is `>=14.0.0` in both (the Node ≥22.12 requirement is v27).

**The one change that did bite, found by running the build rather than by reading.** 26's AppImage
target hard-rejects the derived executable name:

```
⨯ executableName contains characters that cannot be safely used in file paths: @robota-sdkagent-app.
```

`validateCriticalPathString` (`app-builder-lib/out/targets/appimage/appImageUtil.js`) enforces
`/^[\p{L}\p{N}._\- ]+$/u` on `executableName` and `productFilename`, because both are interpolated
into the generated `AppRun` bash script and used as filesystem paths. Left to default, the name
derives from the scoped package `name` and collapses to `@robota-sdkagent-app` — **which 25 really
did ship**, as the binary and as `@robota-sdkagent-app.desktop`. So 26 did not invent a rule; it
turned a latent packaging defect into a visible error. Fixed properly, by setting
`executableName: robota-desktop`. This validation appears in **no** 26.x changelog entry or doc —
it was found by packaging, which is the argument for packaging rather than reading.

**Why an exact pin.** Within the 26.15 patch line alone, two artifact-corrupting regressions shipped
as ordinary patches: 26.15.0–26.15.3 dereferenced symlinks after a bundled 7-Zip upgrade, corrupting
macOS `.framework` bundles (breaking codesign and Squirrel.Mac auto-update), and 26.15.0–26.15.6
packed snap templates so the snap built successfully and failed at launch. Both produce a **green
build and a broken artifact** — the failure mode a caret range cannot protect against and CI would
not catch. 26.15.7 is past both.

#### The packaging proof, and exactly how far it got

Run on Linux x64 against the real `dist:app` path (`pnpm build && pnpm bundle:runtime &&
electron-builder`), with a **baseline captured on 25.1.8 first** so every difference is attributable.

| target                    | on 25.1.8 (baseline) | on 26.15.7       | note                                |
| ------------------------- | -------------------- | ---------------- | ----------------------------------- |
| `linux-unpacked`          | ✅                   | ✅               | full app tree                       |
| **AppImage**              | ✅ 168,485,777 B     | ✅ 168,494,483 B | real artifact, both runs            |
| deb                       | ❌                   | ❌               | **unreachable in this environment** |
| mac (dmg/zip), win (nsis) | not attempted        | not attempted    | need macOS / Windows hosts          |

**The deb step is unreachable here, and it fails identically on 25.** fpm reports
`Need executable 'ar' to convert dir to deb`. `ar` comes from `binutils`, which is not installed;
there is no passwordless sudo to install it, and `busybox ar` is extract/list-only (no create). This
is an environment gap, **not an upgrade regression** — proven by the 25.1.8 baseline hitting the same
error at the same step before any change was made. mac and win targets need their own hosts and were
not attempted; CI's `release-desktop-app.yml` covers all three platforms.

**What the produced artifact was checked against, beyond "a file exists":**

- **`linux-unpacked` tree diff, 25 → 26 — exactly three lines**, all explained:
  `-./@robota-sdkagent-app` / `+./robota-desktop` (the intended `executableName` fix) and
  `+./resources/apparmor-profile` (new in 26; needed for Ubuntu 24.04+ userns restrictions).
- **`app.asar` entry diff — purely additive, +32 entries / +20,289 B.** 26's dependency walker now
  also resolves `@types/*` production deps (LICENSE + package.json metadata only) and nested pnpm
  `node_modules` — this is BC-4, "support including node_modules in other subdirectories", visible.
  **Nothing was dropped**; no first-party or runtime file changed. The workspace closure
  (`@robota-sdk/agent-core`, `agent-transport-gui`, …) resolves correctly under pnpm's symlinked
  store, and 26 logs `detected workspace root for project using packageManager field pm=pnpm`.
- **The packaged app actually runs.** `test:e2e:bundled` passes against the 26-built output — the
  bundled sidecar completes the nonce handshake, rejects a wrong token before any session data, and
  shuts down cleanly on SIGTERM. `resources/robota` is byte-identical in size across both builds.

**One pre-existing failure, explicitly not caused by this change.** `pnpm --filter @robota-sdk/agent-app test:e2e`
(the Electron GUI e2e) times out waiting for `.agent-gui-status[data-status="connected"]`. It fails
**identically on pristine `origin/develop` with electron-builder 25.1.8**, verified by stashing the
whole change, reinstalling and re-running. It is not wired into any CI workflow. Untouched here.

#### The guard now sees the installed tree

`scan-legacy-typescript.mjs` gains a sixth finding kind, `legacy-typescript-installed`: a
`typescript` copy below 6 materialised anywhere under `node_modules`, **whoever declared it**. This
is the only edge that reads resolution rather than declaration, and it is the one that answers the
owner's actual question. It walks the module-resolution structure (package dirs, `@scope` dirs,
pnpm's `.pnpm` store), dedupes by realpath so pnpm's top-level symlinks are not double-counted, and
confirms each candidate by `manifest.name === 'typescript'` rather than trusting the directory name —
the same false-positive class (`@typescript-eslint/*`, `@typescript/native-preview`,
`@scope/typescript`) the import edge already defends against.

**It is deliberately not waivable** — not by the path baseline, not by the root exemption, and there
is no annotation for it. A resolved 5.x copy is either removable or it is a decision to bring to the
owner; an escape hatch here would just rebuild the manifest-only blind spot one suppression at a time.

`collectInstalledCopies` returns `undefined` — distinct from `[]` — when there is no `node_modules`,
and that raises a loud notice instead of passing. "Nothing installed" must never read as "tree is
clean".

- **RED**, against the tree as it stood before the upgrade: one finding, and the guard located the
  cause on its own — `[legacy-typescript-installed] node_modules/.pnpm/config-file-ts@0.2.8-rc1/node_modules/typescript`.
  Exit 1.
- **GREEN** after the upgrade + a clean `pnpm install --frozen-lockfile`. Exit 0.
- **Re-proven causally:** reverting _only_ the `electron-builder` version and reinstalling brings
  `typescript@5.9.3` back and the guard fires again — so the edge tracks the real cause, not a
  coincidence of that one tree.
- **The tests bind to the floor:** flipping `MINIMUM_MAJOR` to 5 fails 3 of the new tests. 16 new
  tests, 48 in the file (was 32); harness suite 1,127 tests / 88 files green.

**A trap worth knowing: `pnpm install` does not evict an orphaned store entry; `pnpm prune` does.**
After a dependency bump or a branch switch the old copy can sit in `.pnpm` unreferenced by the
lockfile, and this edge will correctly report it while the lockfile is already clean. CI never sees
it (fresh checkout, empty `node_modules`), but a local run can — so the failure message says to run
`pnpm prune` first and only then go hunting for a real `dependencies` entry.

#### Store-wide sweep — zero hard dependencies remain

Re-measured by **parsing** every manifest materialised under `node_modules/.pnpm` (7,135 of them) and
looking up the literal `typescript` key in each dependency section:

| measurement                                           | before           | after     |
| ----------------------------------------------------- | ---------------- | --------- |
| hard `dependencies` on `typescript` anywhere in store | **1**            | **0**     |
| resolved `typescript` copies on disk                  | 2 (5.9.3, 6.0.3) | 1 (6.0.3) |

The single `before` entry was `config-file-ts@0.2.8-rc1 [dependencies] ^5.4.3`. The 714 remaining
`devDependencies`/peer entries are irrelevant: a published package's devDependencies are never
installed for a consumer, and every peer admits 6.

**The counting method is the point, again.** `"typescript"` is a substring of `@typescript-eslint/*`,
`@typescript/native-preview` and a script name — the same trap that produced §1's phantom 177. Parse
and look up the literal key; never grep the string.

### Follow-ups, not closed here

- ~~`config-file-ts` keeps a private `typescript@5.9.3` in the tree (§3).~~ **Closed** — see §8.
- `dmg.filesystem` defaults flip HFS+ → APFS in electron-builder v27. Set it explicitly before that
  upgrade if pre-10.13 macOS support ever matters.
- The Electron GUI e2e (`apps/agent-app` `test:e2e`) fails on `develop` and is wired into no CI
  workflow — pre-existing, untouched here, and worth its own item.
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
