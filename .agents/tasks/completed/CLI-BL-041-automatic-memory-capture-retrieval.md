---
title: CLI-BL-041 Automatic Memory Capture and Retrieval
status: completed
priority: high
urgency: next
created: 2026-05-02
packages:
  - agent-sdk
  - agent-cli
branch: feat/automatic-memory-capture-retrieval
related:
  - .agents/tasks/completed/CLI-BL-010-auto-memory-system.md
---

# CLI-BL-041 Automatic Memory Capture and Retrieval

## Summary

Extend the existing project memory foundation into a real automatic memory system. The current implementation provides `.robota/memory` storage, startup index injection, and `/memory list|show|add`; this follow-up adds automatic candidate extraction, approval/policy controls, relevant-topic retrieval, and session-log evidence.

## Problem

The completed `CLI-BL-010` work created the storage and command foundation, but it does not yet behave like automatic memory. A useful memory system must learn from repeated user feedback, project-specific facts, and durable workflow preferences without requiring the user to manually run `/memory add` every time. It also must retrieve only relevant memory instead of dumping every topic into the system prompt.

## Scope

- Automatic memory candidate extraction after selected session or turn boundaries.
- Durable classification of candidates as `user`, `feedback`, `project`, or `reference`.
- A policy layer for auto-save, approval-required save, and disabled modes.
- Relevant memory retrieval before a new turn or session, using the memory index plus topic selection.
- Session persistence of memory decisions, saved entries, skipped candidates, and retrieved memory references.
- CLI/TUI surfaces for reviewing pending candidates and inspecting which memories were used.

Out of scope:

- Provider-specific memory behavior.
- Model-specific prompt hacks.
- Unbounded full-topic prompt injection.
- Silent storage of sensitive or temporary user data without an explicit policy.

## Prior Art Research Plan

Before implementation, verify current behavior from product documentation, not source code:

- Claude Code memory behavior: persistent project/user memory, `/memory`, scope rules, and startup loading.
- Cursor Memories behavior: sidecar/background extraction, user approval, and project-scoped memories.
- Codex `AGENTS.md`/project instruction behavior: static project context loading and limits.
- OpenAI guidance for memory or stored context where applicable, focusing on safety and user control.

The implementation recommendation should choose the most broadly supported pattern from those products and document tradeoffs before code changes.

## Research Notes

- Claude Code documents persistent memory through project/user memory files and a `/memory` management surface.
- Cursor documents memories as contextual project/user facts with user control over what is retained.
- Codex documents static project instruction loading through `AGENTS.md`; durable learned memory is a separate concern and should not be faked through hardcoded system prompt instructions.
- Recommended baseline: SDK-owned capture/retrieval with `approval_required` as the default, explicit review commands, bounded retrieval, and session-log provenance.

## Architecture Recommendation

Add an SDK-owned memory pipeline above the existing `ProjectMemoryStore`:

- `MemoryCandidateExtractor`: analyzes completed turns or session summaries and emits structured candidate records.
- `MemoryPolicyEvaluator`: decides whether a candidate is saved automatically, queued for approval, skipped, or rejected.
- `MemoryRetrievalService`: selects relevant memory topics from `.robota/memory/MEMORY.md` and `topics/*.md` for the next prompt context.
- `MemoryAuditLog`: persists candidate, decision, save, skip, and retrieval events into `.robota` session data for resume/debugging.
- CLI/TUI review commands remain thin adapters over SDK APIs.

The SDK owns memory capture/retrieval logic because context loading, session persistence, system prompt composition, and model-invocable commands already live there. The CLI owns only interaction surfaces.

## Implementation Plan

- [x] Update package SPEC files to distinguish project memory foundation from automatic memory behavior.
- [x] Add memory candidate and decision contracts in the SDK.
- [x] Add a pure policy evaluator with modes: `disabled`, `approval_required`, and `auto_save`.
- [x] Add an extraction seam so providers or future summarizers can produce candidates without hardcoding model behavior.
- [x] Add pending-memory storage and review APIs.
- [x] Add relevant-memory retrieval before prompt composition with caps and provenance metadata.
- [x] Add `/memory pending`, `/memory approve`, `/memory reject`, and `/memory used` command behavior.
- [x] Add TUI notices for pending memory candidates without blocking normal chat.
- [x] Persist all memory capture/retrieval events in session logs.
- [x] Add headless-safe behavior where memory capture can run without interactive approval only when policy allows it.

## Progress

### 2026-05-02

- Added SDK automatic memory contracts, regex extractor seam, policy evaluator, pending store, retrieval service, and controller.
- Wired `InteractiveSession` to retrieve bounded memory before prompt execution, capture candidates after turns, and persist memory events/references into session records.
- Extended `/memory` with pending/approve/reject/used review commands.
- Added unit and integration tests for extraction, policy, storage, retrieval, command review, and session-log provenance.
- Updated package SPEC files for SDK, CLI, and sessions responsibilities.

## Result

Implemented SDK-owned automatic memory capture/retrieval with approval-required default policy, review commands, bounded topic retrieval, duplicate-safe memory storage, and session-log provenance. Added unit and integration coverage for extraction, policy, storage, retrieval, command review, session persistence, and prompt retrieval injection.

## Test Plan

The tests must prove the behavior at the memory pipeline boundaries: extraction, policy decision, storage, retrieval, prompt injection, command review, and session-log provenance. Unit tests should cover pure SDK decisions first; integration tests should verify CLI/headless flows without relying on a real model.

### Unit Tests

- Given a completed turn with durable project facts, when candidate extraction runs, then structured candidates are emitted with type, topic, text, source message ids, and confidence.
- Given temporary or sensitive content, when policy evaluation runs, then the candidate is skipped or queued according to policy instead of silently saved.
- Given `disabled` policy, when candidates are extracted, then no pending or saved memory entries are created.
- Given `approval_required` policy, when candidates are extracted, then they are stored as pending and not injected into future prompts until approved.
- Given `auto_save` policy, when a high-confidence project candidate is extracted, then it updates the memory index and topic file deterministically.
- Given duplicate or near-duplicate candidates, when saving runs, then the memory store avoids repeated entries.
- Given a user asks a topic-related question, when retrieval runs, then only matching memory topics are selected and their provenance is recorded.
- Given no relevant topics exist, when retrieval runs, then no topic details are injected.
- Given a session is resumed, when memory audit data is loaded, then pending candidates and used-memory references remain inspectable.
- Given `/memory used`, when the current turn used retrieved memory, then the command returns topic names and paths without exposing unrelated topics.

### Integration Tests

- CLI interactive flow: complete a turn that produces a memory candidate, approve it, restart the CLI, and verify the approved memory is available.
- Headless flow: run with approval-required policy and verify candidates are queued rather than saved silently.
- Session log flow: verify candidate extraction, approval, save, and retrieval events are persisted in `.robota` session data.

## Acceptance Criteria

- Automatic memory capture exists as a separate SDK pipeline, not as ad hoc CLI behavior.
- Users can inspect, approve, reject, and audit automatic memory decisions.
- Relevant memory retrieval injects only selected memory with caps and provenance.
- `.robota/memory` remains the storage SSOT created by `CLI-BL-010`.
- Session logs contain enough information to debug why a memory was saved or retrieved.
- The current `/memory list|show|add` commands continue to work.
