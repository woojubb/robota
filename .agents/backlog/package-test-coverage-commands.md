# Package Test Coverage Commands

## What

Add consistent package-level test coverage scripts to workspace `package.json` files, and add root-level commands that can run coverage across packages or a selected package scope.

## Why

The repository has many tests, but coverage commands are inconsistent: some packages expose `test:coverage`, while many packages only expose `test`. This makes it harder to answer package-specific coverage questions and to verify whether new tests meaningfully cover the behavior they are intended to protect.

Coverage should be available as an explicit verification tool without making every normal commit or PR path slower by default.

## Scope

- Audit workspace packages to identify which test runner each package uses.
- Add `test:coverage` scripts for packages that use Vitest and do not already expose coverage.
- Preserve existing Jest coverage scripts in app packages.
- Add root scripts for:
  - all package coverage;
  - filtered package coverage through pnpm filters;
  - optionally coverage summary collection if the output format is useful for CI or review.
- Decide whether coverage output directories should be standardized and gitignored.
- Document when coverage should be run manually versus in CI/harness flows.

## Non-Goals

- Do not add coverage gates to every default local commit hook.
- Do not slow down ordinary `pnpm test`, scoped harness verification, or pre-push flows by default.
- Do not require 100% coverage.
- Do not count generated `dist/`, fixtures, or test helpers as coverage targets.

## Acceptance Criteria

- [ ] Every testable workspace package has a documented coverage command, or an explicit note explaining why it is excluded.
- [ ] Root `package.json` exposes a coverage command that can run package coverage consistently.
- [ ] Existing package-specific coverage scripts are preserved or normalized without breaking their current behavior.
- [ ] Coverage output is excluded from git.
- [ ] The implementation plan explains whether CI should run coverage always, only on demand, or only for changed scopes.
- [ ] Tests or harness checks verify that required package scripts exist where expected.

## Risks & Mitigations

| Risk                                    | Mitigation                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Coverage runs make PR feedback too slow | Keep coverage opt-in or changed-scope only unless a later CI policy changes |
| Mixed Vitest/Jest packages drift        | Detect runner per package and avoid forcing one runner everywhere           |
| Coverage artifacts pollute git status   | Standardize coverage output paths and gitignore them                        |
| Script naming diverges across packages  | Use `test:coverage` as the package-level convention                         |

## Promotion Path

1. Move to `.agents/tasks/INFRA-BL-0XX-package-test-coverage-commands.md`.
2. Audit all workspace package scripts before editing.
3. Add scripts in small batches and verify with representative packages.
4. Decide whether a harness scan should enforce script presence.
