---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-plugin': patch
---

DQ-AUDIT-006 — error/observability hygiene: replace raw `throw new Error()` on core-service and provider hot paths with typed `RobotaError` subclasses (`ConfigurationError`/`ValidationError`) so error-handling can branch on category/recoverable; surface fire-and-forget hook failures via `logger.warn` instead of silent `.catch(() => {})`; wire the error-handling plugin's `totalRetries`/`successfulRecoveries` stats to real counters.
