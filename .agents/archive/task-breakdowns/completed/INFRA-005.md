# INFRA-005 Tasks

Spec: `.agents/spec-docs/todo/INFRA-005-architecture-md-planned-packages.md`

## Tasks

- [x] TC-01: Add a "Planned (not yet created)" marker to every line in `ARCHITECTURE.md` and `.agents/specs/architecture-map/cross-cutting-contracts.md` that names `auth` or `credits` as a package or contract-owner. The `harness:conformance` package-name guard (which exempts `planned`-marked lines) must then treat them as documented-but-uncreated; no doc may present them as live packages. Verify with `rg -n 'auth|credits' ARCHITECTURE.md .agents/specs/architecture-map/cross-cutting-contracts.md` — every package/owner line also matches `planned` (case-insensitive).
- [x] TC-02: `pnpm harness:scan` exits 0 after the doc-only change.

## Test Plan

Both criteria are command-form smoke checks over a doc-only change to `ARCHITECTURE.md` and `cross-cutting-contracts.md`. TC-01 is verified by running the `rg` grep assertion and confirming every `auth`/`credits` package/owner line also carries a `planned` marker. TC-02 is verified by running `pnpm harness:scan` and confirming exit code 0.

| TC-ID | Test Type              | Tool / Approach                                                                                                                                     | Notes                        |
| ----- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| TC-01 | CI pipeline smoke test | `rg -n 'auth\|credits' ARCHITECTURE.md .agents/specs/architecture-map/cross-cutting-contracts.md` → every package/owner line also matches `planned` | Command-form: grep assertion |
| TC-02 | CI pipeline smoke test | `pnpm harness:scan` exit 0                                                                                                                          | doc-only change              |

## Result

(pending implementation)
