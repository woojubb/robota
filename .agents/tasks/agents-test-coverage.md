# Agents Package Test Coverage Expansion

- **Status**: in-progress
- **Created**: 2026-03-08
- **Branch**: feat/agents-test-coverage
- **Scope**: packages/agents

## Objective
Expand agents package test coverage from ~6% (8 test files / 117 source files) toward 60% target.

## Plan
- [x] Analyze existing test patterns and source structure
- [x] Write utils tests (errors, validation, message-converter, periodic-task)
- [x] Write tools/registry tests (tool-registry, function-tool, schema-converter)
- [x] Write AI provider manager tests
- [ ] Write limits plugin and tool-execution-service tests
- [ ] Run all tests and fix failures
- [ ] Build verification
- [ ] Commit and push

## Progress
### 2026-03-08
- Identified 117 source files, 8 existing test files
- Launched 4 parallel agents to write tests for utils, tools, managers, plugins
- 3 of 4 agents completed (utils, tools/registry, ai-provider-manager)
- Limits plugin agent still running

## Decisions
- Prioritized core modules (utils, tools, managers, plugins) for maximum coverage impact
- Followed existing test patterns (vitest, vi.mock for logger, MockAIProvider extending AbstractAIProvider)

## Blockers
- (none)

## Result
(pending)
