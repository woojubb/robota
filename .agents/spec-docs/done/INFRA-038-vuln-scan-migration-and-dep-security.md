---
status: done
type: INFRA
tags: [ci, security, dependencies, audit]
---

# INFRA-038: migrate CI vuln-scan off the retired npm audit endpoint + fix the flagged transitive vulns

## Problem

npm **retired the legacy audit endpoint** (`/-/npm/v1/security/audits` → HTTP 410 "being retired; use the bulk
endpoint"). `pnpm audit` (reproduced on pnpm 8.15.4 AND 10) still calls it, so both `pnpm audit --audit-level high`
steps in `ci.yml` (the standalone `security audit` job + the `release-grade verification` step) **fail on every
run**, blocking the required `release-grade verification` check on ALL `develop→main` PRs. It is an external
pnpm/npm ecosystem breakage, not a repo bug.

Separately, a working scan (`osv-scanner` on `pnpm-lock.yaml`) flags **3 transitive packages / 6 advisories**:

| package   | version | advisories                   | fixed-in                    | pulled by                                                                        |
| --------- | ------- | ---------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `undici`  | 6.24.1  | 4 (CVSS 3.7–7.5)             | **6.27.0** / 7.28.0 / 8.5.0 | discord-bot example (transitive)                                                 |
| `js-yaml` | 3.14.2  | 1 (5.3)                      | **3.15.0** / 4.2.0          | changesets (dev) + istanbuljs (dev) + `gray-matter` (RUNTIME dep of `apps/docs`) |
| `ip`      | 2.0.1   | 1 (8.1) **= CVE-2024-29415** | none published              | `werift` / `werift-ice` (WebRTC)                                                 |

The existing override `undici@<6.24.0: ">=8.5.0"` misses **6.24.1** (it is not `<6.24.0`).

## Architecture Review

### Placement Decision (the primary, owner-visible decision)

**Replace `pnpm audit` in `ci.yml` (both call-sites) with `osv-scanner` (lockfile-based, no npm audit endpoint),
add safe `pnpm.overrides` for the two fixable vulns (`undici`→`>=6.27.0`, `js-yaml`→`>=3.15.0`), and carry the ONE
unfixable-but-reviewed advisory (`ip` CVE-2024-29415) into an `osv-scanner.toml` ignore — which becomes the SINGLE
enforced SSOT for re-accepts, REPLACING the now-dead `pnpm.auditConfig.ignoreCves`.**

**Re-accept SSOT consolidation (proposal-review, load-bearing).** `pnpm.auditConfig.ignoreCves` is read ONLY by
`pnpm audit` — which this change removes from CI (and which is globally broken anyway). Nothing in `scripts/` /
`.agents/rules` reads it (verified). Leaving it would be live-looking dead config (SSOT violation). So: **delete
`pnpm.auditConfig.ignoreCves`**; `osv-scanner.toml` holds every re-accept osv-scanner actually surfaces — which,
verified against the post-override lockfile, is EXACTLY ONE: `CVE-2024-29415` (`ip`). The other 5 CVEs it listed
(`CVE-2026-53550/11525/12151/6733/9679`; 2 traceable to `SEC-001-resolve-moderate-advisories`) are **not surfaced
by osv-scanner's OSV.dev DB** on the current lockfile — so they are dropped, not silently pre-ignored. If OSV ever
surfaces one, CI goes red and it gets a fresh reviewed ignore (the correct behavior — re-accepts are re-justified
against the live scanner, not blindly carried from a dead tool).

- **Mirror-analog:** the repo already remediates transitive vulns via `pnpm.overrides` (~30 entries) and documents
  reviewed re-accepts in `pnpm.auditConfig.ignoreCves`. This extends both patterns; it does not invent a new one.
  The scanner swap is forced by npm's endpoint retirement (nothing else audits a pnpm lockfile without it).
- **`ip` CVE-2024-29415 stays a documented re-accept, not a "fix".** It has NO published fix, and REMOTE-001
  already established (with a regression test `cve-2024-29415-reachability.test.ts`) that `werift` never calls the
  vulnerable `ip.isPublic`/`isPrivate`/`address` — only `ip.isLoopback` over the host's own NICs — so the SSRF
  vector is unreachable. That analysis + guard remain authoritative; osv-scanner ignores it the same way
  `pnpm.auditConfig.ignoreCves` did.
- **Fix, don't blind-bump.** Only the 2 packages with a published fix are overridden, to their **same-major** safe
  versions (undici 6.24.1→6.27.0, js-yaml 3.14.2→3.15.0) — no API-breaking major jumps. "Update everything" is
  scoped to "eliminate every KNOWN vulnerability," verified by a clean osv-scan, not a reckless latest-major sweep.

### Affected Scope

- **Changed:** `.github/workflows/ci.yml` (2 `pnpm audit` steps → `osv-scanner`) + `.github/workflows/deploy.yml` (a 3rd, advisory); root `package.json`
  (`pnpm.overrides` += undici/js-yaml); `pnpm-lock.yaml` (regenerated); NEW `osv-scanner.toml` (ignore
  CVE-2024-29415 with justification).
- **Removed:** `pnpm.auditConfig.ignoreCves` (dead once `pnpm audit` is gone; its one still-surfaced re-accept
  moves to `osv-scanner.toml`).
- **Unchanged:** the werift
  regression test; product code; the release/binary workflows.

### Alternatives Considered

1. **osv-scanner + targeted overrides + documented ip re-accept (CHOSEN).** Restores a working gate on a pnpm
   lockfile; fixes the 2 real vulns at same-major; preserves the reviewed ip re-accept. Low risk.
2. **Make `pnpm audit` non-blocking (`|| true`).** REJECTED — silently blinds the security gate; masks future real
   vulns. A security regression.
3. **Upgrade pnpm to a version whose `audit` uses the bulk endpoint.** REJECTED — reproduced 410 on pnpm 10 too
   (pnpm still calls the retired endpoint); also a large, risky monorepo-wide toolchain bump.
4. **`npm audit`.** REJECTED — needs a `package-lock.json`; the repo is pnpm-only.
5. **Blind `pnpm update` of all deps to latest.** REJECTED — major-version breakage across ~30 packages for no
   security benefit beyond fixing the flagged vulns; the goal is zero KNOWN vulns, achieved surgically.

### Architecture Review Checklist

- [x] New-surface placement surfaced FIRST + independently validated (proposal-review at GATE-APPROVAL).
- [x] Mirror-analog — extends existing `pnpm.overrides` + `auditConfig` patterns; scanner swap forced by npm.
- [x] Fix vs re-accept correctly separated — undici/js-yaml FIXED (published, same-major); ip = documented
      re-accept (no fix; werift non-reachability proven by an existing regression test).
- [x] No API-breaking major bumps (undici 6→6, js-yaml 3→3).
- [x] Security gate NOT weakened — osv-scanner fails on any UN-ignored vuln; the only ignore is the reviewed
      CVE-2024-29415, with a justification comment.
- [x] Verifiable — a clean osv-scan (0 un-ignored advisories) + green build/test/typecheck/lint after the overrides.
- [x] The re-accept stays traceable — `osv-scanner.toml` references the REMOTE-001 analysis + regression test.

### Decision

Swap both `pnpm audit --audit-level high` steps in `ci.yml` for `osv-scanner scan source --lockfile pnpm-lock.yaml`
(config `osv-scanner.toml`). Add `pnpm.overrides`: `undici@6.24.1: ">=6.27.0"` and `js-yaml@3.14.2: ">=3.15.0"`
(and broaden the stale `undici@<6.24.0` note if needed), regenerate the lockfile. Add `osv-scanner.toml` ignoring
`CVE-2024-29415` (GHSA-2p57-rm9w-gvfp) with the werift-non-reachability justification. **Delete
`pnpm.auditConfig.ignoreCves`** (dead config; osv-scanner.toml is the single re-accept SSOT).

## Solution

- `package.json` `pnpm.overrides` += `"undici@6.24.1": ">=6.27.0"`, `"js-yaml@3.14.2": ">=3.15.0"`; `pnpm install`
  to regenerate `pnpm-lock.yaml`.
- `osv-scanner.toml`:
  ```toml
  [[IgnoredVulns]]
  id = "GHSA-2p57-rm9w-gvfp"   # CVE-2024-29415 — ip SSRF (isPublic/isPrivate)
  reason = "werift/werift-ice never call the vulnerable ip.isPublic/isPrivate/address (only ip.isLoopback over the host's own NICs). Reviewed re-accept — REMOTE-001 / cve-2024-29415-reachability.test.ts. No published fix for ip."
  ```
- `ci.yml`: both steps → install osv-scanner (pinned release binary) + `osv-scanner scan source --config
osv-scanner.toml --lockfile pnpm-lock.yaml` (explicit `--config`; exit non-zero on any un-ignored vuln). Keep the
  standalone job's dependency-change conditional.

## Affected Files

- `.github/workflows/ci.yml`, root `package.json` (+`pnpm.overrides`), `pnpm-lock.yaml`, NEW `osv-scanner.toml`.

## Completion Criteria

- TC-01: `osv-scanner scan source --lockfile pnpm-lock.yaml` reports **0 un-ignored advisories** after the overrides
  (undici + js-yaml resolved; CVE-2024-29415 ignored with justification).
- TC-02: `undici` resolves to `>=6.27.0` and `js-yaml` to `>=3.15.0` in the lockfile; both stay in their original
  MAJOR (no 6→8 / 3→4 break).
- TC-03: `ci.yml`'s two vuln-scan steps run `osv-scanner` (no `pnpm audit`); each fails the job on any un-ignored
  vuln.
- TC-04: `pnpm build` + `pnpm test` + `typecheck` + `lint` green after the overrides (incl. the werift
  `cve-2024-29415-reachability.test.ts` regression guard still passing).
- TC-05: `actionlint` clean on the changed `ci.yml`; the re-accept is documented in `osv-scanner.toml` + traceable
  to REMOTE-001.
- TC-06: No product/source code changed; the release/binary workflows + `release-operations.md` untouched.
- TC-07: `osv-scanner`'s report was captured and EVERY advisory it lists is either FIXED (undici/js-yaml) or has a
  justified ignore in `osv-scanner.toml` (CVE-2024-29415) — proving "0 un-ignored" is real, not assumed.
  `pnpm.auditConfig.ignoreCves` is removed; `osv-scanner.toml` is the single re-accept SSOT.

## Test Plan

- **Agent-owned (local):** apply overrides → `pnpm install` → `osv-scanner … --lockfile pnpm-lock.yaml` shows 0
  un-ignored vulns (TC-01/02); `pnpm build:deps && pnpm test && pnpm typecheck && pnpm lint` green, incl. the werift
  regression test (TC-04); `actionlint` on ci.yml (TC-05); confirm lockfile undici/js-yaml versions (TC-02).
- **CI:** the rewritten `release-grade verification` + `security audit` steps run osv-scanner and pass (this is what
  unblocks `develop→main`).

## Tasks

Deferred to GATE-IMPLEMENT. Preliminary: T1 overrides + `pnpm install` + local osv-scan clean; T2 `osv-scanner.toml`

- ci.yml swap + actionlint; T3 build/test/typecheck/lint green; T4 feature→develop→main via merge-verifier; T5
  GATE-COMPLETE (CI release-grade green on the new scanner).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-16

Mechanical checks green (`check-spec-doc-frontmatter`, `check-backlog-placement`, `scan-test-plan`). All required
sections present — Placement Decision first (osv-scanner swap + targeted overrides + documented ip re-accept),
Affected Scope, 5 Alternatives, a 7-item checklist, a Decision naming the fix-vs-re-accept split; Solution; Affected
Files; Completion Criteria TC-01..TC-06; Test Plan (agent-owned local osv-scan + build/test); Tasks (deferred).
Status → `review-ready`; `draft/` → `backlog/`. GATE-APPROVAL next (independent proposal-review running).

### [proposal-review] — 🔧 REVISE → revisions applied | 2026-07-16

Independent `proposal-reviewer` **ENDORSED the direction on correctness grounds** and verified against the code:
`pnpm audit` at ci.yml:266/:296 both broken; undici@6.24.1 pulled by discord.js (transitive); `ip@2.0.1` used ONLY
by werift/werift-ice (no other consumer → the reachability re-accept is fully scoped; the regression test guards
it); undici override selectors are disjoint (no conflict); a single root `pnpm-lock.yaml` covers the whole
workspace; osv-scanner exits non-zero on findings (gate not weakened); and the surgical "0 known vulns" scope is
the correct reading of "update all" (a blind latest-major sweep was rightly rejected). Verdict **REVISE** for one
load-bearing item + fixes, all applied:

1. **(Load-bearing) Re-accept SSOT split.** Removing `pnpm audit` leaves `pnpm.auditConfig.ignoreCves` as
   live-looking dead config (nothing reads it — verified). Fixed: **delete it**; `osv-scanner.toml` is the single
   enforced SSOT, holding only what osv actually surfaces (`CVE-2024-29415`). The other 5 `CVE-2026-*` (2 from
   SEC-001) are not surfaced by OSV.dev on the current lockfile → dropped (fresh review if ever surfaced), not
   silently pre-ignored.
2. **Pin `--config osv-scanner.toml`** in both ci.yml call-sites (no reliance on auto-discovery).
3. **Corrected the js-yaml consumer note** — `gray-matter` is a RUNTIME dep of `apps/docs` (not dev-only); the
   same-major override stays safe.
4. **Added TC-07** — osv's report is captured and every listed advisory is fixed or justified-ignored.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-16

Owner directed the work ("npm audit 이슈 처리 + 취약 패키지 업데이트"); approval delegated on rule-conformance. Rule
alignment: SSOT restored (single osv-scanner.toml re-accept owner; dead config removed); no-fallback / gate-not-
weakened (Alt-2 `|| true` rejected; osv fails on un-ignored vulns); fix-vs-re-accept discipline (undici/js-yaml
FIXED same-major; ip = enforced reachability re-accept with a regression guard); mirror-analog to existing
`pnpm.overrides`; surgical scope = zero KNOWN vulns (not a reckless bump). **Pre-validated locally:** overrides
applied → `pnpm install` → osv-scan shows only `ip` (undici/js-yaml resolved); werift `cve-2024-29415` regression
test passes; `build:deps` green. Status → `approved`; `backlog/` → `todo/`. GATE-IMPLEMENT next.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-16

Task file `.agents/tasks/INFRA-038.md` authored; status → `in-progress`; `todo/` → `active/`.

### [GATE-VERIFY] — ✅ PASS (agent-run, local) | 2026-07-16

Implemented + verified:

- **Overrides + lockfile:** `pnpm.overrides` += `undici@6.24.1: ">=6.27.0"`, `js-yaml@3.14.2: ">=3.15.0"`;
  `pnpm install` regenerated the lockfile. **`pnpm.auditConfig.ignoreCves` deleted** (dead config).
- **`osv-scanner.toml`** — single re-accept SSOT; ignores only `GHSA-2p57-rm9w-gvfp`/CVE-2024-29415 (ip) with the
  werift-non-reachability justification + test reference.
- **TC-01/07:** `osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml` → the ip advisory is
  filtered by the justified ignore, **0 un-ignored advisories, exit 0**. undici + js-yaml no longer flagged
  (resolved to safe same-major versions).
- **TC-03:** both `ci.yml` `pnpm audit` steps → osv-scanner (`--config`); the message at ci.yml:244 no longer says
  "pnpm audit". **Also migrated a THIRD `pnpm audit` in `deploy.yml`** (advisory `continue-on-error` step — kept its
  posture) so no dead-endpoint audit remains repo-wide.
- **TC-04:** `typecheck` clean; `lint` 0 errors; `build:deps` green; the werift `cve-2024-29415-reachability.test.ts`
  regression guard passes (the override changed no source).
- **TC-05:** `actionlint` clean on `ci.yml` (the one `deploy.yml` warning — `codecov-action@v3` too old — is
  pre-existing, unrelated). **TC-06:** no product/source code changed; release/binary workflows +
  `release-operations.md` untouched.

Note: `deploy.yml` added to Affected Scope (a 3rd `pnpm audit`, non-blocking). Remaining: T4 feature→develop→main
(merge-verifier — this is what UNBLOCKS main, since release-grade now runs osv-scanner instead of the 410'd audit);
T5 GATE-COMPLETE (CI release-grade green on the new scanner).

### [GATE-COMPLETE] — ✅ PASS | 2026-07-16

**Status upgrade:** in-progress → done

The migration is live on main (#1169 → #1170, 39bb0b3d7). **CI `release-grade verification` PASSED with the new
osv-scanner step (8m37s) — the npm-audit 410 blocker that blocked every develop→main merge is resolved**, and this
promotion PR merged NORMALLY (no admin override, unlike the audit-blocked #1168). The standalone `security audit`
job also runs osv-scanner (8s, clean). `osv-scanner.toml` is the single re-accept SSOT on main; `pnpm audit
--audit-level` is gone from ci.yml/deploy.yml; the CI-structure guard test (`harness-scripts.test.mjs`) asserts the
new shape. undici/js-yaml resolved to safe same-major versions; the ip CVE-2024-29415 re-accept stays enforced by
its werift reachability regression test. Zero KNOWN un-ignored vulnerabilities.
