import { describe, it, expect } from 'vitest';
import type { INodeExecutionContext, INodeConfigObject } from '@robota-sdk/dag-core';
import { McpToolNodeDefinition, McpToolNodeConfigSchema } from '../index.js';

function makeContext(config: Record<string, unknown>): INodeExecutionContext {
  const node = new McpToolNodeDefinition();
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId: 'mcp-1',
      nodeType: 'mcp-tool',
      dependsOn: [],
      config: config as INodeConfigObject,
      inputs: [],
      outputs: [],
    },
    nodeManifest: {
      nodeType: 'mcp-tool',
      displayName: 'MCP Tool',
      category: 'Integration',
      inputs: node.inputs,
      outputs: node.outputs,
      defaultInputPort: node.defaultInputPort,
      defaultOutputPort: node.defaultOutputPort,
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  };
}

describe('McpToolNodeDefinition', () => {
  it('has correct nodeType and displayName', () => {
    const node = new McpToolNodeDefinition();
    expect(node.nodeType).toBe('mcp-tool');
    expect(node.displayName).toBe('MCP Tool');
    expect(node.category).toBe('Integration');
  });

  it('has correct port definitions', () => {
    const node = new McpToolNodeDefinition();
    expect(node.inputs.find((p) => p.key === 'args')).toBeDefined();
    expect(node.outputs.find((p) => p.key === 'text')).toBeDefined();
    expect(node.outputs.find((p) => p.key === 'isError')).toBeDefined();
    expect(node.defaultInputPort).toBe('args');
    expect(node.defaultOutputPort).toBe('text');
  });
});

describe('McpToolNodeConfigSchema', () => {
  it('accepts minimal http config', () => {
    const result = McpToolNodeConfigSchema.safeParse({
      serverUrl: 'https://mcp.example.com/api',
      toolName: 'search',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.serverType).toBe('http');
    expect(result.data.timeoutMs).toBe(30000);
    expect(result.data.baseCredits).toBe(0);
    expect(result.data.serverArgs).toEqual([]);
    expect(result.data.serverEnvRefs).toEqual([]);
  });

  it('accepts stdio config with envRefs', () => {
    const result = McpToolNodeConfigSchema.safeParse({
      serverType: 'stdio',
      serverCommand: 'npx @modelcontextprotocol/server-fetch',
      toolName: 'fetch',
      serverEnvRefs: ['HOME', 'PATH'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty toolName', () => {
    const result = McpToolNodeConfigSchema.safeParse({
      serverUrl: 'https://mcp.example.com',
      toolName: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive timeoutMs', () => {
    const result = McpToolNodeConfigSchema.safeParse({
      serverUrl: 'https://mcp.example.com',
      toolName: 'search',
      timeoutMs: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('SSRF prevention', () => {
  const node = new McpToolNodeDefinition();

  async function execute(config: Record<string, unknown>) {
    const ctx = makeContext(config);
    return node.taskHandler.execute({ args: '{}' }, ctx);
  }

  it('blocks localhost', async () => {
    const result = await execute({
      serverType: 'http',
      serverUrl: 'http://localhost:8080',
      toolName: 'test',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_MCP_TOOL_SSRF_BLOCKED');
    expect(result.error.fix?.action).toBe('set_config');
  });

  it('blocks 127.0.0.1', async () => {
    const result = await execute({
      serverType: 'http',
      serverUrl: 'http://127.0.0.1:3000',
      toolName: 'test',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_MCP_TOOL_SSRF_BLOCKED');
  });

  it('blocks 192.168.x.x', async () => {
    const result = await execute({
      serverType: 'http',
      serverUrl: 'http://192.168.1.100',
      toolName: 'test',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_MCP_TOOL_SSRF_BLOCKED');
  });

  it('blocks 169.254.x.x (AWS IMDS)', async () => {
    const result = await execute({
      serverType: 'http',
      serverUrl: 'http://169.254.169.254/metadata',
      toolName: 'imds',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_MCP_TOOL_SSRF_BLOCKED');
  });

  it('rejects missing serverUrl for http', async () => {
    const result = await execute({ serverType: 'http', toolName: 'test' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_MCP_TOOL_MISSING_URL');
    expect(result.error.fix?.action).toBe('set_config');
  });

  it('rejects disallowed stdio executable', async () => {
    const result = await execute({
      serverType: 'stdio',
      serverCommand: 'bash -c evil',
      toolName: 'run',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_MCP_TOOL_STDIO_NOT_ALLOWED');
    expect(result.error.fix?.action).toBe('set_config');
    expect(Array.isArray(result.error.fix?.options)).toBe(true);
  });

  it('rejects missing serverCommand for stdio', async () => {
    const result = await execute({ serverType: 'stdio', toolName: 'test' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DAG_VALIDATION_MCP_TOOL_MISSING_COMMAND');
  });
});
