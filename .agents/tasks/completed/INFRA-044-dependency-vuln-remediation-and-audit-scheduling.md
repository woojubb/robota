---
title: 'INFRA-044: triage 18 pre-existing dependency advisories + run security-audit on a schedule (not only on manifest PRs)'
status: done
completed: 2026-07-24
created: 2026-07-23
priority: high
urgency: soon
area: .github/workflows/ci.yml, osv-scanner.toml, pnpm-lock.yaml
depends_on: []
---

# INFRA-044: dependency-vulnerability remediation + audit-scheduling gap

## Progress (2026-07-23)

- **DONE — remediation:** all 18 advisories cleared. **16 fixed** by `pnpm.overrides` bumps to the published fix
  versions (`@astrojs/rss` 4.0.19, `body-parser` 1.20.6/2.3.0, `brace-expansion` 1.1.16/2.1.2/5.0.7, `dompurify`
  3.4.12, `fast-uri` 3.1.4, `hono` 4.12.27, `protobufjs` 8.6.6, `svgo` 4.0.2 — plus the pre-existing
  `fast-uri`/`protobufjs` overrides were bumped off the vulnerable pins). **2 accepted** in `osv-scanner.toml`
  with rationale: `js-yaml@4.2.0` (GHSA-52cp, dev-only changesets tooling on trusted config) and `sharp` 0.34.5
  (GHSA-f88m, build-time-only on the sites' own trusted images; the 0.35.0 bump was reverted because it breaks
  the Cloudflare Pages docs build env). `osv-scanner` now exits 0; lockfile regenerated via `--lockfile-only` and
  verified frozen-installable.
- **DONE (2026-07-24):** the audit-scheduling gap — `.github/workflows/security-scheduled.yml` runs the
  same osv-scanner + `osv-scanner.toml` SSOT over the full lockfile weekly (Mon 04:47 UTC) + on
  `workflow_dispatch`, so newly-published advisories surface within days instead of at the next manifest
  edit. (Formerly REMAINING:) the **audit-scheduling gap** — run `security-audit` (osv-scanner) on a nightly/weekly `cron`
  (and/or every PR) so newly-published advisories are caught within a day instead of at the next manifest edit.
  (Small follow-up; the CodeQL workflow already has a weekly cron to model on.)

---

## Problem

The `security-audit` CI job runs osv-scanner **only when a PR changes `package.json`/`pnpm-lock.yaml`**
(`.github/workflows/ci.yml` "Detect dependency graph changes"). Advisories published against dependencies
already in the lockfile therefore accumulate **invisibly** — no PR that leaves the manifest untouched ever runs
the scan. Surfaced 2026-07-23 when HARNESS-041 added a single `package.json` script line and the audit tripped on
**18 pre-existing advisories** (none introduced by that PR):

| Package               | Version                | Advisory                                                      | CVSS            |
| --------------------- | ---------------------- | ------------------------------------------------------------- | --------------- |
| svgo                  | 4.0.1                  | GHSA-2p49-hgcm-8545                                           | 8.2             |
| brace-expansion (dev) | 1.1.15 / 2.1.1 / 5.0.6 | GHSA-3jxr-9vmj-r5cp                                           | 7.7             |
| fast-uri              | 3.1.2                  | GHSA-4c8g-83qw-93j6, GHSA-v2hh-gcrm-f6hx                      | 7.5             |
| js-yaml               | 4.2.0                  | GHSA-52cp-r559-cp3m                                           | 7.5             |
| sharp                 | 0.34.5                 | GHSA-f88m-g3jw-g9cj                                           | 7.0             |
| hono                  | 4.12.25                | GHSA-hvrm-45r6-mjfj, GHSA-w62v-xxxg-mg59, GHSA-xgm2-5f3f-mvvc | 6.5 / 6.1 / 4.8 |
| protobufjs            | 8.6.3                  | GHSA-j3f2-48v5-ccww, GHSA-jfj6-75fj-8934                      | 5.3 / 4.8       |
| @astrojs/rss          | 4.0.18                 | GHSA-8j5q-mfj2-5q9q                                           | 4.3             |
| body-parser           | 1.20.5 / 2.2.2         | GHSA-v422-hmwv-36x6                                           | 3.7             |
| dompurify             | 3.4.11                 | GHSA-c2j3-45gr-mqc4                                           | 2.1             |

(The one already-accepted `ip@2.0.1` SSRF is correctly filtered via `osv-scanner.toml` — REMOTE-001.)

## What

1. **Triage each advisory**: bump to a fixed version where one exists (most of these have fixes), or add a
   documented accepted-risk entry to `osv-scanner.toml` (the single SSOT) with a reachability rationale — matching
   the existing `ip@2.0.1` precedent. Prioritise the high-CVSS transitive deps (svgo/brace-expansion/fast-uri/
   js-yaml/sharp).
2. **Close the scheduling gap**: run `security-audit` (osv-scanner) on a **schedule** (nightly/weekly `cron`) and/or
   on every PR — not only when the manifest changes — so newly-published advisories are caught within a day
   instead of at the next accidental `package.json` edit. Keep the manifest-change fast path; add a scheduled full
   scan.

## Test Plan

- After triage, `osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml` exits 0.
- The scheduled workflow run appears green on `develop` and correctly fails on an injected known-vuln fixture.

## User Execution Test Scenarios

- Not applicable (CI/security infra). Evidence: a green osv-scanner run + the scheduled-workflow run URL.
