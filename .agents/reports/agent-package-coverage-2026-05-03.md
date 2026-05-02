# Agent Package Coverage Baseline

- **Date**: 2026-05-03
- **Scope**: `packages/agent-*`
- **Command**: `pnpm --filter "@robota-sdk/agent-*" run --if-present test:coverage -- --coverage.reporter=json-summary --coverage.reporter=text-summary`
- **Notes**: The pnpm filter also dispatched app packages whose names match `@robota-sdk/agent-*`; this report includes only `packages/agent-*`.

## Summary

The agent package family has uneven coverage. Core, SDK, runtime, most providers, most plugins, and most transports are at or above roughly 70% line coverage. The highest-risk gaps are `agent-tools`, `agent-sessions`, `agent-tool-mcp`, `agent-playground`, and the Gemini compatibility wrapper package.

Do not add a global threshold yet. The current package set includes small compatibility wrappers, UI-heavy packages, and packages with intentionally sparse or no executable source. Add targeted thresholds only after high-risk packages have package-specific coverage plans.

## Package Results

| Package                                         | Lines | Branches | Functions | Statements | Risk Note                                              |
| ----------------------------------------------- | ----: | -------: | --------: | ---------: | ------------------------------------------------------ |
| `@robota-sdk/agent-cli`                         | 70.20 |    76.87 |     83.50 |      70.20 | UI hooks/App paths remain comparatively low            |
| `@robota-sdk/agent-command-agent`               | 79.58 |    76.27 |     75.00 |      79.58 | Acceptable baseline                                    |
| `@robota-sdk/agent-core`                        | 83.03 |    80.18 |     72.12 |      83.03 | Good baseline; some plugin/registry helpers low        |
| `@robota-sdk/agent-event-service`               |   n/a |      n/a |       n/a |        n/a | No covered executable source in report                 |
| `@robota-sdk/agent-playground`                  |  0.37 |     3.81 |      1.90 |       0.37 | Critical UI/package coverage gap                       |
| `@robota-sdk/agent-plugin-conversation-history` | 83.90 |    75.96 |    100.00 |      83.90 | Acceptable baseline                                    |
| `@robota-sdk/agent-plugin-error-handling`       | 93.80 |    79.10 |     88.24 |      93.80 | Good baseline                                          |
| `@robota-sdk/agent-plugin-event-emitter`        | 88.25 |    87.50 |     75.86 |      88.25 | Good baseline                                          |
| `@robota-sdk/agent-plugin-execution-analytics`  | 87.47 |    68.92 |     77.78 |      87.47 | Branch coverage should be improved                     |
| `@robota-sdk/agent-plugin-limits`               | 98.09 |    93.58 |     94.12 |      98.09 | Strong baseline                                        |
| `@robota-sdk/agent-plugin-logging`              | 91.91 |    86.82 |     85.37 |      91.91 | Strong baseline                                        |
| `@robota-sdk/agent-plugin-performance`          | 88.11 |    77.14 |     96.00 |      88.11 | Good baseline                                          |
| `@robota-sdk/agent-plugin-usage`                | 94.37 |    91.10 |    100.00 |      94.37 | Strong baseline                                        |
| `@robota-sdk/agent-plugin-webhook`              | 93.76 |    72.87 |     92.11 |      93.76 | Branch coverage should be improved                     |
| `@robota-sdk/agent-provider-anthropic`          | 80.26 |    86.59 |     84.21 |      80.26 | Good baseline                                          |
| `@robota-sdk/agent-provider-bytedance`          | 92.48 |    91.88 |     90.91 |      92.48 | Strong baseline                                        |
| `@robota-sdk/agent-provider-gemini`             | 95.14 |    90.87 |    100.00 |      95.14 | Strong baseline                                        |
| `@robota-sdk/agent-provider-gemma`              | 86.42 |    74.36 |     91.01 |      86.42 | Good baseline; branch coverage should improve          |
| `@robota-sdk/agent-provider-google`             | 39.39 |    50.00 |     50.00 |      39.39 | Compatibility wrapper needs targeted smoke coverage    |
| `@robota-sdk/agent-provider-openai-compatible`  | 90.13 |    77.37 |     96.77 |      90.13 | Good baseline                                          |
| `@robota-sdk/agent-provider-openai`             | 91.68 |    83.96 |     84.62 |      91.68 | Strong baseline                                        |
| `@robota-sdk/agent-provider-qwen`               | 81.97 |    69.31 |     84.48 |      81.97 | Branch coverage should be improved                     |
| `@robota-sdk/agent-remote-client`               | 99.32 |    92.90 |    100.00 |      99.32 | Strong baseline                                        |
| `@robota-sdk/agent-runtime`                     | 93.31 |    74.26 |     84.69 |      93.31 | Good baseline; worktree/cancel edge cases still needed |
| `@robota-sdk/agent-sdk`                         | 91.16 |    81.10 |     85.46 |      91.16 | Strong baseline                                        |
| `@robota-sdk/agent-sessions`                    | 66.42 |    77.27 |     45.31 |      66.42 | High-risk runtime/session gap                          |
| `@robota-sdk/agent-team`                        | 91.02 |    71.43 |     75.00 |      91.02 | Acceptable baseline                                    |
| `@robota-sdk/agent-tool-mcp`                    |  0.00 |     0.00 |      0.00 |       0.00 | Critical package coverage gap                          |
| `@robota-sdk/agent-tools`                       | 31.64 |    79.56 |     65.31 |      31.64 | Critical filesystem/shell tool coverage gap            |
| `@robota-sdk/agent-transport-headless`          | 93.41 |    86.57 |     91.18 |      93.41 | Strong baseline                                        |
| `@robota-sdk/agent-transport-http`              | 71.79 |    88.89 |     75.00 |      71.79 | Acceptable baseline                                    |
| `@robota-sdk/agent-transport-mcp`               | 63.33 |    90.00 |     62.50 |      63.33 | Add transport request/response coverage                |
| `@robota-sdk/agent-transport-ws`                | 91.26 |    86.32 |     83.78 |      91.26 | Strong baseline                                        |

## Recommended Follow-ups

1. **agent-tools**: add characterization tests for Bash, Read, Write, Edit, Glob, Grep, WebFetch, and WebSearch behavior before sandbox/refactor work.
2. **agent-sessions**: add tests for lifecycle hooks, compaction orchestration, session persistence, abort/timeout, and context reconciliation paths.
3. **agent-tool-mcp**: add basic protocol/tool wrapper tests or explicitly document why the package should be excluded from coverage gates.
4. **agent-playground**: decide whether UI-heavy package coverage belongs in component tests, integration tests, or a separate app-level coverage plan.
5. **agent-provider-google**: add wrapper compatibility tests that prove legacy imports/settings still route to canonical Gemini behavior.
6. **agent-runtime**: add the worktree hardening edge-case tests before changing default worktree isolation policy.

## Threshold Recommendation

Do not introduce one global threshold for `agent-*` packages now.

Recommended staged policy:

- Start with package-owned thresholds only for packages already above 80% and not UI-heavy.
- Require targeted regression tests for new code in low-coverage packages.
- After `agent-tools`, `agent-sessions`, and `agent-tool-mcp` improve, consider a release-grade coverage threshold for critical runtime packages only.
