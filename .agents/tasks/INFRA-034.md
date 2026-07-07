# INFRA-034 — Remove agent-tool-mcp unused agent-tools devDependency (ARL-05)

Spec: `.agents/spec-docs/active/INFRA-034-agent-tool-mcp-unused-dep.md`

## Tasks

- [ ] T1 (TC-01): Remove `@robota-sdk/agent-tools` from `packages/agent-tool-mcp/package.json` devDependencies.
- [ ] T2: `pnpm install` (lockfile).
- [ ] T3 (TC-01/02): `rg` still zero imports; `pnpm --filter @robota-sdk/agent-tool-mcp build && typecheck` green (authoritative).
- [ ] T4 (TC-03): `pnpm harness:scan` 45/45 (non-regression sanity — no unused-dep scan exists).
- [ ] T5 (TC-04): Mark ARL-05 Resolved in `.agents/architecture-remediation-log.md`.

## Test Plan / 검증

Manifest-only cleanup: remove a devDependency imported nowhere. Authoritative verification is manual `rg` (zero imports) + build + typecheck; harness:scan is a non-regression sanity check (no repo scan detects unused declared deps). No changeset (private package, no code/API change).
