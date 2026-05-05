# agent-playground Monolith Decomposition

- **Status**: in-progress
- **Created**: 2026-03-27
- **Branch**: refactor/agent-playground-execution-subscriber
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
- [x] Add characterization tests for `code-analyzer`.
- [x] Split `code-analyzer.ts` into a stable directory module.
- [x] Add characterization tests for `components/ui/accessibility`.
- [x] Split `components/ui/accessibility.tsx` into a stable directory module.
- [x] Add characterization tests for `project-manager`.
- [x] Split `project-manager.ts` into a stable directory module.
- [x] Add characterization tests for `block-tracking/block-hooks`.
- [x] Split `block-tracking/block-hooks.ts` into a stable directory module.
- [x] Add characterization tests for `execution-subscriber`.
- [x] Split `execution-subscriber.ts` into a stable directory module.
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

### lib/playground

- `websocket-client.ts` (445 lines)
- `robota-executor.ts` (447 lines)

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
- Completed the third low-risk slice: `code-analyzer.ts` now delegates through a same-name
  directory module with analyzer, environment validation, config parser, and shared local types.
- Added characterization coverage for analyzer diagnostics, environment warnings, and parsed agent
  metadata.
- Updated package SPEC and the central architecture map for the code analyzer module.
- Completed the fourth low-risk slice: `components/ui/accessibility.tsx` now delegates through a
  same-name directory module with separate primitives and keyboard/focus hooks.
- Added characterization coverage for skip links, screen-reader text, live regions, keyboard
  navigation, and announcer timing.
- Updated package SPEC and the central architecture map for the shared accessibility primitives.
- Completed the fifth low-risk slice: `project-manager.ts` is now a same-name directory module
  with a stateful facade plus storage, import validation, provider defaults, stats, id, and type
  helpers.
- Added characterization coverage for project creation, storage restoration, import validation,
  update/duplicate/search/export, templates, deletion, and stats.
- Updated package SPEC and the central architecture map for the project manager module.
- Completed the sixth low-risk slice: `block-tracking/block-hooks.ts` is now a same-name
  directory module with public hook factories plus internal handler, block message, error, and type
  modules.
- Added characterization coverage for tool start, completion, error, missing execution id, and
  delegation wrapper behavior.
- Updated package SPEC and the central architecture map for the block tracking hooks module.
- Completed the seventh low-risk slice: `execution-subscriber.ts` is now a same-name directory
  module with a stateful bridge plus internal SDK event guard, tool handler, execution handler,
  block id, step parser, and type modules.
- Added characterization coverage for SDK tool lifecycle, progress step parsing, execution
  hierarchy blocks, and dispose behavior.
- Updated package SPEC and the central architecture map for the execution subscriber module.

## Decisions

- Start with static data modules because they have no UI state, network, or browser side effects.
- Preserve consumer imports (`./code-editor-templates`, `./template-gallery-data`) by replacing
  files with same-name directory modules.
- Apply the same stable-import directory module pattern to demo execution data.
- Apply the same stable-import directory module pattern to code analyzer utilities.
- Apply the same stable-import directory module pattern to accessibility UI primitives.
- Apply the same stable-import directory module pattern to project manager internals.
- Apply the same stable-import directory module pattern to block tracking hook factories.
- Apply the same stable-import directory module pattern to execution subscriber internals.
- Keep architecture documentation centralized in `.agents/specs/ARCHITECTURE-MAP.md`; package
  SPEC only records package-local contract details.

## Test Plan

- Run targeted characterization tests after each decomposition extraction.
- Run the full `@robota-sdk/agent-playground` Vitest suite after all slice changes.
- Run `typecheck`, `lint`, and `build` for `@robota-sdk/agent-playground`.
- Run documentation and harness scans because this slice updates package SPEC, the central
  architecture map, and the task record.

## Blockers

- None for this slice.

## Result

This task remains open because 18 production source files still exceed the guideline. The current
branch delivers the seventh tested decomposition slice and extends the repeatable pattern for follow-up
files.
