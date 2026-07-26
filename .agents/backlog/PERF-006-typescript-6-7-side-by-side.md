---
id: PERF-006
title: Run TypeScript 6 and 7 side by side — retire the 5.x line entirely
status: todo
priority: high
type: INFRA
depends_on: [PERF-004, PERF-005]
created: 2026-07-26
---

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

- [ ] No manifest declares a `typescript` below 6, enforced mechanically.
- [ ] Lint findings identical before and after, over the whole workspace, with the diff shown.
- [ ] `pnpm typecheck` unchanged in result and not materially slower.
- [ ] The guard fails on a reintroduced 5.x declaration (proven red).

## References

- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- typescript-eslint [#12518](https://github.com/typescript-eslint/typescript-eslint/issues/12518),
  [#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)
- `.agents/backlog/PERF-005-remove-legacy-typescript.md` — phase 1, and the 177-manifest measurement
