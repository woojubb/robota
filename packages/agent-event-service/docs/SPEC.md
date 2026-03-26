# agent-event-service Specification

## Scope

`@robota-sdk/agent-event-service` is a private, thin re-export layer that surfaces all event service types and implementations owned by `@robota-sdk/agent-core`. It exists so that consumers that previously depended on this package by name can continue to import from `@robota-sdk/agent-event-service` without requiring a migration to `@robota-sdk/agent-core` import paths.

This package owns no types, no implementations, and no business logic. Every symbol re-exported here is defined and maintained as SSOT in `@robota-sdk/agent-core`.

## Boundaries

- **Does not own** any type definitions. All interfaces, type aliases, and classes are defined in `@robota-sdk/agent-core`.
- **Does not own** any runtime logic. Implementations (`DefaultEventService`, `StructuredEventService`, `ObservableEventService`, `AbstractEventService`) live in `@robota-sdk/agent-core`.
- **Does not own** event name constants (`TASK_EVENTS`, `TASK_EVENT_PREFIX`, `USER_EVENTS`, `USER_EVENT_PREFIX`). These are defined in `@robota-sdk/agent-core`.
- **Not published** to npm (`"private": true`). It is a workspace-internal package only.
- Consumers should prefer importing from `@robota-sdk/agent-core` directly for new code. This package is maintained for existing dependency paths only.

## Architecture Overview

```
@robota-sdk/agent-event-service
└── src/index.ts   ← single file, 100% re-exports from @robota-sdk/agent-core
         │
         └──► @robota-sdk/agent-core   ← SSOT for all event types and implementations
```

The package contains exactly one source file (`src/index.ts`) with no logic. All `export type { ... }` and `export { ... }` statements forward symbols from `@robota-sdk/agent-core`. No transformations, wrappers, or additional logic are introduced.

## Type Ownership

This package owns **zero** SSOT types. All types below are defined in `@robota-sdk/agent-core` and re-exported here for compatibility.

| Type                        | SSOT Location            | Purpose                                                 |
| --------------------------- | ------------------------ | ------------------------------------------------------- |
| `IEventService`             | `@robota-sdk/agent-core` | Contract for event emission and subscription            |
| `IBaseEventData`            | `@robota-sdk/agent-core` | Base shape for all event payloads                       |
| `IAgentEventData`           | `@robota-sdk/agent-core` | Agent-scoped event payload shape                        |
| `IExecutionEventData`       | `@robota-sdk/agent-core` | Execution-scoped event payload shape                    |
| `IToolEventData`            | `@robota-sdk/agent-core` | Tool-scoped event payload shape                         |
| `IEventContext`             | `@robota-sdk/agent-core` | Context attached to each emitted event                  |
| `IEventServiceOwnerBinding` | `@robota-sdk/agent-core` | Binding contract between an owner and its event service |
| `IOwnerPathSegment`         | `@robota-sdk/agent-core` | Single segment of the owner path hierarchy              |
| `TEventListener`            | `@robota-sdk/agent-core` | Listener callback type for event subscriptions          |
| `TEventLoggerData`          | `@robota-sdk/agent-core` | Data shape passed to event loggers                      |
| `TEventUniversalValue`      | `@robota-sdk/agent-core` | Scalar value type used in event payloads                |
| `IEventObjectValue`         | `@robota-sdk/agent-core` | Object value type used in event payloads                |
| `TEventExtensionValue`      | `@robota-sdk/agent-core` | Extension value type for custom event fields            |
| `TUserEvent`                | `@robota-sdk/agent-core` | Union type of all user-defined event names              |

## Public API Surface

All exports are re-exports from `@robota-sdk/agent-core`. The table below lists every symbol currently exported by `src/index.ts`.

### Type Exports

| Export                      | Kind         | Description                            |
| --------------------------- | ------------ | -------------------------------------- |
| `IEventService`             | `interface`  | Primary contract for event services    |
| `IBaseEventData`            | `interface`  | Base event payload structure           |
| `IAgentEventData`           | `interface`  | Agent-level event payload              |
| `IExecutionEventData`       | `interface`  | Execution-level event payload          |
| `IToolEventData`            | `interface`  | Tool-level event payload               |
| `IEventContext`             | `interface`  | Event emission context                 |
| `IEventServiceOwnerBinding` | `interface`  | Owner–service binding contract         |
| `IOwnerPathSegment`         | `interface`  | Owner path hierarchy segment           |
| `TEventListener`            | `type alias` | Event listener callback signature      |
| `TEventLoggerData`          | `type alias` | Logger data shape                      |
| `TEventUniversalValue`      | `type alias` | Scalar value union for event fields    |
| `IEventObjectValue`         | `interface`  | Object value shape for event fields    |
| `TEventExtensionValue`      | `type alias` | Extension value union for event fields |
| `TUserEvent`                | `type alias` | User-defined event name union          |

### Value Exports

| Export                           | Kind             | Description                                           |
| -------------------------------- | ---------------- | ----------------------------------------------------- |
| `AbstractEventService`           | `abstract class` | Base class for all event service implementations      |
| `DefaultEventService`            | `class`          | Null-object implementation (no-op event service)      |
| `StructuredEventService`         | `class`          | Full implementation with structured event emission    |
| `ObservableEventService`         | `class`          | Observable-pattern event service implementation       |
| `DEFAULT_ABSTRACT_EVENT_SERVICE` | `const`          | Shared singleton of the default (no-op) service       |
| `isDefaultEventService`          | `function`       | Type guard to check if a service is the default no-op |
| `bindEventServiceOwner`          | `function`       | Binds an owner object to an event service             |
| `bindWithOwnerPath`              | `function`       | Binds a service with an explicit owner path           |
| `composeEventName`               | `function`       | Composes a namespaced event name string               |
| `TASK_EVENTS`                    | `const`          | Map of task event name constants                      |
| `TASK_EVENT_PREFIX`              | `const`          | Prefix string for all task event names                |
| `USER_EVENTS`                    | `const`          | Map of user event name constants                      |
| `USER_EVENT_PREFIX`              | `const`          | Prefix string for all user event names                |

## Extension Points

This package exposes no extension points of its own. Extension is performed through `@robota-sdk/agent-core`:

- Extend `AbstractEventService` (from `@robota-sdk/agent-core`) to implement a custom event service.
- Implement `IEventService` (from `@robota-sdk/agent-core`) directly for a fully custom implementation.

## Error Taxonomy

This package defines no error types. It contains no runtime logic and cannot throw package-specific errors. Any errors originate in `@robota-sdk/agent-core` implementations.

## Test Strategy

No tests are required or maintained in this package. The package contains a single file with pure re-exports and no logic to test.

The `vitest` devDependency and `test` script are present for workspace consistency. The script runs with `--passWithNoTests`.

Logic correctness is validated by tests in `@robota-sdk/agent-core`, which owns all implementations.

## Class Contract Registry

This package contains no classes, no `implements` clauses, and no `extends` clauses. All class definitions are in `@robota-sdk/agent-core`.

| Export re-exported       | Defined in               | Contract                                     |
| ------------------------ | ------------------------ | -------------------------------------------- |
| `AbstractEventService`   | `@robota-sdk/agent-core` | Implements `IEventService`                   |
| `DefaultEventService`    | `@robota-sdk/agent-core` | Extends `AbstractEventService` (null-object) |
| `StructuredEventService` | `@robota-sdk/agent-core` | Extends `AbstractEventService`               |
| `ObservableEventService` | `@robota-sdk/agent-core` | Extends `AbstractEventService`               |

## Dependencies

| Dependency               | Type                       | Purpose                                            |
| ------------------------ | -------------------------- | -------------------------------------------------- |
| `@robota-sdk/agent-core` | production (`workspace:*`) | SSOT for all re-exported types and implementations |

No other production dependencies. Build tooling (`tsup`, `typescript`, `vitest`, `rimraf`) are devDependencies only.

## Known Consumers

| Consumer           | Import pattern                                             |
| ------------------ | ---------------------------------------------------------- |
| `agent-playground` | Imports event types and services by name from this package |
| `agent-team`       | Imports event types and services by name from this package |
