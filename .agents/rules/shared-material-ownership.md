# Shared Material Ownership

Parent: [Project Structure — Shared Material Ownership](../project-structure.md#shared-material-ownership).

Public SDK contracts and generic internal shared material are different classifications. A
domain-owned or forward-provisioned public contract is retained under its owning SPEC and manifest
exports; local consumer counts alone do not authorize deleting it. A generic shared implementation
or test utility requires an owned, domain-neutral API and at least two independently justified
consumer packages. Multiple files in one package and the recording/replay halves of one scenario
are not independent consumers. Owner-local implementation, fixtures and data stay with that owner.

Repository build and verification infrastructure is separately owned. Root placement is not an
exemption: any cross-owner internal reference must have a concrete source/target/kind disposition
and a contract explaining why that reference is needed. New or stale internal boundary accesses and
missing shared-consumer evidence fail the package-boundary gate. Public-entry aliases are checked
against the target's real exported entry instead of being mistaken for private implementation use.

`.agents/package-boundaries.json` records the reviewed dispositions. Named shared API candidates
must retain matching static imported-name evidence, not merely an import of the same barrel.
Root `tsconfig.base.json` owns shared strict compiler defaults; `tsconfig.eslint.json` owns lint
compiler inputs, and `tsconfig.json` owns repository compiler defaults. Their configuration
consumers are recorded as exact `extends` edges, not a wildcard permission to read root files.
Reviewed source-to-public-export correspondences bind the export map and owner build configuration;
changing those inputs invalidates the prior correspondence without invalidating unrelated version
metadata changes.

The gate reuses the workspace graph and source-reference analysis. Its inventory accounts for
tracked paths, non-ignored untracked additions, symlinks, declared generated outputs and unsupported
inputs without reading through symlinks. Unresolved runtime inputs remain visible; they cannot prove
consumer absence or justify shared retention. Runtime input uncertainty and a file's owner are
separate judgments. Verification executes uncertain entries conservatively without cache reuse,
while malformed global inputs retain explicit complete promotion.
