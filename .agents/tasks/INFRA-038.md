# INFRA-038 — migrate CI vuln-scan to osv-scanner + fix flagged transitive vulns

Spec: `.agents/spec-docs/active/INFRA-038-vuln-scan-migration-and-dep-security.md` (status: in-progress).
Owner directed (npm audit 이슈 + 취약 패키지 업데이트); approval delegated on rule-conformance; proposal-review
REVISE (re-accept SSOT consolidation) applied.

npm retired the legacy audit endpoint → `pnpm audit` 410 blocks release-grade CI. Swap to osv-scanner (lockfile,
OSV.dev), fix the 2 fixable vulns via overrides (undici→>=6.27.0, js-yaml→>=3.15.0), keep the ip re-accept
(CVE-2024-29415, no fix, unreachable in werift) in osv-scanner.toml (single SSOT; auditConfig.ignoreCves deleted).

## Tasks

- [x] T1: `pnpm.overrides` += undici/js-yaml; `pnpm install`; delete `pnpm.auditConfig.ignoreCves`. osv-scan → only
      ip, filtered by osv-scanner.toml → 0 un-ignored (exit 0).
- [x] T2: `osv-scanner.toml` (ip re-accept SSOT); swap `pnpm audit` → osv-scanner in ci.yml (2) + deploy.yml (1);
      actionlint clean.
- [x] T3: typecheck + lint (0 errors) + build:deps green; werift cve-2024-29415 regression test passes.
- [ ] T4: feature→develop→main via merge-verifier (UNBLOCKS main — release-grade now runs osv-scanner).
- [ ] T5 (GATE-COMPLETE): CI release-grade verification green on the new scanner.

## Test Plan

- **Agent-owned (local):** `osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml` → 0
  un-ignored (ip filtered); lockfile undici≥6.27 / js-yaml≥3.15 (same major); `typecheck` + `lint` (0 errors) +
  `build:deps` green; werift `cve-2024-29415-reachability.test.ts` passes; `actionlint` on ci.yml/deploy.yml.
- **CI:** the rewritten release-grade verification + security-audit steps run osv-scanner and pass — this unblocks
  `develop→main`.
