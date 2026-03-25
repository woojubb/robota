# @robota-sdk/agent-event-service

> **Private package.** Not published to npm. Workspace-internal use only.

Thin re-export layer that surfaces event service types and implementations from `@robota-sdk/agent-core`. This package exists so that existing workspace consumers (`agent-playground`, `agent-team`) can continue importing from `@robota-sdk/agent-event-service` without migrating to `@robota-sdk/agent-core` import paths.

This package owns no types, no implementations, and no business logic. Every symbol re-exported here is defined and maintained as SSOT in `@robota-sdk/agent-core`.

## Usage

```typescript
import {
  DefaultEventService,
  StructuredEventService,
  IEventService,
} from '@robota-sdk/agent-event-service';
```

For new code, prefer importing directly from `@robota-sdk/agent-core`.

## Re-exported Symbols

All symbols below are defined in `@robota-sdk/agent-core`.

### Classes

| Export                           | Kind           | Description                                      |
| -------------------------------- | -------------- | ------------------------------------------------ |
| `AbstractEventService`           | abstract class | Base class for all event service implementations |
| `DefaultEventService`            | class          | Null-object (no-op) event service                |
| `StructuredEventService`         | class          | Full structured event emission                   |
| `ObservableEventService`         | class          | Observable-pattern event service                 |
| `DEFAULT_ABSTRACT_EVENT_SERVICE` | const          | Shared singleton of the default no-op service    |

### Functions

| Export                  | Description                                     |
| ----------------------- | ----------------------------------------------- |
| `isDefaultEventService` | Type guard — checks if a service is the default |
| `bindEventServiceOwner` | Binds an owner object to an event service       |
| `bindWithOwnerPath`     | Binds a service with an explicit owner path     |
| `composeEventName`      | Composes a namespaced event name string         |

### Constants

| Export              | Description                            |
| ------------------- | -------------------------------------- |
| `TASK_EVENTS`       | Map of task event name constants       |
| `TASK_EVENT_PREFIX` | Prefix string for all task event names |
| `USER_EVENTS`       | Map of user event name constants       |
| `USER_EVENT_PREFIX` | Prefix string for all user event names |

### Types

`IEventService`, `IBaseEventData`, `IAgentEventData`, `IExecutionEventData`, `IToolEventData`, `IEventContext`, `IEventServiceOwnerBinding`, `IOwnerPathSegment`, `TEventListener`, `TEventLoggerData`, `TEventUniversalValue`, `IEventObjectValue`, `TEventExtensionValue`, `TUserEvent`

## License

MIT
