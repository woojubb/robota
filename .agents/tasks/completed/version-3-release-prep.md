# Version 3.0 Release Preparation

## Status: in-progress

## Priority: high

## Context

Current versions: core packages at 2.0.9, dag/playground/remote at 0.1.0-1.0.0.
After completing code review fixes, JSDoc audit, SPEC enrichment, and test coverage,
the codebase will be ready for a 3.0 major version bump.

## Prerequisites (must complete before version bump)

- [x] All MUST/SHOULD code review fixes merged
- [x] JSDoc audit and update (completed)
- [x] SPEC.md content enrichment (completed)
- [x] Test coverage expansion (completed — 63 files, 948 tests)
- [x] SSOT type duplicate resolution (0 violations remaining)
- [x] Naming convention fixes (0 violations remaining)

## Version Bump Plan

### Packages bumping to 3.0.0

- @robota-sdk/agent-core
- @robota-sdk/agent-provider-openai
- @robota-sdk/agent-provider-anthropic
- @robota-sdk/agent-provider-google
- @robota-sdk/agent-sessions
- @robota-sdk/agent-team

### Packages bumping to 1.0.0 (first stable)

- @robota-sdk/agent-remote (currently 1.0.0 — evaluate if 1.0.0 or 2.0.0)
- @robota-sdk/agent-playground (currently 0.1.0)

### Packages remaining at 0.x (pre-stable)

- @robota-sdk/dag-core
- @robota-sdk/dag-runtime
- @robota-sdk/dag-worker
- @robota-sdk/dag-scheduler
- @robota-sdk/dag-projection
- @robota-sdk/dag-api
- @robota-sdk/dag-designer
- @robota-sdk/dag-nodes/\*

## Release Checklist

- [ ] All prerequisite tasks completed
- [ ] Version numbers updated in all package.json files
- [ ] Inter-package dependency versions updated
- [ ] CHANGELOG.md created or updated
- [ ] README.md version references updated
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm docs:build` passes
- [ ] Git tag created (v3.0.0)
- [ ] Manual release workflow triggered

## Execution Order

1. Complete all prerequisite tasks
2. Create release branch from develop
3. Bump versions
4. Update changelogs
5. Final verification
6. PR to main for release
7. Tag and trigger release workflow
