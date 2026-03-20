# Fix agent-core Reverse Dependencies

## Status: in_progress

## Problem

agent-core (the foundation package) depends on 12 @robota-sdk/agent-\* packages. This is fundamentally wrong — agent-core is the pure engine, other packages depend on IT, never the reverse.

## Principle

- agent-core MUST have zero @robota-sdk/agent-\* dependencies
- Do NOT absorb other packages into core — that makes core bloated
- The correct fix: REMOVE dependencies, invert the direction
- Plugins, tools, event service register WITH core from the outside (injection)

## Current Wrong Dependencies (to remove)

```
@robota-sdk/agent-event-service
@robota-sdk/agent-plugin-conversation-history
@robota-sdk/agent-plugin-error-handling
@robota-sdk/agent-plugin-event-emitter
@robota-sdk/agent-plugin-execution-analytics
@robota-sdk/agent-plugin-limits
@robota-sdk/agent-plugin-logging
@robota-sdk/agent-plugin-performance
@robota-sdk/agent-plugin-usage
@robota-sdk/agent-plugin-webhook
@robota-sdk/agent-tool-mcp
@robota-sdk/agent-tools
```

## Approach

1. Analyze each import in agent-core/src/ — find what actually uses these packages
2. For each: remove the import, make the consumer (Session, SDK) inject it instead
3. Plugins: Robota should accept plugins via constructor config, not auto-import them
4. Event service: define the interface in core, implementation injected from outside
5. Tools: tool infra (FunctionTool, registry) stays in agent-tools, core only defines interfaces
6. Build and test after each removal
7. Final check: `grep "@robota-sdk" packages/agent-core/package.json` returns zero

## Blocking

This blocks npm publishing. Must be resolved before v3.0.0-rc.1 can be installed.
