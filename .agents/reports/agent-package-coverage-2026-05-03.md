# Agent Package Coverage Baseline

- **Date**: 2026-05-03
- **Scope**: workspace packages under `packages/agent-*` whose package name starts with `@robota-sdk/agent-`
- **Excluded**: example packages such as `robota-agents-examples`, `robota-openai-examples`, and `robota-team-examples`
- **Text command**: `pnpm --filter "./packages/agent-*" run --if-present test:coverage -- --coverage.reporter=json-summary --coverage.reporter=text-summary`
- **Machine-readable command**: `pnpm --filter "./packages/agent-*" exec vitest run --coverage --passWithNoTests --coverage.reporter=json-summary --coverage.reporter=text-summary`

## Summary

The agent package family has uneven coverage. `agent-core`, `agent-sdk`, `agent-runtime`, most providers, most plugins, and most transports have usable line coverage. The highest-risk gaps are `agent-tools`, `agent-sessions`, `agent-tool-mcp`, `agent-cli` UI shell paths, and `agent-playground`.

Do not add a global `agent-*` coverage threshold yet. The package set includes core runtime libraries, CLI/TUI code, provider wrappers, compatibility wrappers, UI-heavy packages, and packages with no executable source after intentional exclusions. Add package-owned thresholds only after the low-coverage critical packages have explicit coverage plans.

## Package Results

| Package                                         | Tests |  Lines | Branches | Functions | Statements | Classification                 | Risk Note                                            |
| ----------------------------------------------- | ----: | -----: | -------: | --------: | ---------: | ------------------------------ | ---------------------------------------------------- |
| `@robota-sdk/agent-cli`                         |    57 | 70.28% |   77.78% |    82.32% |     70.28% | tested executable source       | UI shell and process entry paths remain low          |
| `@robota-sdk/agent-command-agent`               |     1 | 79.57% |   76.27% |    75.00% |     79.57% | tested executable source       | Acceptable baseline                                  |
| `@robota-sdk/agent-command-compact`             |     1 | 92.00% |   77.77% |    87.50% |     92.00% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-command-context`             |     1 | 85.23% |   81.57% |    92.85% |     85.23% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-command-language`            |     1 | 92.59% |   87.50% |    85.71% |     92.59% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-command-mode`                |     1 | 93.54% |   90.00% |    85.71% |     93.54% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-command-model`               |     1 | 92.50% |   90.90% |    87.50% |     92.50% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-command-permissions`         |     1 | 91.17% |   85.71% |    85.71% |     91.17% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-command-provider`            |     1 | 73.90% |   64.58% |    75.00% |     73.90% | tested executable source       | Provider setup branches need more coverage           |
| `@robota-sdk/agent-command-session`             |     1 | 91.55% |   92.85% |     92.3% |     91.55% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-command-statusline`          |     1 | 95.65% |   96.29% |    87.50% |     95.65% | tested executable source       | Strong baseline                                      |
| `@robota-sdk/agent-core`                        |    41 | 83.03% |   80.18% |    72.12% |     83.03% | tested executable source       | Core baseline is usable; helper functions remain low |
| `@robota-sdk/agent-event-service`               |     2 |    n/a |      n/a |       n/a |        n/a | no executable source in report | Thin re-export barrel intentionally excluded         |
| `@robota-sdk/agent-playground`                  |     1 |  0.36% |    3.80% |     1.90% |      0.36% | tested executable source       | Critical UI/package coverage gap                     |
| `@robota-sdk/agent-plugin-conversation-history` |     2 | 83.89% |   75.96% |   100.00% |     83.89% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-plugin-error-handling`       |     1 | 93.79% |   79.10% |    88.23% |     93.79% | tested executable source       | Strong baseline                                      |
| `@robota-sdk/agent-plugin-event-emitter`        |     2 | 88.25% |   87.50% |    75.86% |     88.25% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-plugin-execution-analytics`  |     1 | 87.47% |   68.91% |    77.77% |     87.47% | tested executable source       | Branch coverage should improve                       |
| `@robota-sdk/agent-plugin-limits`               |     1 | 98.08% |   93.57% |    94.11% |     98.08% | tested executable source       | Strong baseline                                      |
| `@robota-sdk/agent-plugin-logging`              |     3 | 91.91% |   86.82% |    85.36% |     91.91% | tested executable source       | Strong baseline                                      |
| `@robota-sdk/agent-plugin-performance`          |     3 | 88.11% |   77.14% |    96.00% |     88.11% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-plugin-usage`                |     5 | 94.36% |   91.09% |   100.00% |     94.36% | tested executable source       | Strong baseline                                      |
| `@robota-sdk/agent-plugin-webhook`              |     1 | 93.75% |   72.86% |    92.10% |     93.75% | tested executable source       | Branch coverage should improve                       |
| `@robota-sdk/agent-provider-anthropic`          |     3 | 80.26% |   86.58% |    84.21% |     80.26% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-provider-bytedance`          |     3 | 92.47% |   91.87% |    90.90% |     92.47% | tested executable source       | Strong baseline                                      |
| `@robota-sdk/agent-provider-gemini`             |     6 | 95.14% |   90.82% |   100.00% |     95.14% | tested executable source       | Strong baseline                                      |
| `@robota-sdk/agent-provider-gemma`              |     3 | 86.42% |   74.35% |    91.01% |     86.42% | tested executable source       | Branch coverage should improve                       |
| `@robota-sdk/agent-provider-google`             |     1 | 39.39% |   50.00% |    50.00% |     39.39% | compatibility wrapper          | Add wrapper compatibility smoke coverage             |
| `@robota-sdk/agent-provider-openai`             |     9 | 91.68% |   83.87% |    84.61% |     91.68% | tested executable source       | Strong baseline                                      |
| `@robota-sdk/agent-provider-openai-compatible`  |     4 | 90.12% |   77.37% |    96.77% |     90.12% | tested executable source       | Good baseline                                        |
| `@robota-sdk/agent-provider-qwen`               |     2 | 81.96% |   69.31% |    84.48% |     81.96% | tested executable source       | Branch coverage should improve                       |
| `@robota-sdk/agent-remote-client`               |     7 | 99.31% |   92.89% |   100.00% |     99.31% | tested executable source       | Strong baseline                                      |
| `@robota-sdk/agent-runtime`                     |     4 | 93.37% |   74.16% |    85.00% |     93.37% | tested executable source       | Add worktree/cancel edge cases before policy changes |
| `@robota-sdk/agent-sdk`                         |    57 | 88.59% |   80.40% |    80.98% |     88.59% | tested executable source       | Good baseline; provider command helpers are low      |
| `@robota-sdk/agent-sessions`                    |     4 | 67.59% |   79.00% |    47.82% |     67.59% | tested executable source       | High-risk runtime/session gap                        |
| `@robota-sdk/agent-team`                        |     1 | 91.01% |   71.42% |    75.00% |     91.01% | tested executable source       | Acceptable baseline                                  |
| `@robota-sdk/agent-tool-mcp`                    |     0 |  0.00% |    0.00% |     0.00% |      0.00% | no tests                       | Critical MCP tool coverage gap                       |
| `@robota-sdk/agent-tools`                       |     4 | 31.64% |   79.55% |    65.30% |     31.64% | tested executable source       | Critical filesystem/shell/web tool coverage gap      |
| `@robota-sdk/agent-transport-headless`          |     3 | 93.41% |   86.56% |    91.17% |     93.41% | tested executable source       | Strong baseline                                      |
| `@robota-sdk/agent-transport-http`              |     2 | 71.79% |   88.88% |    75.00% |     71.79% | tested executable source       | Acceptable baseline                                  |
| `@robota-sdk/agent-transport-mcp`               |     2 | 63.33% |   90.00% |    62.50% |     63.33% | tested executable source       | Add transport request/response coverage              |
| `@robota-sdk/agent-transport-ws`                |     2 | 91.25% |   86.31% |    83.78% |     91.25% | tested executable source       | Strong baseline                                      |

## Notable Uncovered Public Surfaces

- `agent-tools`: built-in Bash, Read, Write, Edit, Glob, Grep, WebFetch, and WebSearch tools are at 0% in this run even though the package has registry/schema tests.
- `agent-tool-mcp`: `mcp-tool.ts`, `relay-mcp-tool.ts`, and protocol glue have no tests.
- `agent-sessions`: `session-store.ts`, `session-logger.ts`, `tool-hook-helpers.ts`, `permission-enforcer.ts`, and lifecycle branches are low or uncovered.
- `agent-cli`: `App.tsx`, `InputArea.tsx`, `useSideEffects.ts`, `useInteractiveSession.ts`, process entry files, and child worker entry files are low or uncovered.
- `agent-sdk`: provider command common APIs such as `provider-command-probe.ts`, `provider-setup-flow.ts`, provider env-ref/settings helpers, and permission prompt paths are the main remaining low spots.
- `agent-playground`: only `button.tsx` has meaningful coverage; most app/component/playground execution code is uncovered.
- `agent-provider-google`: the compatibility wrapper mostly re-exports Gemini behavior; add smoke tests for legacy import surfaces rather than treating it like a full provider.

## Prioritized Coverage Plan

1. **agent-tools**: add characterization tests for shell/file edit/read/write/search/fetch tool behavior before sandbox or rollback work.
2. **agent-sessions**: add lifecycle, persistence, permission, compaction, abort, timeout, and context reconciliation tests before worktree/sandbox semantics change.
3. **agent-tool-mcp**: add basic MCP protocol and relay tool tests, or explicitly mark the package excluded from thresholds until the MCP boundary is redesigned.
4. **agent-cli**: add tests around thin TUI side-effect bridges before migrating more hardcoded slash commands into built-in command packages.
5. **agent-sdk**: cover provider command common API helpers before moving more provider setup/model command logic behind built-in commands.
6. **agent-playground**: decide whether this private UI package needs component/integration coverage or should be tracked under an app-specific coverage plan.
7. **agent-transport-mcp/http**: add request/response and error-path tests for transport edge cases.

## Threshold Recommendation

Do not introduce one global threshold now.

Recommended staged policy:

- Add package-owned thresholds only to stable packages already above 80% line coverage and not UI-heavy.
- Require targeted regression tests for new code in low-coverage packages.
- Keep broad coverage out of normal PR checks until `agent-tools`, `agent-sessions`, and `agent-tool-mcp` have improved.
- Consider release-grade thresholds only for critical runtime packages after the staged gaps above are addressed.

## Coverage Script Reliability

Current package scripts are good enough for manual text coverage, but not sufficient for recurring machine-readable audits. Passing reporter flags through the filtered `pnpm run test:coverage` path did not create `coverage-summary.json` consistently in this run, so the machine-readable baseline used direct `vitest` execution through `pnpm --filter ... exec`.

Recommended follow-up:

- Add a dedicated root command such as `pnpm test:coverage:agent-packages:json`.
- Standardize package coverage reporters to include `json-summary`.
- Keep generated `coverage/` directories ignored and uncommitted.
