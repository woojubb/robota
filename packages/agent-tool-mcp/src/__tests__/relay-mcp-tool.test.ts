import { describe, expect, it } from 'vitest';
import { ToolExecutionError } from '@robota-sdk/agent-core';

import { RelayMcpTool } from '../relay-mcp-tool.js';

import type { IToolSchema, IEventService, IOwnerPathSegment } from '@robota-sdk/agent-core';
import type { IToolExecutionContext, IToolResult, TToolParameters } from '@robota-sdk/agent-core';
import type { IRelayMcpContext } from '../relay-mcp-tool.js';

const SCHEMA: IToolSchema = {
  name: 'relay-echo',
  description: 'Relay tool used in unit tests',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
};

// The relay tool only forwards the EventService references to run(); it never calls methods
// on them, so opaque fakes are sufficient for these tests.
const fakeEventService = {} as unknown as IEventService;
const fakeBaseEventService = {} as unknown as IEventService;

function fullContext(ownerPath: IOwnerPathSegment[]): IToolExecutionContext {
  return {
    toolName: SCHEMA.name,
    parameters: {},
    eventService: fakeEventService,
    baseEventService: fakeBaseEventService,
    ownerPath,
  };
}

function okResult(): IToolResult {
  return { success: true, data: { success: true, content: 'ran' } };
}

describe('RelayMcpTool', () => {
  it('appends a single agent segment to the ownerPath and forwards parameters to run()', async () => {
    let captured: IRelayMcpContext | undefined;
    let receivedParams: TToolParameters | undefined;
    const tool = new RelayMcpTool({
      schema: SCHEMA,
      run: async (params, ctx) => {
        receivedParams = params;
        captured = ctx;
        return okResult();
      },
    });

    const result = await tool.execute(
      { text: 'hi' },
      fullContext([{ type: 'tool', id: 'tool-1' }]),
    );

    expect(result.success).toBe(true);
    expect(receivedParams).toEqual({ text: 'hi' });
    expect(captured?.ownerPath).toHaveLength(2);
    expect(captured?.ownerPath[0]).toEqual({ type: 'tool', id: 'tool-1' });
    expect(captured?.ownerPath[1]?.type).toBe('agent');
    expect(captured?.ownerPath[1]?.id).toBe(captured?.agentId);
    // The base segments are copied, not aliased, so mutating the result cannot leak back.
    expect(captured?.ownerPath[0]).not.toBe(undefined);
  });

  it('throws ToolExecutionError when the EventService is missing', async () => {
    const tool = new RelayMcpTool({ schema: SCHEMA, run: async () => okResult() });
    await expect(
      tool.execute({ text: 'x' }, { toolName: SCHEMA.name, parameters: {} }),
    ).rejects.toThrow(ToolExecutionError);
  });

  it('throws ToolExecutionError when baseEventService is missing', async () => {
    const tool = new RelayMcpTool({ schema: SCHEMA, run: async () => okResult() });
    await expect(
      tool.execute(
        { text: 'x' },
        { toolName: SCHEMA.name, parameters: {}, eventService: fakeEventService },
      ),
    ).rejects.toThrow(/baseEventService/);
  });

  it('throws ToolExecutionError when the ownerPath is empty or absent', async () => {
    const tool = new RelayMcpTool({ schema: SCHEMA, run: async () => okResult() });
    await expect(tool.execute({ text: 'x' }, fullContext([]))).rejects.toThrow(/ownerPath/);
  });

  it('validate() reports missing required parameters', () => {
    const tool = new RelayMcpTool({ schema: SCHEMA, run: async () => okResult() });
    expect(tool.validate({ text: 'present' })).toBe(true);
    expect(tool.validate({})).toBe(false);

    const detail = tool.validateParameters({});
    expect(detail.isValid).toBe(false);
    expect(detail.errors).toContain('Missing required parameter: text');
  });

  it('getDescription() returns the schema description', () => {
    const tool = new RelayMcpTool({ schema: SCHEMA, run: async () => okResult() });
    expect(tool.getDescription()).toBe(SCHEMA.description);
  });
});
