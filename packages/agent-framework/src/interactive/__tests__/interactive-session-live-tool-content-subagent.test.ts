/**
 * A subagent reports its tool calls through the parent's tool callback, and may share the parent's
 * tool instances. Its calls must never be captured as the owner turn's tool content, even when its
 * scripted call IDs collide with the parent's. Driven with the real in-process runner, real
 * sessions and a tool instance shared by parent and child.
 */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { createInProcessSubagentRunner } from '../../subagents/in-process-subagent-runner.js';
import { InteractiveSession } from '../interactive-session.js';

import type { IAgentDefinition } from '../../agents/agent-definition-types.js';
import type { IResolvedConfig } from '../../config/config-types.js';
import type {
  IParameterValidationResult,
  IToolResult,
  IToolSchema,
  IToolWithEventService,
  TToolParameters,
} from '@robota-sdk/agent-core';
import type { ISubagentJobStart } from '@robota-sdk/agent-executor';
import type {
  ILivePromptContentBatch,
  ILivePromptTraceBatch,
} from '@robota-sdk/agent-interface-analytics';

const TIMEOUT = 20_000;
const WORKER: IAgentDefinition = { name: 'worker', description: 'Worker', systemPrompt: 'Work' };

let workspace: string | undefined;
afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

describe('live tool content and subagents', () => {
  it('captures the parent call and never the call its subagent made through the shared tool', async () => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'robota-live-tool-subagent-')));
    const cwd = workspace;
    const contents: ILivePromptContentBatch[] = [];
    const traces: ILivePromptTraceBatch[] = [];
    let spawnChild: (() => Promise<string>) | undefined;

    const schema: IToolSchema = {
      name: 'Probe',
      description: 'Echoes its note; with spawn, runs a subagent that calls this same tool.',
      parameters: {
        type: 'object',
        properties: { note: { type: 'string' }, spawn: { type: 'boolean' } },
      },
    };
    const shared: IToolWithEventService = {
      schema,
      getName: () => schema.name,
      getDescription: () => schema.description,
      validate: () => true,
      validateParameters: (): IParameterValidationResult => ({ isValid: true, errors: [] }),
      setEventService: () => {},
      execute: async (parameters: TToolParameters): Promise<IToolResult> => {
        const note = String(parameters['note']);
        if (parameters['spawn'] === true) {
          const childOutput = await spawnChild!();
          return { success: true, data: `parent saw ${note} after ${childOutput.length} chars` };
        }
        return { success: true, data: `echo ${note}` };
      },
    };

    const parent = createScriptedProvider([
      { toolCalls: [{ name: 'Probe', args: { note: 'parent-note', spawn: true } }] },
      { text: 'parent done' },
    ]);
    const session = new InteractiveSession({
      cwd,
      provider: parent.provider,
      bare: true,
      permissionMode: 'bypassPermissions',
      additionalTools: [shared],
      livePromptTrace: {
        enqueue: (batch) => void traces.push(batch),
        content: {
          policy: {
            userPrompts: false, assistantResponses: false, toolArguments: true, toolOutput: true, maxBytes: 2048,
          },
          enqueue: (batch) => void contents.push(batch),
        },
      },
    });
    const execCtrl = (session as unknown as {
      execCtrl: { handleToolExecution(event: Parameters<NonNullable<Parameters<typeof createInProcessSubagentRunner>[0]['onToolExecution']>>[0]): void };
    }).execCtrl;

    spawnChild = async () => {
      // The child's scripted provider mints the same call IDs as the parent's.
      const child = createScriptedProvider([
        { toolCalls: [{ name: 'Probe', args: { note: 'child-only-note' } }] },
        { text: 'child done' },
      ]);
      const runner = createInProcessSubagentRunner({
        config: {
          defaultTrustLevel: 'full',
          provider: { name: 'scripted', model: 'scripted-model', apiKey: undefined },
          permissions: { allow: [], deny: [] },
          env: {},
        } as IResolvedConfig,
        context: { agentsMd: '', projectNotesMd: '' },
        tools: [shared],
        terminal: { write: () => {}, writeLine: () => {}, writeMarkdown: () => {}, writeError: () => {}, prompt: async () => '', select: async () => 0, spinner: () => ({ stop: () => {}, update: () => {} }) },
        provider: child.provider,
        permissionMode: 'bypassPermissions',
        customAgentRegistry: (name) => (name === 'worker' ? WORKER : undefined),
        // Exactly what the product wires: the child's tool callback is the parent's.
        onToolExecution: (event) => execCtrl.handleToolExecution(event),
      });
      const job = {
        taskId: 'task_1',
        request: {
          agentType: 'worker', prompt: 'probe', parentSessionId: 'parent', depth: 1, cwd,
          permissionPolicy: 'inherit-allowlist', mode: 'background',
        },
      } as unknown as ISubagentJobStart;
      const handle = await runner.start(job);
      return (await handle.result).output;
    };

    const handle = await session.submit('probe please');
    await handle.completed;

    expect(contents).toHaveLength(1);
    const items = contents[0]!.items;
    expect(items.map((item) => [item.kind, item.tool?.name, item.tool?.outcome])).toEqual([
      ['tool-arguments', 'Probe', 'success'],
      ['tool-output', 'Probe', 'success'],
    ]);
    expect(items[0]!.text).toContain('parent-note');
    expect(items[1]!.text).toBe('parent saw parent-note after 10 chars');
    expect(JSON.stringify(contents)).not.toContain('child-only-note');
    // The parent call's span is the tool-body span the trace exported for it.
    const bodySpan = traces[0]!.children.find((child) => child.kind === 'tool');
    expect(bodySpan?.kind === 'tool' ? bodySpan.trace.spanId : undefined).toBe(items[0]!.tool!.spanId);
    await session.shutdown?.();
  }, TIMEOUT);
});
