---
title: 'Spec Audit: agent-playground'
status: completed
priority: low
created: 2026-03-20
packages:
  - agent-playground
---

# Spec Audit: agent-playground

## Goal

agent-playground SPEC.md claims exports that are not publicly reachable and has incorrect inheritance claims.

## Issues Found (5)

### MEDIUM (4)

1. **Hooks not exported**: `usePlaygroundData`, `useRobotaExecution`, `useChatInput` listed as Public API but not re-exported from public entry points.
2. **ToolRegistry not exported**: Listed as Public API but only used internally.
3. **Plugin inheritance wrong**: Both PlaygroundStatisticsPlugin and PlaygroundHistoryPlugin claimed to extend AbstractPlugin — they are plain standalone classes.
4. **IPlaygroundBlockCollector path wrong**: SPEC says `src/executor/block-collector.ts`, actual is `src/lib/playground/block-tracking/block-collector.ts`.

### LOW (1)

5. Architecture Overview does not mention block-tracking layer (PlaygroundBlockCollector, LLMTracker, etc.).
