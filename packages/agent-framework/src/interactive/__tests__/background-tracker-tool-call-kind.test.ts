/**
 * MCP-004 §S3 (TC-12's third clause) — the tracker and `/tasks` already render any `IBackgroundTaskState`
 * generically (`task.kind`, `task.commandPreview`), and S1's helpers (`agent-executor`) project the
 * tool-call handoff's provenance into exactly those fields. This proves the render, not a new code
 * path: no production change was needed in either file this test exercises.
 */

import {
  BackgroundTaskManager,
  createToolInvocationBackgroundTaskRunner,
} from '@robota-sdk/agent-executor';
import { describe, expect, it } from 'vitest';

import { formatCommandBackgroundTask } from '../../command-api/background/background-command-api.js';
import { SessionBackgroundTaskTracker } from '../interactive-session-background-tracker.js';

import type { IToolResult } from '@robota-sdk/agent-core';
import type { IToolInvocationBackgroundTaskRequest } from '@robota-sdk/agent-interface-execution';

function createSpawnedToolInvocationTask() {
  const runner = createToolInvocationBackgroundTaskRunner();
  const manager = new BackgroundTaskManager({ runners: [runner] });
  const token = 'adoption-token-1';
  const settled: Promise<IToolResult> = new Promise(() => {}); // never settles — task stays `running`
  runner.adopt(token, { settled, abort: () => {} });

  const request: IToolInvocationBackgroundTaskRequest = {
    kind: 'tool-invocation',
    label: 'SlowTool',
    mode: 'background',
    parentSessionId: 'session-tracker',
    depth: 0,
    cwd: '/workspace',
    maxRuntimeMs: 60_000,
    toolName: 'SlowTool',
    adoptionToken: token,
    provenanceOwner: 'mcp',
    serverId: 'server-1',
    sourceName: 'slow_tool',
    securityIdentity: 'identity-1',
    permissionMode: 'default',
  };
  return { manager, request };
}

describe('MCP-004 TC-12: a tool-invocation task renders through the existing generic views', () => {
  it('formatCommandBackgroundTask (background-command-api.ts) renders the kind, tool name and server', async () => {
    const { manager, request } = createSpawnedToolInvocationTask();
    const state = await manager.spawn(request);

    const line = formatCommandBackgroundTask(state);

    expect(line).toContain('tool-invocation:SlowTool');
    expect(line).toContain('SlowTool (server-1)');
  });

  it('SessionBackgroundTaskTracker.readTaskDetail (interactive-session-background-tracker.ts) surfaces the tool preview', async () => {
    const { manager, request } = createSpawnedToolInvocationTask();
    const state = await manager.spawn(request);

    const tracker = new SessionBackgroundTaskTracker(
      () => manager,
      () => {},
      () => {},
      () => {},
      () => {},
    );

    const page = await tracker.readTaskDetail('entry-1', state.id);

    expect(page.records.map((record) => record.text)).toContain('SlowTool (server-1)');
  });
});
