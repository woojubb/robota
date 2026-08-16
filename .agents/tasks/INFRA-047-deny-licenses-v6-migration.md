---
title: 'INFRA-047: migrate dependency-review deny-licenses → allow-licenses before the v6 bump'
status: in-progress
created: 2026-07-25
priority: low
urgency: later
area: .github/workflows/dependency-review.yml
depends_on: []
---

# INFRA-047: license-gate input migration

## Problem

`dependency-review-action` deprecates `deny-licenses` for possible removal in v6 (noted in-file when v5
landed, #1313). The deny list is LOAD-BEARING for the dual-license policy (blocks GPL/AGPL ingress).

## What

Build the equivalent `allow-licenses` list (inventory current dependency licenses; allow-list is stricter —
verify no currently-green license falls outside), switch inputs, delete the in-file deprecation note.
Gate: do NOT accept a Dependabot v6 bump before this lands.

## Test Plan

A test PR introducing a GPL dev-dep is BLOCKED under the new input (then closed).

Verify post-merge: the input swap itself landed via `ci/infra-047-allow-licenses` (allow-list =
verified lockfile inventory closure of 2026-07-25 + purl exemptions for the @robota-sdk dual-licensed
self-deps and the LGPL @img/sharp-libvips prebuilt family). The red-test above cannot run pre-merge —
dependency-review executes the config of the PR's MERGE result against the target branch, so the new
allow-list only gates PRs opened AFTER this lands. Run the GPL-fixture PR against develop after merge;
only then may this item be closed.

## Status (reconciled 2026-07-26) — the swap landed, the red test was never run

**Done:** the input migration is live on `develop`. `.github/workflows/dependency-review.yml:60` now
carries `allow-licenses: 0BSD, Apache-2.0, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, CC-BY-4.0,
CC0-1.0, ISC, MIT, MIT-0, MPL-2.0, Python-2.0, Unlicense, WTFPL`, with `allow-dependencies-licenses`
purl exemptions for the `@robota-sdk/*` self-deps and the LGPL `@img/sharp-libvips-*` family. There is
**no `deny-licenses` key and no deprecation note left in the file**. Merged as
[#1339](https://github.com/woojubb/robota/pull/1339) (`2026-07-24T15:51:34Z`). The v6-bump gate the
item exists to protect is therefore satisfied — a Dependabot v6 bump is now safe to accept.

**Not done — the item's only stated closing condition.** The GPL-fixture red test has never been run:
`gh pr list --state all --search GPL` returns no such PR, and no branch carrying a GPL fixture exists.
Until it runs, "the allow-list actually blocks copyleft ingress" is an argument about a config file,
not a measurement — which is precisely the shape the item wrote its own Test Plan to avoid.

**The one remaining action, exactly:**

1. Branch off fresh `origin/develop`; add a GPL-licensed package as a **devDependency** to the root
   `package.json` and refresh `pnpm-lock.yaml` (both are in the workflow's `paths:` filter, so the job
   will trigger). A clearly-GPL, small, uncontroversial choice keeps the fixture honest.
2. Open the PR against `develop` and read the `Dependency review` check.
3. **Expect FAIL** naming the GPL license as not in the allow-list. A pass is a defect in the
   allow-list, not a green.
4. Paste the check output here, then CLOSE the PR without merging and delete the branch.

Note the job is advisory (not a required check) and `paths`-filtered, so the fixture PR is safe to open
and costs nothing to abandon.

## Measured gap 2026-08-16 — the exemption list covers the libvips family but not sharp's win32 trio

Found on PR #1793 (PROV-006), which it blocked. `allow-dependencies-licenses` exempts
`@img/sharp-libvips-*` and `@img/sharp-wasm32`, but **not** `@img/sharp-win32-arm64`,
`@img/sharp-win32-ia32` or `@img/sharp-win32-x64` — whose license is the same
`Apache-2.0 AND LGPL-3.0-or-later` the libvips exemptions exist for.

They sit in the lockfile already, so nothing changes until a pull request makes them **newly
reachable from a new importer**: adding a workspace dependency on
`@robota-sdk/agent-provider-openai-compatible` to `scratch/` was enough, and the check refused it.
That PR dropped the dependency rather than widening the allowlist, which was the right call for a
verification script — but the next change that legitimately needs an image-capable provider package
in a new importer will hit the same wall, and widening the allowlist is a licence decision rather
than a CI fix.

Two things to decide together, both owner-level:

- whether the win32 trio belongs in the same exemption as the libvips family it mirrors (they are
  optional platform binaries of one package, and the repo already accepts the family for the same
  license);
- or whether `sharp` should not be reachable from a package the repo publishes at all, which is the
  stricter reading and a different piece of work.

Recorded rather than acted on: changing an allowed-license set is a licence-compliance decision, not
a side effect of an unrelated pull request.
