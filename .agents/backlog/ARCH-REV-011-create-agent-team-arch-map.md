---
title: 'ARCH-REV-011: Create agent-team.md architecture-map subdocument (multi-agent orchestration)'
status: todo
created: 2026-05-18
priority: high
urgency: now
area: .agents/specs/architecture-map/agent-team.md, .agents/specs/ARCHITECTURE-MAP.md, .agents/specs/architecture-map/agent-system.md
depends_on: [ARCH-REV-002]
---

## Problem

`agent-team` has no architecture-map subdocument. `agent-system.md` has only 3 lines and one ownership table row about multi-agent orchestration. The coordination model, delegation flow, relay protocol, template registry, and owner-path propagation pattern are entirely undocumented at the architecture-map level.

This matters urgently: MULTI-001 (TUI multi-agent multiplexer, high priority) is an active backlog item. Without an architecture-map subdocument, that implementation will have no map checkpoint to validate against.

The CLI subsystem (6 subdocuments + router) is the reference quality bar for all subsystems. Multi-agent orchestration is equally important.

Source: Senior Planner (C-01).

## Recommendation

**Proceed without user approval** — this is content creation from existing sources (SPEC.md, source code, layering-audit.md) with no design decisions to make. The architecture already exists; documentation needs to catch up.

Create `.agents/specs/architecture-map/agent-team.md` covering:

- **Scope**: what agent-team owns and does not own
- **Layer position**: between assembly and domain, below agent-framework, above agent-core
- **Dependency rules**: must not import agent-framework, agent-session, agent-cli
- **Delegation model**: template-based task delegation
- **Relay tool protocol**: `createAssignTaskRelayTool`, how relay tools connect agents
- **Owner-path propagation**: how agent identity flows through IEventService
- **Composition entry points**: how agent-team is wired at the playground layer (sole consumer)
- **Distinction from agent-subagent-runner**: agent-team = same-process multi-agent; agent-subagent-runner = child-process isolation

Also:

- Update `agent-system.md` multi-agent section to link to the new document
- Update `ARCHITECTURE-MAP.md` reading order: add step for multi-agent changes

## Test Plan

- Read `packages/agent-team/src/` and `packages/agent-team/docs/SPEC.md` to verify the new document accuracy
- Verify `packages/agent-team/package.json` deps match documented boundary
- Links from `agent-system.md` and `ARCHITECTURE-MAP.md` resolve correctly
- `pnpm harness:scan` must pass

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
