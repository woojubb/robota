---
title: 'HARNESS-015: Orphan-export baseline burn-down — triage 153 frozen findings'
status: done
created: 2026-06-11
priority: medium
urgency: later
area: packages/*, scripts/harness
depends_on: []
---

# HARNESS-015: Orphan-export baseline burn-down

## Problem

The HARNESS-001 orphan-export scan launched with a ratchet baseline
(`scripts/harness/orphan-export-baseline.json`, 153 entries, 2026-06-11): pre-existing orphaned
runtime exports across agent-core, agent-framework, agent-command, agent-playground and others
are frozen so only NEW orphans fail. Each frozen entry is either dead code (delete) or a
legitimately external-facing symbol (move to the reasoned allowlist / re-export through the
package surface).

## Proposed Work

Per package (separate small PRs recommended): for each baseline entry, decide delete vs
allowlist-with-reason vs wire-to-surface; delete entries from the baseline as they are resolved;
the scan enforces that the baseline only shrinks (manual discipline — entries must never be
added back without a new incident record). Done when the baseline file is empty and removed.

## Test Plan

- Each deletion PR: owning package build/typecheck/tests green.
- `pnpm harness:scan:orphan-exports` green after every batch.

## User Execution Test Scenarios

Not applicable — internal dead-code cleanup; verification is package test suites + the scan.

## Completion (2026-06-13)

All 153 baseline entries triaged and resolved in one machine-verified sweep
(per-entry usage analysis mirroring the scan corpus, then per-disposition application):

- **DELETE-FILE × 29** — files imported by nothing in the workspace (28 from the baseline
  set + skeleton.tsx orphaned by the sweep), removed outright (largest group:
  agent-playground unshipped UI primitives and dead hooks/libs).
- **REMOVE-EXPORT × ~69** — symbols used only inside their own file; `export` keyword
  removed (incl. buttonVariants from button.tsx's export list).
- **DELETE × 16** — declarations referenced nowhere, removed with their doc comments.
- **ALLOWLIST × 2** — framework-convention exports with reasons in
  `ORPHAN_EXPORT_ALLOWLIST`: `collections` (Astro content.config.ts), `generateMetadata`
  (Next.js app router).
- `orphan-export-baseline.json` **deleted**; the scan's baseline-loading branch removed —
  the orphan scan now enforces unconditionally.
- SPEC structure-tree/API rows referencing deleted files removed (agent-cli shell-exec,
  agent-transport usePermissionQueue, agent-cli subagent-setup); one CLIR-H02 evidence
  reference annotated `evidence-superseded`.
- Verification: monorepo `pnpm typecheck` 0 errors, `pnpm build` clean, all package test
  suites green (framework 915, transport 473, playground 165, cli 146, …);
  `pnpm harness:scan` — all 23 scans passed (orphan-exports green WITHOUT a baseline).
- User Execution Test Scenarios: N/A per this backlog (internal dead-code cleanup).

### Triage table (TC-01)

| File                                                                                                             | Symbol                                  | Disposition                                                                 |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| `apps/agent-server/src/app.ts`                                                                                   | `playgroundWebSocketServer`             | REMOVE-EXPORT (used only within its own file)                               |
| `apps/agent-server/src/server.ts`                                                                                | `startServer`                           | REMOVE-EXPORT (used only within its own file)                               |
| `apps/agent-web/src/config/api.ts`                                                                               | `API_CONFIG`                            | DELETE-FILE (file unimported anywhere)                                      |
| `apps/agent-web/src/lib/cache.ts`                                                                                | `apiCache`                              | REMOVE-EXPORT (used only within its own file)                               |
| `apps/agent-web/src/lib/cache.ts`                                                                                | `cacheKeys`                             | DELETE (declaration referenced nowhere)                                     |
| `apps/agent-web/src/lib/cache.ts`                                                                                | `userCache`                             | REMOVE-EXPORT (used only within its own file)                               |
| `apps/blog/src/content.config.ts`                                                                                | `collections`                           | ALLOWLIST (framework convention export — reason in ORPHAN_EXPORT_ALLOWLIST) |
| `apps/blog/src/i18n/utils.ts`                                                                                    | `getLangFromUrl`                        | DELETE (declaration referenced nowhere)                                     |
| `apps/blog/src/i18n/utils.ts`                                                                                    | `getLocalePath`                         | DELETE (declaration referenced nowhere)                                     |
| `apps/blog/src/i18n/utils.ts`                                                                                    | `getSwitchLangPath`                     | DELETE (declaration referenced nowhere)                                     |
| `apps/docs/src/app/[locale]/[[...slug]]/page.tsx`                                                                | `generateMetadata`                      | ALLOWLIST (framework convention export — reason in ORPHAN_EXPORT_ALLOWLIST) |
| `apps/www/src/components/CostCalculator.tsx`                                                                     | `CostCalculator`                        | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-cli/src/constants.ts`                                                                            | `AGENT_CLI_NAME`                        | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-cli/src/modes/shell-exec.ts`                                                                     | `SHELL_EXEC_TIMEOUT_MS`                 | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-cli/src/modes/shell-exec.ts`                                                                     | `createShellExec`                       | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-cli/src/startup/subagent-setup.ts`                                                               | `createSubagentSetup`                   | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-command/src/agent/agent-command-parser.ts`                                                       | `DEFAULT_AGENT_TYPE`                    | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-command/src/provider/provider-command-profile-operations.ts`                                     | `createProviderEditInteraction`         | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-command/src/provider/provider-command-setup.ts`                                                  | `completeProviderSetup`                 | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-command/src/provider/provider-command-setup.ts`                                                  | `toProviderSetupPromptDescription`      | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-core/src/abstracts/module-helpers.ts`                                                            | `emitModuleEvent`                       | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-core/src/core/robota-initializer.ts`                                                             | `performAsyncInitialization`            | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-core/src/managers/agent-factory-helpers.ts`                                                      | `MAX_CONCURRENT_AGENTS`                 | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-core/src/managers/module-registry.ts`                                                            | `MODULE_REGISTRY_EVENTS`                | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-core/src/plugins/event-emitter-helpers.ts`                                                       | `computeListenerStats`                  | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-core/src/schemas/agent-template-schema.ts`                                                       | `AgentTemplateMetadataSchema`           | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-core/src/schemas/agent-template-schema.ts`                                                       | `AgentTemplateSchema`                   | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-core/src/schemas/agent-template-schema.ts`                                                       | `safeValidateAgentTemplate`             | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-core/src/schemas/agent-template-schema.ts`                                                       | `validateAgentTemplate`                 | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-core/src/services/execution-pipeline.ts`                                                         | `DEFAULT_MAX_EXECUTION_ROUNDS`          | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-core/src/services/execution-pipeline.ts`                                                         | `UNLIMITED_EXECUTION_ROUNDS`            | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-core/src/services/execution-pipeline.ts`                                                         | `forceSummaryCall`                      | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-core/src/services/execution-service-helpers.ts`                                                  | `convertExecutionContextToPluginFormat` | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-executor/src/background-tasks/background-task-manager-helpers.ts`                                | `isBackgroundTaskTimeoutReason`         | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-executor/src/background-tasks/background-task-manager-state.ts`                                  | `attachBackgroundTaskHandleMetadata`    | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-framework/src/commands/skill-activation-events.ts`                                               | `getSkillActivationMode`                | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-framework/src/commands/skill-activation-events.ts`                                               | `getSkillActivationSource`              | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-framework/src/interactive/interactive-session-agent-jobs.ts`                                     | `getAgentToolDepsOrThrow`               | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-framework/src/interactive/interactive-session-agent-jobs.ts`                                     | `getSubagentManagerOrThrow`             | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-framework/src/interactive/interactive-session-execution.ts`                                      | `extractToolSummaries`                  | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-framework/src/interactive/interactive-session-fork.ts`                                           | `resolveForkAgentDefinition`            | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-framework/src/interactive/interactive-session-streaming.ts`                                      | `MAX_COMPLETED_TOOLS`                   | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-framework/src/interactive/interactive-session-streaming.ts`                                      | `TOOL_ARG_DISPLAY_MAX`                  | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-framework/src/interactive/interactive-session-streaming.ts`                                      | `trimCompletedTools`                    | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-framework/src/interactive/interactive-session-workspace.ts`                                      | `getWorkspaceEntry`                     | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-framework/src/interactive/interactive-session-workspace.ts`                                      | `listWorkspaceEntries`                  | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-framework/src/memory/automatic-memory-controller.ts`                                             | `createMemoryRetrievedEvent`            | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-playground/src/components/playground/agent-configuration-block/use-agent-configuration-state.ts` | `validateAgentConfiguration`            | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/playground/chat-input-panel.tsx`                                       | `ChatInputPanel`                        | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/playground/code-editor.tsx`                                            | `CodeEditor`                            | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/playground/connection-status-panel.tsx`                                | `ConnectionStatusPanel`                 | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/playground/error-panel/error-panel-utils.ts`                           | `buildIssueLocation`                    | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/playground/execution-output.tsx`                                       | `ExecutionOutput`                       | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/playground/shortcuts-help.tsx`                                         | `ShortcutsHelp`                         | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/playground/template-gallery.tsx`                                       | `TemplateGallery`                       | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/playground/usage-monitor/usage-color.ts`                               | `getUsagePercentage`                    | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/alert-dialog.tsx`                                                   | `AlertDialog`                           | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert-dialog.tsx`                                                   | `AlertDialogAction`                     | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert-dialog.tsx`                                                   | `AlertDialogCancel`                     | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert-dialog.tsx`                                                   | `AlertDialogContent`                    | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert-dialog.tsx`                                                   | `AlertDialogDescription`                | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert-dialog.tsx`                                                   | `AlertDialogFooter`                     | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert-dialog.tsx`                                                   | `AlertDialogHeader`                     | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert-dialog.tsx`                                                   | `AlertDialogOverlay`                    | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert-dialog.tsx`                                                   | `AlertDialogPortal`                     | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert-dialog.tsx`                                                   | `AlertDialogTitle`                      | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert-dialog.tsx`                                                   | `AlertDialogTrigger`                    | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert.tsx`                                                          | `AlertDescription`                      | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/alert.tsx`                                                          | `AlertTitle`                            | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/avatar.tsx`                                                         | `AvatarImage`                           | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/badge.tsx`                                                          | `badgeVariants`                         | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/card.tsx`                                                           | `CardAction`                            | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/card.tsx`                                                           | `CardFooter`                            | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dialog.tsx`                                                         | `DialogClose`                           | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dialog.tsx`                                                         | `DialogDescription`                     | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dialog.tsx`                                                         | `DialogOverlay`                         | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dialog.tsx`                                                         | `DialogPortal`                          | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dropdown-menu.tsx`                                                  | `DropdownMenuCheckboxItem`              | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dropdown-menu.tsx`                                                  | `DropdownMenuGroup`                     | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dropdown-menu.tsx`                                                  | `DropdownMenuLabel`                     | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dropdown-menu.tsx`                                                  | `DropdownMenuPortal`                    | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dropdown-menu.tsx`                                                  | `DropdownMenuRadioGroup`                | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dropdown-menu.tsx`                                                  | `DropdownMenuRadioItem`                 | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dropdown-menu.tsx`                                                  | `DropdownMenuShortcut`                  | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dropdown-menu.tsx`                                                  | `DropdownMenuSub`                       | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dropdown-menu.tsx`                                                  | `DropdownMenuSubContent`                | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/dropdown-menu.tsx`                                                  | `DropdownMenuSubTrigger`                | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/icons.tsx`                                                          | `Icons`                                 | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/lazy-load.tsx`                                                      | `LazyCard`                              | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/lazy-load.tsx`                                                      | `LazyLoad`                              | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/lazy-load.tsx`                                                      | `LazyLoadPlaceholder`                   | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/lazy-load.tsx`                                                      | `LazySection`                           | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/lazy-load.tsx`                                                      | `useLazyLoad`                           | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/loading.tsx`                                                        | `CardSkeleton`                          | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/loading.tsx`                                                        | `PageLoading`                           | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/loading.tsx`                                                        | `TextSkeleton`                          | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/navigation-menu.tsx`                                                | `NavigationMenu`                        | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/navigation-menu.tsx`                                                | `NavigationMenuContent`                 | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/navigation-menu.tsx`                                                | `NavigationMenuIndicator`               | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/navigation-menu.tsx`                                                | `NavigationMenuItem`                    | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/navigation-menu.tsx`                                                | `NavigationMenuLink`                    | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/navigation-menu.tsx`                                                | `NavigationMenuList`                    | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/navigation-menu.tsx`                                                | `NavigationMenuTrigger`                 | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/navigation-menu.tsx`                                                | `NavigationMenuViewport`                | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/navigation-menu.tsx`                                                | `navigationMenuTriggerStyle`            | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/scroll-area.tsx`                                                    | `ScrollBar`                             | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/select.tsx`                                                         | `SelectGroup`                           | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/select.tsx`                                                         | `SelectLabel`                           | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/select.tsx`                                                         | `SelectScrollDownButton`                | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/select.tsx`                                                         | `SelectScrollUpButton`                  | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/select.tsx`                                                         | `SelectSeparator`                       | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/components/ui/sheet.tsx`                                                          | `Sheet`                                 | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/sheet.tsx`                                                          | `SheetClose`                            | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/sheet.tsx`                                                          | `SheetContent`                          | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/sheet.tsx`                                                          | `SheetDescription`                      | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/sheet.tsx`                                                          | `SheetFooter`                           | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/sheet.tsx`                                                          | `SheetHeader`                           | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/sheet.tsx`                                                          | `SheetTitle`                            | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/components/ui/sheet.tsx`                                                          | `SheetTrigger`                          | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/hooks/use-api-error.ts`                                                           | `useApiError`                           | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/hooks/use-block-tracking.ts`                                                      | `useBlockTracking`                      | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/hooks/use-block-tracking.ts`                                                      | `useTrackedTools`                       | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-playground/src/hooks/use-keyboard-shortcuts.ts`                                                  | `createShortcuts`                       | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/hooks/use-keyboard-shortcuts.ts`                                                  | `useKeyboardShortcuts`                  | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/hooks/use-playground-data.ts`                                                     | `usePlaygroundData`                     | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/hooks/use-playground-statistics.ts`                                               | `usePlaygroundStatistics`               | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/lib/code-generator/tool-import-registry.ts`                                       | `getToolImportEntry`                    | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/lib/playground/catalog-client.ts`                                                 | `fetchProviderCatalog`                  | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/lib/playground/catalog-client.ts`                                                 | `fetchToolCatalog`                      | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/lib/playground/project-manager/storage.ts`                                        | `parseProjectEntries`                   | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/lib/playground/robota-executor/agent-session.ts`                                  | `PlaygroundAgentSession`                | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-playground/src/lib/playground/robota-executor/executor-results.ts`                               | `toExecutionError`                      | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/lib/playground/robota-executor/remote-providers.ts`                               | `buildRemoteExecutorUrl`                | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/lib/playground/robota-executor/remote-providers.ts`                               | `createProvidersWithExecutor`           | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-playground/src/lib/playground/robota-executor/remote-providers.ts`                               | `createRemoteExecutor`                  | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/lib/playground/robota-executor/tool-normalization.ts`                             | `buildFunctionTool`                     | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/lib/playground/websocket-client/message-guards.ts`                                | `isPlaygroundWebSocketMessage`          | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/lib/utils.ts`                                                                     | `formatNumber`                          | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-playground/src/lib/utils.ts`                                                                     | `formatPercentage`                      | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-playground/src/playground/hooks/usePlayground.ts`                                                | `usePlaygroundBoot`                     | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-playground/src/types/playground-statistics.ts`                                                   | `PLAYGROUND_STATISTICS_EVENTS`          | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/types/playground-statistics.ts`                                                   | `PLAYGROUND_STATISTICS_EVENT_PREFIX`    | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-playground/src/types/playground-statistics.ts`                                                   | `defaultPlaygroundStatisticsOptions`    | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-playground/src/types/playground-statistics.ts`                                                   | `defaultPlaygroundStats`                | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-provider-anthropic/src/anthropic/message-converter.ts`                                           | `convertFromAnthropicResponse`          | DELETE (declaration referenced nowhere)                                     |
| `packages/agent-provider-openai-compatible/src/gemma/pseudo-command-envelope.ts`                                 | `parseGemmaPseudoCommandEnvelope`       | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-remote-client/src/client/chat-http-methods.ts`                                                   | `validateToolCallArray`                 | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-transport/src/headless/headless-stream-json.ts`                                                  | `writeStreamJsonEvent`                  | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-transport/src/tui/InkTerminal.ts`                                                                | `createInkTerminal`                     | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-transport/src/tui/flows/permission-prompt-flow.ts`                                               | `getPermissionDecision`                 | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-transport/src/tui/hooks/use-interactive-session-init.ts`                                         | `initializeSession`                     | DELETE-FILE (file unimported anywhere)                                      |
| `packages/agent-transport/src/tui/hooks/useAutocomplete.ts`                                                      | `parseSlashInput`                       | REMOVE-EXPORT (used only within its own file)                               |
| `packages/agent-transport/src/tui/hooks/usePermissionQueue.ts`                                                   | `usePermissionQueue`                    | DELETE-FILE (file unimported anywhere)                                      |
