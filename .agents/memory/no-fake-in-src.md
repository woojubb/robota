# No test doubles (fake/mock/stub) in shipped code — HARNESS-032

**Principle (owner governance, recurring 2026-07-19).** `fake`/`mock`/`stub` name TEST doubles ONLY — never shipped
dev/production code. A `Fake*`/`Mock*`/`Stub*` declaration or `create(Fake|Mock|Stub)*` factory must not be declared/
exported from a package's shippable `src` (outside `__tests__/`, `testing/`, `*.test.ts`, `*.spec.ts`).

**Why.** The owner flagged "fake" appearing in shipped code twice ("또다시"). It recurred into the SELFHOST-010 spec
(`FakeComputerDriver` in `agent-tools/src`) because there was NO mechanical floor. Pre-existing violations existed too
(`dag-adapters-local` exported `FakeClockPort`/`MockTaskExecutorPort`/`createStubPromptBackend` — test-support ports in
the main entry; `agent-playground` `createMockUsageSnapshot` + browser-stub `Mock*` classes).

**How to apply.** Enforced by `scripts/harness/scan-no-fake-in-src.mjs` (registered in run-all-scans; the
`no-fake-in-src` scan) — flags test-double-named declarations/exports in non-test `packages/<pkg>/src`; suppress a
sanctioned occurrence with `// allow-fake: <reason>` (reason-less anti-rot). Rule in
[code-quality.md](../rules/code-quality.md) Development Patterns. Correct fix for a hit: rename to what it IS
(`InMemory…`/`Manual…`/`Recording…`/`Scripted…`) OR move the test double under a `testing/` subpath exported via
`./testing` (the `@robota-sdk/agent-core/testing` `scripted-provider` precedent). Sibling of the No-Fallback floor
([[no-fallback-gate]]). Pre-existing debt is allowlisted in the scan + tracked by `.agents/backlog/HARNESS-033-fake-in-src-sweep.md`.
