---
name: workflow-determinism-guidance
description: Provide guidance for deterministic scenario record/play behavior, including strict playback and parallel tool strategy. Use when designing scenario determinism rules.
---

# Workflow Determinism Guidance

## Scope
Use this skill to keep scenario record/play deterministic and reproducible.

## Scenario Domain Separation (Minimal)
- Keep scenario domain logic in a dedicated module under workflow.
- Limit separation to SSOT axes (schema, serialize, store, provider, tool wrapper).

## Strict Playback Policy
- In play mode, return recorded tool results and forbid live tool execution.
- Treat mismatches as failures; do not continue with fallback behavior.

## Record Requirements
- Record message snapshots for `chat`, `chatStream`, and `generateResponse`.
- Generate stable request hashes from messages and options.
- Keep step identifiers deterministic and reproducible.

## Playback Requirements
- In `sequential` mode, validate that the recorded request hash matches the current request.
- In `hash` mode, fail on zero matches or ambiguous matches.
- Fail fast if the scenario file is missing.
- Validate that no recorded steps remain unused.

## Store Locking
- Treat concurrent record collisions as failures.
- Do not remove lock files automatically.

## CLI Entry Point
- Keep a single scenario CLI entry point for record/play/verify.
- Avoid proliferating scripts.

## Parallel Tool Call Strategy
- Default to `hash` strategy for parallel tool calls.
- Use `sequential` only when strict ordering is guaranteed.

## Verification Templates
- Maintain package-specific verification templates after migrations.
- Update template paths after Phase 2 moves.

## Determinism Fix Checks
- Ensure tool responses can attach to the originating tool call in local playback paths.
- Ensure agent ownership resolution uses explicit context fields, not inferred IDs.
