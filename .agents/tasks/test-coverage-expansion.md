# Test Coverage Expansion

## Status: in-progress

## Priority: high

## Summary

Multiple packages have critically low or zero test coverage despite having production code.

## Tasks

### agents package (~6% coverage)
- 125 source files, only 26 have tests (516 tests total)
- Key untested areas: core Robota class, provider integration, plugin lifecycle, DI container
- Reference: `.design/2026-03-08-harness-comprehensive-review.md`

### dag-designer (0% coverage)
- Production components exist (node-config-panel, schema-defaults, port-editor-utils, etc.)
- No test files at all
- Priority: schema-defaults.ts and node-config-panel.tsx

### sessions package (minimal)
- Only session-manager.test.ts exists (8 tests)
- ChatInstance has no tests

### apps/ (0% coverage)
- web, api-server, docs — all have zero tests
- api-server should have at least route-level integration tests

### team / workflow / playground
- Minimal or no test coverage
- Lower priority than above

## Acceptance Criteria

- agents: at least 30% file coverage (40+ test files)
- dag-designer: at least 3 test files covering core components
- sessions: ChatInstance test coverage
- api-server: basic route integration tests
