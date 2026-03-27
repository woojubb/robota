# Common Mistakes

Mistakes observed repeatedly in this codebase. Every item below has caused a real failure.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

| #   | Mistake                                                          | Correct approach                                                                |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Using `any` or `{}` in production code                           | Use `unknown` + narrowing, or define a proper interface                         |
| 2   | Forgetting `pnpm build` before `pnpm test` in a dependency chain | Always run `pnpm build:deps` first, or use `harness:verify`                     |
| 3   | Creating bidirectional package dependencies                      | Dependency direction is one-way; see `.agents/project-structure.md`             |
| 4   | Pass-through re-exports (`export * from '@robota-sdk/other'`)    | Import from the owning package directly                                         |
| 5   | Committing without running `pnpm typecheck`                      | Pre-commit hook runs lint-staged; always verify locally                         |
| 6   | Adding a new package without `docs/SPEC.md`                      | Every workspace package requires a SPEC.md; see `spec-writing-standard` skill   |
| 7   | Using `console.*` in production code                             | Use dependency-injected logger                                                  |
| 8   | Modifying a spec without running the conformance loop            | Every spec change requires `spec-code-conformance` verification                 |
| 9   | Using `try/catch` as a fallback mechanism                        | No fallback policy; terminal failures stay terminal                             |
| 10  | Writing implementation before a failing test                     | TDD: red-green-refactor; write the test first                                   |
| 11  | Publishing without dry-run                                       | Always run `publish --dry-run` first; see `process.md` Publish Safety Gate      |
| 12  | Publishing packages without user approval on scope               | Confirm publish manifest with user; see `process.md` Publish Scope Approval     |
| 13  | agent-core depending on agent-\* packages                        | agent-core MUST NOT depend on any @robota-sdk/agent-\* package                  |
| 14  | Using `npm publish` instead of `pnpm publish`                    | pnpm resolves workspace:\* deps; npm publishes them literally, breaking install |
| 15  | Adding a feature without updating SPEC.md/README.md              | Every new feature requires documentation updates in the same commit/PR          |
| 16  | Hardcoding cross-cutting concerns (fs.appendFile, console.log)   | Use plugin/event architecture; see `code-quality.md` Layered Assembly           |
| 17  | Bypassing layer boundaries (CLI using core internals directly)   | Each layer consumes only its direct dependency's public API                     |
| 18  | Maintaining separate parallel arrays that must stay in sync      | Use a single data structure (array of objects, Map); see `code-quality.md`      |
| 19  | Firing post-event hooks before state mutation is complete        | Post hooks/callbacks fire only after all side effects are done                  |
| 20  | Factory ignoring values available in its config/context object   | Use `options.x ?? context.x`; see `code-quality.md` Layered Assembly            |
| 21  | Refactoring code without updating SPEC.md                        | Reverse verify SPEC after boundary-affecting refactors; see `process.md`        |
| 22  | SPEC hardcoding another package's counts or details              | Reference owning SPEC or describe only observable facts; see `process.md`       |
| 23  | Defining identical interface/type independently in two packages  | One SSOT owner, others import; see `code-quality.md` Type System                |
| 24  | Modifying code without updating SPEC first                       | Update SPEC to describe intended state, then fix code to match                  |
| 25  | Publishing a package without removing "not yet published" labels | Search content/ and docs/ for stale labels when first publishing a package      |
| 26  | Refactoring/modularizing code without test coverage first        | Write characterization tests before extraction; see `pre-refactor-test-harness` |
| 27  | Using `pnpm publish` or `npm publish` directly                   | Always use `pnpm publish:beta`; see `publish.md` Publish Command                |
| 28  | Publishing only some packages (cherry-picking)                   | ALL non-private packages must be published together; see `publish.md`           |
| 29  | Modifying SPEC during verification to match code                 | NEVER. Fix code to match SPEC. SPEC is source of truth during verification.     |
