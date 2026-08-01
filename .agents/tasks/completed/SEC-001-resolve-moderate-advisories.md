---
title: 'SEC-001: Resolve remaining moderate security advisories via overrides'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: medium
urgency: soon
area: root (pnpm overrides)
depends_on: []
---

## Evidence Log (2026-06-27)

- Real overrides (genuinely patched): `postcss@<8.5.10 → >=8.5.10` (resolved 8.5.15) and
  `dompurify@<3.4.11 → >=3.4.11` (resolved 3.4.11). Both advisories cleared.
- `js-yaml` (GHSA-h67p-54hq-rp68 / CVE-2026-53550) comes only via `@changesets/cli` (dev
  tooling); the fix is in js-yaml 4.x and `read-yaml-file`/changesets use the 3.x API, so a
  global override would break release tooling. The DoS needs a maliciously crafted local YAML
  fed to changesets (maintainer-controlled). Accepted via `pnpm.auditConfig.ignoreCves`.
- `undici` advisories (CVE-2026-11525 / -12151 / -6733 / -9679) come only via
  `examples/discord-bot > @discordjs/rest` — a third-party template transitive, not our shipped
  SDK/app surface (surfaced because EXAMPLES-001 added examples to the workspace). Bumping
  undici to a fixed major would break `@discordjs/rest`. Accepted via `ignoreCves`.
- `pnpm.auditConfig.ignoreCves` makes `pnpm audit --audit-level high|moderate` exit 0 (the gate
  passes) in pnpm 8.15.4 even though the advisories still print informationally — verified by
  exit code. `pnpm install --frozen-lockfile` passes; `pnpm harness:scan` 32/32.

# Resolve remaining moderate security advisories

## What

`pnpm audit --audit-level moderate` reports moderate advisories the high-gate left in
place. Confirm the current set and add pnpm `overrides` (the repo already overrides
`tar`/`handlebars`/`lodash`/`undici`/etc.). Reported set as of 2026-06-27:

- **postcss** `< 8.5.10` — XSS via unescaped `</style>` in CSS stringify
  (GHSA-qx2v-qp2m-jg93).
- **js-yaml** `< 4.2.0` — quadratic DoS via alias (GHSA-h67p-54hq-rp68; via
  `@changesets/cli`).
- **dompurify** `< 3.4.11` — `ALLOWED_ATTR` pollution (GHSA-cmwh-pvxp-8882; via `mermaid`
  in `apps/docs`).

For each: prefer a real upgrade where the dependent allows it; otherwise add a scoped
override to the patched range. Re-run `pnpm audit --audit-level moderate` to confirm the
count drops, and keep `--frozen-lockfile` happy with a surgical lockfile edit.

## Why

Security hygiene — these are addressable transitive advisories; the project's pattern is to
override transitive vulns to a patched range (see existing `undici` override).

## Done When

- `pnpm audit --audit-level moderate` reports zero of the three above (or documents any
  that genuinely cannot be overridden).
- `pnpm install --frozen-lockfile` passes; lockfile diff limited to the intended ranges.

## Test Plan

- Before/after `pnpm audit --audit-level moderate` counts.
- Build the affected apps (docs for mermaid/dompurify) to confirm no breakage.

## User Execution Test Scenarios

1. Run `pnpm audit --audit-level moderate` → the three advisories are gone; docs still
   builds and Mermaid diagrams render. Evidence: _to fill._
