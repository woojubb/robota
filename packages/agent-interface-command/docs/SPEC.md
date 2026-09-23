# SPEC.md — @robota-sdk/agent-interface-command

## Package Identity

- **npm name**: `@robota-sdk/agent-interface-command`
- **Dependency position**: Layer 0. The package manifest declares only `@robota-sdk/agent-core`.
- **SDK**: (none — contract declarations only)
- **Platform**: node

## Scope

This package owns the **command contract family**: what a command is, what it returns, how it is
listed and invoked, the plugin surfaces a command host exposes, and the capability descriptors a
command declares about itself.

It contains type declarations only. No class, no runtime logic, no mechanism.

## Boundaries

| Concern                                                | Owner                                           |
| ------------------------------------------------------ | ----------------------------------------------- |
| Command _implementations_ and their modules            | `agent-command`, command-module owners          |
| Command infrastructure and reusable host APIs          | `agent-framework`                               |
| Rendering a command's result                           | `agent-ui-terminal`, `agent-ui-web`             |
| Session, interaction, event, turn and driver contracts | `agent-interface-transport` (until issue #2110) |
| Background task, workspace and subagent contracts      | `agent-interface-execution`                     |

**This package declares what a command IS; it decides nothing about what any command DOES.**

## Architecture Overview

**Layer 0.** It depends on no peer `agent-interface-*` package, and composition runs downward into it
— `agent-interface-session` names these types; this package never names a session type. That
direction is a BOUNDARY this package commits to, which the manifest does not carry.

Two modules, one dependency between them:

```text
command-contracts → capability-contracts
```

`capability-contracts` has **no consumer outside this package**. It is exported anyway: the owner
ruled on issue #2177 that it stays public. The measurement that surfaced it — zero external
consumers — established a question about the surface and did not answer it, and the answer was to
keep it.

## Type Ownership

| Type                                                                                             | Location                      | Purpose                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ICommand`, `ICommandSource`                                                                     | `src/command-contracts.ts`    | what a command is and where it came from; command effort metadata uses the core `TModelEffort` vocabulary                                                                                                            |
| `ICommandResult`, `TCommandResultDataValue`                                                      | `src/command-contracts.ts`    | what running one produces                                                                                                                                                                                            |
| `ICommandListEntry`, `TCommandInvocationSource`                                                  | `src/command-contracts.ts`    | listing and invocation provenance                                                                                                                                                                                    |
| `TCommandHostAction`, `TCommandUiIntent`                                                         | `src/command-contracts.ts`    | what a command asks of its host and of the UI                                                                                                                                                                        |
| `output-style-change` host-action variant                                                        | `src/command-contracts.ts`    | validated provider-neutral response-style selection request                                                                                                                                                          |
| `ICommandPluginAdapter` and the four plugin record types                                         | `src/command-contracts.ts`    | the plugin surface a command host exposes                                                                                                                                                                            |
| `ISkillExecutionPort`, `ISkillResolutionResult`                                                  | `src/command-contracts.ts`    | resolving a skill command to its prompt                                                                                                                                                                              |
| `IStatusLineCommandSettings`, `TStatusLineCommandSettingsPatch`                                  | `src/command-contracts.ts`    | the status-line command's settings shape                                                                                                                                                                             |
| `IAppearanceSettings`, `TAppearanceSettingsPatch`                                                | `src/command-contracts.ts`    | SCREEN-2002: the appearance a run renders with — theme id, syntax highlighting, reduced motion                                                                                                                       |
| `IThemeCataloguePort`, `IThemeCatalogueEntry`, `IThemeAppearanceState`, `TReducedMotionOverride` | `src/command-contracts.ts`    | SCREEN-2002: the surface's theme catalogue as the command layer asks it. Declared here, in the package both the command layer and the surface depend on, so neither has to re-declare a structurally-compatible copy |
| `ICapabilityDescriptor`, `TCapabilityKind`, `TCapabilitySafety`                                  | `src/capability-contracts.ts` | what a command declares about its own effects                                                                                                                                                                        |

`src/index.ts` is the single entry point; there is no subpath export. The `output-style-change`
variant carries only a style id; prompt instructions remain in the host-owned registry.

## Public API Surface

| Export                     | Kind | Description                                                                                                                                                         |
| -------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every name above           | type | contract declarations; see Type Ownership                                                                                                                           |
| `IAppearanceSettings`      | type | SCREEN-2002: the appearance a run renders with — theme id, syntax highlighting, reduced motion                                                                      |
| `TAppearanceSettingsPatch` | type | A sparse patch over `IAppearanceSettings`                                                                                                                           |
| `IThemeCataloguePort`      | type | The surface's theme catalogue, as the command layer asks it                                                                                                         |
| `IThemeCatalogueEntry`     | type | One catalogue row: id, name, appearance and source — never a colour                                                                                                 |
| `IThemeAppearanceState`    | type | The persisted appearance plus the pin on reduced motion, if any — the tier AND what it pinned, as one value, because the tier alone cannot say which way a run went |
| `TReducedMotionOverride`   | type | `flag` \| `environment` \| `screen-reader`                                                                                                                          |

**No runtime value is exported.** This package needs only type contracts, with no vocabulary or discriminators at runtime.

## Extension Points

None by design. A contract package is extended by amending a declaration. A host needing a narrower
command shape declares it in its own package and states how it relates to `ICommand`.

## Error Taxonomy

| Error | Code | Category | Recoverable |
| ----- | ---- | -------- | ----------- |
| —     | —    | —        | —           |

This package declares no error type and throws nothing. A failed command is reported through
`ICommandResult.success`, which is a result shape rather than an error, and what follows a failure is
the host's decision.

## Test Strategy

`src/__tests__/contracts.test.ts` asserts the exported contract shapes, including that
`ICapabilityDescriptor` is reachable from the entry — which is what makes the issue #2177 ruling a
checked property rather than an intention. `command-effect-grep-floor.test.ts` is a workspace-wide
floor: no production source may reference the deleted legacy command-effect contract.

Beyond that the package declares types and exports no behavior, so the remaining assertion available
is that it compiles, which `pnpm typecheck` makes on every run. Its contracts are exercised by
`agent-command`, `agent-command-workflows` and the transport surfaces that render command results.

**The command/session boundary test stays in `agent-interface-transport`.**
`command-action-split-contracts.test.ts` asserts that a command action and a session event remain
distinct, so it names types from both sides. Moving it here would make this package's test suite
depend on the transport package — an **upward** dependency for this Layer 0 package —
so it lives on the side that can see both and imports command types from here.

## Class Contract Registry

None. This package declares no class.
