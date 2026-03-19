# Fix agent-core Reverse Dependencies

## Status: in_progress

## Problem

agent-core (the foundation package) depends on 12 @robota-sdk/agent-\* packages:

- agent-event-service
- agent-plugin-\* (9 packages)
- agent-tool-mcp
- agent-tools

This violates the Foundation Package Dependency Rule and causes npm install to fail with 404 for unpublished upstream packages.

## Root Cause

agent-core bundles plugins and tools as built-in features. The Robota class auto-registers plugins from these packages. This was designed for a monorepo-only workflow where all packages are available locally, but breaks when publishing to npm independently.

## Required Changes

### agent-event-service

- Most critical — used throughout agent-core for event emission
- Options: absorb into agent-core, or make it a peer dependency

### agent-plugin-\* (9 packages)

- Auto-registered by Robota constructor
- Options: make plugins optional (peer deps), or absorb into agent-core, or use lazy loading with try/catch

### agent-tool-mcp

- MCP tool implementation
- Should be optional — remove from dependencies

### agent-tools

- Tool registry and FunctionTool infrastructure
- Already duplicated content between agent-core and agent-tools
- Options: absorb tool infra into agent-core, or make it a peer dependency

## Approach

1. Analyze which imports are actually used in agent-core source (not just listed in package.json)
2. For each: absorb, make peer dep, or remove
3. Build and test after each change
4. Verify npm install works with zero agent-\* dependencies

## Blocking

This blocks npm publishing. Must be resolved before v3.0.0-rc.1 can be installed.
