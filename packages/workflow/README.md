# @robota-sdk/workflow

Event-driven workflow visualization system for Robota SDK - real-time workflow building and graph management.

## Overview

The Workflow package provides domain-neutral workflow visualization capabilities for the Robota SDK ecosystem. It converts real-time events from agents, teams, and tools into visual workflow graphs with nodes and edges.

## Features

- **Real-time Workflow Building**: Converts events to visual workflow components instantly
- **Domain-neutral Architecture**: Extensible handler system for different event names
- **Type-safe Design**: Full TypeScript support with strict type checking
- **Plugin System**: Extensible architecture for custom workflow components
- **Graph Management**: Automatic node/edge creation with validation and ordering

## Recent Updates
- **Unified Workflow Event Bridge**: Single SSOT bridge for workflow event handling.
- **Scenario Record/Play**: Deterministic record/playback support with strict validation.
- **Guarded Verification**: Guarded workflow edge verification utilities.
- **Event Linkage Fixes**: Deterministic linking for local tool playback and agent ownership resolution.
- **Subscriber Contract**: Workflow subscriber contract standardized with `IWorkflowEventSubscriber`.

## Installation

```bash
npm install @robota-sdk/workflow
# or
pnpm add @robota-sdk/workflow
# or
yarn add @robota-sdk/workflow
```

## Quick Start

```typescript
import { WorkflowEventSubscriber } from '@robota-sdk/workflow';

const subscriber = new WorkflowEventSubscriber();

// Subscribe to workflow updates
subscriber.subscribeToWorkflowEvents((update) => {
  console.log('Workflow updated:', update);
});

// Get current workflow data
const { nodes, edges } = subscriber.getWorkflowData();
```

## Documentation

- [Docs Index](./docs/README.md) - Package documentation entrypoint
- [Specification](./docs/SPEC.md) - Package rules and scope
- [Architecture](./docs/ARCHITECTURE.md) - Architectural design
- [Development Guide](./docs/DEVELOPMENT.md) - Contribution and maintenance guide

## License

MIT
