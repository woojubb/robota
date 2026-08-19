---
title: 'INFRA-115: dependency-review blocks every lockfile-touching pull request on a coverage hole'
status: in-progress
created: 2026-08-20
priority: high
urgency: now
area: .github/workflows
depends_on: []
---

# INFRA-115: the sharp allow-list covers four platforms and there are five

## Objective

`Dependency review` fails on any pull request that touches `pnpm-lock.yaml`, on three packages the
pull request did not introduce. Issue #1889.

```
  pnpm-lock.yaml » @img/sharp-win32-arm64@0.35.2 – License: Apache-2.0 AND LGPL-3.0-or-later
  pnpm-lock.yaml » @img/sharp-win32-ia32@0.35.2  – License: Apache-2.0 AND LGPL-3.0-or-later
  pnpm-lock.yaml » @img/sharp-win32-x64@0.35.2   – License: Apache-2.0 AND LGPL-3.0-or-later
```

No vulnerability is involved; the same run reports none. It is the license allow-list alone.

## Why this is worth fixing rather than re-running

The gate cannot go green by retry — the input does not change. It blocks every lockfile-touching
pull request on a condition unrelated to that pull request's content, which teaches every reader to
treat a red `Dependency review` as noise. That is the failure a license gate can least afford: the
one time it catches a genuinely incompatible new dependency, it will look exactly like this.

## Measured, not assumed

The issue asks whether both `sharp-*` families need entries for every platform. They do not, and the
measurement says why:

| package                           | license                                | libvips comes from           |
| --------------------------------- | -------------------------------------- | ---------------------------- |
| `@img/sharp-darwin-arm64`         | `Apache-2.0`                           | optionalDep on a prefab      |
| `@img/sharp-linux-x64`            | `Apache-2.0`                           | optionalDep on a prefab      |
| `@img/sharp-freebsd-wasm32`       | `Apache-2.0`                           | —                            |
| `@img/sharp-webcontainers-wasm32` | `Apache-2.0`                           | —                            |
| `@img/colour`                     | `MIT`                                  | —                            |
| `@img/sharp-libvips-darwin-arm64` | `LGPL-3.0-or-later`                    | is the prefab                |
| **`@img/sharp-win32-x64`**        | **`Apache-2.0 AND LGPL-3.0-or-later`** | **no optionalDep — bundled** |
| **`@img/sharp-win32-arm64`**      | **`Apache-2.0 AND LGPL-3.0-or-later`** | **no optionalDep — bundled** |
| **`@img/sharp-win32-ia32`**       | **`Apache-2.0 AND LGPL-3.0-or-later`** | **no optionalDep — bundled** |

Windows is the one platform where the wrapper and the prefab are the same package. Every other
wrapper delegates libvips to a `sharp-libvips-*` package and stays plain `Apache-2.0`, which
`allow-licenses` already passes — which is why the wrapper family needed no entries and still does
not. The win32 wrappers ship the DLLs inside themselves, so they carry the LGPL leaf directly, and
the action's `A AND B` rule passes only when BOTH leaves are allowed.

So this is a coverage hole in the existing exemption, not a new judgement about Windows.

`@img/sharp-libvips-win32-*` **does** exist on the registry at 1.3.2, but is absent from this
lockfile. Listing it would exempt a package the graph does not contain — an entry nobody can observe
being wrong.

## The alternative, and why it was not taken

The issue offers replacing the enumeration with a single `@img/*` allowance. Rejected: `@img/colour`
is MIT and the non-win32 wrappers are Apache-2.0, so a blanket entry would exempt 24 packages that do
not need exempting, and would silently absorb any future `@img/*` package whatever its license. The
enumeration drifting is the cost of it being observable — and this task is the drift being caught,
which is the mechanism working rather than failing.

## Plan

- [x] TC-01: every `@img/*` package in the lockfile was enumerated (27) and its license read.
- [x] TC-02: the three failing names are exactly the ones whose expression contains a non-allowlisted
      leaf, and no other lockfile package does.
- [x] TC-03: the win32 wrappers were confirmed to carry libvips themselves — no `optionalDependencies`
      — while a darwin wrapper points at its prefab.
- [x] TC-04: `@img/sharp-libvips-win32-*` was checked for existence AND for presence in the lockfile;
      it exists and is absent, so it is deliberately not listed.
- [x] TC-05: the workflow still parses as YAML and the job name is unchanged.
- [ ] TC-06: `Dependency review` is green on a pull request that touches `pnpm-lock.yaml`.

## Test Plan

There is no local runner for this action, so the check that matters runs in CI. What CAN be
established locally is every input the gate reads — the package set, each license expression, and the
`A AND B` rule the action applies — and that is what the table above is.

TC-06 is the one that needs the real gate. It is left unchecked until a lockfile-touching pull
request goes green, because a workflow edit that looks right is not the same claim as a gate that
passed.

## User Execution Test Scenarios

**Scenario — the gate stops blocking an unrelated change**

- Prerequisites: a pull request that modifies `pnpm-lock.yaml` (adding any dependency will do).
- Steps: open it against `develop` and read the `Dependency review` check.
- Expected: green. Before this change it reported the three `@img/sharp-win32-*` names on any such
  pull request.
- Evidence: _to be filled once a lockfile-touching pull request has run_

## Progress

### 2026-08-20

Filed as issue #1889 while merging ARCH-035 (issue #1787). The issue had already established that the
dependency is not branch-local: `git show origin/develop:pnpm-lock.yaml | grep -c sharp-win32` returns
12, so the names are on the target branch and any pull request touching the lockfile hits them.

What this task added is the reason only win32 fails, which the issue left open as a question. The
answer is structural rather than a list oversight: on Windows the wrapper IS the prefab.
