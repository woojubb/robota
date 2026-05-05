# agent-playground Monolith Decomposition

- **Status**: in-progress
- **Created**: 2026-03-27
- **Branch**: refactor/agent-playground-agent-container-block
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
- [x] Add characterization tests for `websocket-client`.
- [x] Split `websocket-client.ts` into a stable directory module.
- [x] Add characterization tests for `use-websocket-connection`.
- [x] Split `use-websocket-connection.ts` into a stable directory module.
- [x] Add characterization tests for `use-chat-input`.
- [x] Split `use-chat-input.ts` into a stable directory module.
- [x] Add characterization tests for `robota-executor`.
- [x] Split `robota-executor.ts` into a stable directory module.
- [x] Add characterization tests for `individual-plugin-block`.
- [x] Split `individual-plugin-block.tsx` into a stable directory module.
- [x] Add characterization tests for `chat-interface`.
- [x] Split `chat-interface.tsx` into a stable directory module.
- [x] Add characterization tests for `execution-tree-visualizer`.
- [x] Split `execution-tree-visualizer.tsx` into a stable directory module.
- [x] Add characterization tests for `usage-monitor`.
- [x] Split `usage-monitor.tsx` into a stable directory module.
- [x] Add characterization tests for `agent-container-block`.
- [x] Split `agent-container-block.tsx` into a stable directory module.
- [x] Update package SPEC and central architecture map for the new module boundaries.
- [ ] Continue with the remaining >300 line files in follow-up decomposition slices.

## Current >300 Line Files

### hooks

- `hooks/use-robota-execution.ts` (396 lines)

### components/playground

- `agent-configuration-block.tsx` (467 lines)
- `project-browser.tsx` (422 lines)
- `execution-tree-debug.tsx` (421 lines)
- `error-panel.tsx` (403 lines)
- `tool-container-block.tsx` (383 lines)
- `block-visualization/block-visualization-panel.tsx` (362 lines)
- `block-visualization/block-tree.tsx` (336 lines)

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
- Completed the eighth low-risk slice: `websocket-client.ts` is now a same-name directory module
  with connection state in the client class plus internal constants, message guards, message
  builders, auth response parsing, and event type modules.
- Added characterization coverage for connection URL/status events, timestamped outbound messages,
  broadcast identity, authentication, and update routing.
- Updated package SPEC and the central architecture map for the WebSocket client module.
- Completed the ninth slice: `use-websocket-connection.ts` is now a same-name directory module with
  public hook/type exports plus internal state calculation, uptime tracking, constants, and handler
  registry modules.
- Added characterization coverage for connect/auth, disconnect statistics, send availability,
  missing URL errors, health reporting, disconnected ping rejection, and handler unregistration.
- Updated package SPEC and the central architecture map for the WebSocket connection hook module.
- Completed the tenth slice: `use-chat-input.ts` is now a same-name directory module with public
  hook/type exports plus internal input-state calculation, explicit validation, focus wiring, and
  constants modules.
- Added characterization coverage for input state calculation, typing timeout, input controls,
  explicit validation, send/stream behavior, error restoration, retry, and placeholder chat-history
  behavior.
- Updated package SPEC and the central architecture map for the chat input hook module.
- Completed the eleventh slice: `robota-executor.ts` is now a same-name directory module with the
  `PlaygroundExecutor` facade kept under 300 lines and agent session, remote provider construction,
  tool normalization, plugin factory, result shaping, and statistics recording split into internal
  helpers.
- Added characterization coverage for provider/remote executor wiring, normalized tool creation,
  execution success and failure results, agent tool configuration updates, missing remote executor
  credentials, and disposal behavior.
- Updated package SPEC and the central architecture map for the executor module without adding new
  architecture document fragments.
- Completed the twelfth slice: `individual-plugin-block.tsx` is now a same-name directory module
  with the public component facade plus header, option input, options tab, stats tab, info tab,
  constants, and local prop types split into internal helpers.
- Added characterization coverage for collapsed summary rendering, enabled toggling, option value
  updates, stats tab success-rate display, and info tab metadata.
- Updated package SPEC and the central architecture map for the component module without adding
  new architecture document fragments.
- Completed the thirteenth slice: `chat-interface.tsx` is now a same-name directory module with
  the public component facade plus header, messages area, message card, input area, copy feedback,
  send controller, message factories, and simulated response helper split into internal files.
- Added characterization coverage for disabled empty state, ready-agent send/loading/response
  flow, Enter submission, error retry restoration, and clearing.
- Updated package SPEC and the central architecture map for the component module without adding
  new architecture document fragments.
- Completed the fourteenth slice: `execution-tree-visualizer.tsx` is now a same-name directory
  module with pure tree/stat calculations, header, content, node view, empty state, constants, and
  local types split from the component facade.
- Added characterization coverage for empty state, status/duration statistics, sorted hierarchy
  rendering, filtering, block selection, and expand-state updates.
- Updated package SPEC and the central architecture map for the component module without adding
  new architecture document fragments.
- Completed the fifteenth slice: `usage-monitor.tsx` is now a same-name directory module with a
  public component facade plus state hook, mock snapshot builder, usage color helper, header,
  metric, rate-limit, and feature display sections.
- Added characterization coverage for hidden rendering, mock usage and rate-limit display, feature
  availability, and close action behavior.
- Updated package SPEC and the central architecture map for the component module without adding
  new architecture document fragments.
- Completed the sixteenth slice: `agent-container-block.tsx` is now a same-name directory module
  with a public component facade plus resolved props, local state hook, team role catalog, shell,
  header rows, details, capabilities, system-message, and action sections.
- Added characterization coverage for collapsed summary rendering, expanded details, editing,
  leader/configure/remove callbacks, and drag callback forwarding.
- Updated package SPEC and the central architecture map for the component module without adding
  new architecture document fragments.

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
- Apply the same stable-import directory module pattern to WebSocket client internals.
- Apply the same stable-import directory module pattern to WebSocket connection hook internals.
- Apply the same stable-import directory module pattern to chat input hook internals.
- Apply the same stable-import directory module pattern to executor internals while keeping
  `PlaygroundExecutor` as the stateful browser execution facade.
- Apply the same stable-import directory module pattern to large playground component internals,
  preserving Radix `asChild` trigger props/ref when extracting trigger children.
- Split large component state controllers separately from presentational children when that avoids
  introducing new lint warnings.
- Extract pure calculations before component presentation when a visualizer mixes hierarchy
  building, statistics, and recursive rendering.
- Keep mock data providers internal to component modules when they exist only to preserve current
  playground UI behavior.
- Preserve Radix `asChild` injected props when extracting trigger children; custom trigger
  components must pass received div props through to the concrete DOM/UI primitive.
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

This task remains open because 9 production source files still exceed the guideline. The current
branch delivers the sixteenth tested decomposition slice and extends the repeatable pattern for
follow-up files.
