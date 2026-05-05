# agent-playground Monolith Decomposition

- **Status**: in-progress
- **Created**: 2026-03-27
- **Branch**: refactor/agent-playground-demo-data
- **Scope**: packages/agent-playground
- **Priority**: low

## Objective

Reduce `agent-playground` source files that exceed the repository file-size guideline without
changing runtime behavior. Decompose one responsibility at a time under characterization tests.

## Plan

- [x] Add characterization tests for `code-editor-templates`.
- [x] Split `code-editor-templates.ts` into a stable directory module.
- [x] Add characterization tests for `template-gallery-data`.
- [x] Split `template-gallery-data.ts` into a stable directory module.
- [x] Add characterization tests for `demo-execution-data`.
- [x] Split `demo-execution-data.ts` into a stable directory module.
- [x] Update package SPEC and central architecture map for the new module boundaries.
- [ ] Continue with the remaining >300 line files in follow-up decomposition slices.

## Current >300 Line Files

### hooks

- `hooks/use-websocket-connection.ts` (471 lines)
- `hooks/use-chat-input.ts` (460 lines)
- `hooks/use-robota-execution.ts` (396 lines)

### components/playground

- `agent-configuration-block.tsx` (467 lines)
- `project-browser.tsx` (422 lines)
- `execution-tree-debug.tsx` (421 lines)
- `error-panel.tsx` (403 lines)
- `tool-container-block.tsx` (383 lines)
- `block-visualization/block-visualization-panel.tsx` (362 lines)
- `block-visualization/block-tree.tsx` (336 lines)
- `agent-container-block.tsx` (327 lines)
- `usage-monitor.tsx` (323 lines)
- `execution-tree-visualizer.tsx` (321 lines)
- `individual-plugin-block.tsx` (318 lines)
- `chat-interface.tsx` (307 lines)
- `components/ui/accessibility.tsx` (303 lines)

### lib/playground

- `websocket-client.ts` (445 lines)
- `robota-executor.ts` (447 lines)
- `execution-subscriber.ts` (443 lines)
- `project-manager.ts` (387 lines)
- `block-tracking/block-hooks.ts` (324 lines)
- `code-analyzer.ts` (320 lines)

### contexts

- `contexts/playground-context.tsx` (390 lines)

## Progress

### 2026-05-05

- Completed the first safe P1 slice: static component catalog decomposition.
- Removed `code-editor-templates.ts` and `template-gallery-data.ts` from the >300 line set while
  preserving the existing import paths through directory `index.ts` modules.
- Added characterization tests before each extraction.
- Updated `packages/agent-playground/docs/SPEC.md` and `.agents/specs/ARCHITECTURE-MAP.md`.
- Completed the second low-risk slice: `demo-execution-data.ts` now delegates through a same-name
  directory module with `index.ts`, `offsets.ts`, and `scenario.ts`.
- Added characterization coverage for demo block order, hierarchy, timeline offsets, and the
  complex-demo wrapper behavior.
- Updated package SPEC and the central architecture map for the demo data module.

## Decisions

- Start with static data modules because they have no UI state, network, or browser side effects.
- Preserve consumer imports (`./code-editor-templates`, `./template-gallery-data`) by replacing
  files with same-name directory modules.
- Apply the same stable-import directory module pattern to demo execution data.
- Keep architecture documentation centralized in `.agents/specs/ARCHITECTURE-MAP.md`; package
  SPEC only records package-local contract details.

## Test Plan

- Run targeted characterization tests after each data-module extraction.
- Run the full `@robota-sdk/agent-playground` Vitest suite after all slice changes.
- Run `typecheck`, `lint`, and `build` for `@robota-sdk/agent-playground`.
- Run documentation and harness scans because this slice updates package SPEC, the central
  architecture map, and the task record.

## Blockers

- None for this slice.

## Result

This task remains open because 23 source files still exceed the guideline. The current branch
delivers the second tested decomposition slice and extends the repeatable pattern for follow-up
files.
