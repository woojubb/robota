import { describe, it, expect, vi, beforeEach } from 'vitest';

// Prevent real filesystem I/O: saveInstantNodeToDisk writes to .dag/nodes/ and
// loadPersistedInstantNodes reads from it — both run during tests and cause
// cross-test state contamination when node files from one test are loaded into
// a later test's in-memory registry.
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  appendFile: vi.fn().mockResolvedValue(undefined),
}));

// Mock MCP SDK transport to prevent blocking the test process.
vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  const mockServer = {
    setRequestHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  };
  return { Server: vi.fn(() => mockServer) };
});

// Mock node:fs/promises to prevent loadPersistedInstantNodes from reading real disk files
// (instant-node JSON files written by prior test runs must not pollute context state).
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock LocalDagRunner to avoid actual execution.
vi.mock('../local-runner/index.js', async () => {
  const actual = await vi.importActual<typeof import('../local-runner/index.js')>(
    '../local-runner/index.js',
  );
  return {
    ...actual,
    LocalDagRunner: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        dagRun: { dagRunId: 'run-test', status: 'success' },
        taskRuns: [
          {
            nodeId: 'output',
            status: 'success',
            outputSnapshot: JSON.stringify({ text: 'hello' }),
          },
        ],
      }),
    })),
  };
});

import { createLocalMcpServer, mcpCommand } from '../commands/mcp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const MINIMAL_DAG = {
  dagId: 'test',
  version: 1,
  status: 'draft',
  nodes: [
    { nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} },
    { nodeId: 'llm', nodeType: 'llm-text-anthropic', dependsOn: ['in'], config: {} },
    { nodeId: 'out', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
  ],
  edges: [],
};

describe('createLocalMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a Server instance', () => {
    createLocalMcpServer({ skipConnect: true });
    expect(Server).toHaveBeenCalledTimes(1);
  });

  it('registers request handlers', () => {
    createLocalMcpServer({ skipConnect: true });
    const serverInstance = vi.mocked(Server).mock.results[0]?.value as {
      setRequestHandler: ReturnType<typeof vi.fn>;
    };
    expect(serverInstance.setRequestHandler).toHaveBeenCalledTimes(2);
  });
});

describe('mcpCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 1 for unknown transport', async () => {
    const code = await mcpCommand(['--transport', 'websocket']);
    expect(code).toBe(1);
  });

  it('returns 0 with skipConnect option', async () => {
    const code = await mcpCommand(['--transport', 'stdio'], { skipConnect: true });
    expect(code).toBe(0);
  });

  it('schema subcommand prints all tool definitions as JSON', async () => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    const code = await mcpCommand(['schema']);
    process.stdout.write = original;
    expect(code).toBe(0);
    const parsed = JSON.parse(written.join('')) as unknown[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('schema --tool returns single tool definition', async () => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    const code = await mcpCommand(['schema', '--tool', 'dag_nodes_list']);
    process.stdout.write = original;
    expect(code).toBe(0);
    const parsed = JSON.parse(written.join('')) as { name: string };
    expect(parsed.name).toBe('dag_nodes_list');
  });

  it('--inspect --format markdown outputs Markdown tool table', async () => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    const code = await mcpCommand(['--inspect', '--format', 'markdown']);
    process.stdout.write = original;
    expect(code).toBe(0);
    const output = written.join('');
    expect(output).toContain('# robota-dag MCP Server');
    expect(output).toContain('| Tool |');
    expect(output).toContain('dag_run_definition');
  });

  it('--inspect --format awesome-mcp outputs awesome-mcp submission Markdown', async () => {
    const written: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    const code = await mcpCommand(['--inspect', '--format', 'awesome-mcp']);
    process.stdout.write = original;
    expect(code).toBe(0);
    const output = written.join('');
    expect(output).toContain('## robota-dag');
    expect(output).toContain('npx @robota-sdk/dag-cli mcp');
    expect(output).toContain('**Tools:**');
  });

  it('--format with invalid value returns error', async () => {
    const code = await mcpCommand(['--inspect', '--format', 'html']);
    expect(code).toBe(2);
  });
});

describe('MCP tool: dag_nodes_list', () => {
  it('returns node list JSON', async () => {
    createLocalMcpServer({ skipConnect: true });
    const serverInstance = vi.mocked(Server).mock.results[0]?.value as {
      setRequestHandler: ReturnType<typeof vi.fn>;
    };
    // ListToolsRequestSchema handler is the first call
    const listHandler = serverInstance.setRequestHandler.mock.calls[0]?.[1] as () => Promise<{
      tools: unknown[];
    }>;
    const result = await listHandler();
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools.length).toBeGreaterThan(0);
  });
});

describe('MCP tool: dag_instant_node_create + dag_instant_node_list', () => {
  type TCallHandler = (req: {
    params: { name: string; arguments: unknown };
  }) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

  function getCallHandler(): TCallHandler {
    const serverInstance = vi.mocked(Server).mock.results[0]?.value as {
      setRequestHandler: ReturnType<typeof vi.fn>;
    };
    return serverInstance.setRequestHandler.mock.calls[1]?.[1] as TCallHandler;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    createLocalMcpServer({ skipConnect: true });
  });

  it('dag_instant_node_create returns ok with manifest', async () => {
    const handler = getCallHandler();
    const result = await handler({
      params: {
        name: 'dag_instant_node_create',
        arguments: {
          nodeType: 'my-translator',
          displayName: 'My Translator',
          systemPromptTemplate: 'Translate to French: {{text}}',
          inputPorts: [{ key: 'text' }],
          outputPort: { key: 'text' },
          provider: 'anthropic',
        },
      },
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      ok: boolean;
      nodeType: string;
      manifest: { nodeType: string; category: string };
      instantNodeCount: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.nodeType).toBe('my-translator');
    expect(parsed.manifest?.nodeType).toBe('my-translator');
    expect(parsed.manifest?.category).toBe('Instant');
    expect(parsed.instantNodeCount).toBe(1);
  });

  it('dag_instant_node_create sets correct default ports for auto-wiring', async () => {
    const handler = getCallHandler();
    const result = await handler({
      params: {
        name: 'dag_instant_node_create',
        arguments: {
          nodeType: 'test-node',
          displayName: 'Test Node',
          systemPromptTemplate: 'Process: {{input}}',
          inputPorts: [{ key: 'input' }],
          outputPort: { key: 'output' },
        },
      },
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      ok: boolean;
      manifest: { defaultInputPort: string; defaultOutputPort: string };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.manifest?.defaultInputPort).toBe('input');
    expect(parsed.manifest?.defaultOutputPort).toBe('output');
  });

  it('dag_instant_node_create rejects duplicate nodeType', async () => {
    const handler = getCallHandler();
    const spec = {
      nodeType: 'dup-node',
      displayName: 'Dup',
      systemPromptTemplate: 'Do: {{text}}',
      inputPorts: [{ key: 'text' }],
      outputPort: { key: 'text' },
    };
    await handler({ params: { name: 'dag_instant_node_create', arguments: spec } });
    const second = await handler({ params: { name: 'dag_instant_node_create', arguments: spec } });
    expect(second.isError).toBe(true);
  });

  it('dag_instant_node_create errors when nodeType missing', async () => {
    const handler = getCallHandler();
    const result = await handler({
      params: {
        name: 'dag_instant_node_create',
        arguments: {
          displayName: 'No Type',
          systemPromptTemplate: 'x',
          inputPorts: [{ key: 'text' }],
          outputPort: { key: 'text' },
        },
      },
    });
    expect(result.isError).toBe(true);
  });

  it('dag_instant_node_list returns empty list initially', async () => {
    const handler = getCallHandler();
    const result = await handler({
      params: { name: 'dag_instant_node_list', arguments: {} },
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      instantNodes: unknown[];
    };
    expect(Array.isArray(parsed.instantNodes)).toBe(true);
    expect(parsed.instantNodes).toHaveLength(0);
  });

  it('dag_instant_node_list reflects registered nodes', async () => {
    const handler = getCallHandler();
    await handler({
      params: {
        name: 'dag_instant_node_create',
        arguments: {
          nodeType: 'listed-node',
          displayName: 'Listed Node',
          systemPromptTemplate: 'Do: {{text}}',
          inputPorts: [{ key: 'text' }],
          outputPort: { key: 'result' },
        },
      },
    });
    const result = await handler({
      params: { name: 'dag_instant_node_list', arguments: {} },
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      instantNodes: Array<{ nodeType: string }>;
    };
    expect(parsed.instantNodes).toHaveLength(1);
    expect(parsed.instantNodes[0]?.nodeType).toBe('listed-node');
  });

  it('dag_build recognizes a registered instant node type', async () => {
    const handler = getCallHandler();
    await handler({
      params: {
        name: 'dag_instant_node_create',
        arguments: {
          nodeType: 'inline-llm',
          displayName: 'Inline LLM',
          systemPromptTemplate: 'Answer: {{text}}',
          inputPorts: [{ key: 'text' }],
          outputPort: { key: 'text' },
          provider: 'anthropic',
        },
      },
    });

    const buildResult = await handler({
      params: {
        name: 'dag_build',
        arguments: {
          dagId: 'instant-test',
          pipeline: [
            { nodeType: 'input', id: 'in' },
            { nodeType: 'inline-llm', id: 'proc' },
            { nodeType: 'text-output', id: 'out' },
          ],
        },
      },
    });
    const parsed = JSON.parse(buildResult.content[0]?.text ?? '{}') as {
      ok: boolean;
      valid: boolean;
      nodeCount: number;
      edgeCount: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.valid).toBe(true);
    expect(parsed.nodeCount).toBe(3);
    expect(parsed.edgeCount).toBe(2);
  });
});

describe('MCP tool: dag_validate', () => {
  it('reports valid for well-formed 3-node DAG', async () => {
    createLocalMcpServer({ skipConnect: true });
    const serverInstance = vi.mocked(Server).mock.results[0]?.value as {
      setRequestHandler: ReturnType<typeof vi.fn>;
    };
    const callHandler = serverInstance.setRequestHandler.mock.calls[1]?.[1] as (req: {
      params: { name: string; arguments: unknown };
    }) => Promise<{ content: Array<{ text: string }> }>;

    const result = await callHandler({
      params: { name: 'dag_validate', arguments: { definition: MINIMAL_DAG } },
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { valid: boolean };
    expect(parsed.valid).toBe(true);
  });

  it('reports invalid for unknown node type', async () => {
    createLocalMcpServer({ skipConnect: true });
    const serverInstance = vi.mocked(Server).mock.results[0]?.value as {
      setRequestHandler: ReturnType<typeof vi.fn>;
    };
    const callHandler = serverInstance.setRequestHandler.mock.calls[1]?.[1] as (req: {
      params: { name: string; arguments: unknown };
    }) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

    const badDag = {
      ...MINIMAL_DAG,
      nodes: [{ nodeId: 'bad', nodeType: 'does-not-exist', dependsOn: [], config: {} }],
    };
    const result = await callHandler({
      params: { name: 'dag_validate', arguments: { definition: badDag } },
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { valid: boolean };
    expect(parsed.valid).toBe(false);
  });

  it('UNKNOWN_NODE_TYPE error has structured fix with options', async () => {
    createLocalMcpServer({ skipConnect: true });
    const serverInstance = vi.mocked(Server).mock.results[0]?.value as {
      setRequestHandler: ReturnType<typeof vi.fn>;
    };
    const callHandler = serverInstance.setRequestHandler.mock.calls[1]?.[1] as (req: {
      params: { name: string; arguments: unknown };
    }) => Promise<{ content: Array<{ text: string }> }>;

    const badDag = {
      ...MINIMAL_DAG,
      nodes: [
        { nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} },
        { nodeId: 'bad', nodeType: 'llm-gpt5', dependsOn: ['in'], config: {} },
        { nodeId: 'out', nodeType: 'text-output', dependsOn: ['bad'], config: {} },
      ],
    };
    const result = await callHandler({
      params: { name: 'dag_validate', arguments: { definition: badDag } },
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      valid: boolean;
      errors: Array<{ code: string; fix?: { action: string; options?: string[] } }>;
    };
    expect(parsed.valid).toBe(false);
    const unknownErr = parsed.errors.find((e) => e.code === 'UNKNOWN_NODE_TYPE');
    expect(unknownErr).toBeDefined();
    expect(unknownErr?.fix?.action).toBe('replace_node_type');
    expect(Array.isArray(unknownErr?.fix?.options)).toBe(true);
    expect((unknownErr?.fix?.options?.length ?? 0) > 0).toBe(true);
  });

  it('MISSING_INPUT_NODE error has structured fix', async () => {
    createLocalMcpServer({ skipConnect: true });
    const serverInstance = vi.mocked(Server).mock.results[0]?.value as {
      setRequestHandler: ReturnType<typeof vi.fn>;
    };
    const callHandler = serverInstance.setRequestHandler.mock.calls[1]?.[1] as (req: {
      params: { name: string; arguments: unknown };
    }) => Promise<{ content: Array<{ text: string }> }>;

    const noInputDag = {
      ...MINIMAL_DAG,
      nodes: [{ nodeId: 'out', nodeType: 'text-output', dependsOn: [], config: {} }],
    };
    const result = await callHandler({
      params: { name: 'dag_validate', arguments: { definition: noInputDag } },
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      valid: boolean;
      errors: Array<{ code: string; fix?: { action: string; suggestion?: string } }>;
    };
    expect(parsed.valid).toBe(false);
    const err = parsed.errors.find((e) => e.code === 'MISSING_INPUT_NODE');
    expect(err).toBeDefined();
    expect(err?.fix?.action).toBe('add_node');
  });

  it('UNCONNECTED_REQUIRED_PORT reported when edges are explicit but port is disconnected', async () => {
    createLocalMcpServer({ skipConnect: true });
    const serverInstance = vi.mocked(Server).mock.results[0]?.value as {
      setRequestHandler: ReturnType<typeof vi.fn>;
    };
    const callHandler = serverInstance.setRequestHandler.mock.calls[1]?.[1] as (req: {
      params: { name: string; arguments: unknown };
    }) => Promise<{ content: Array<{ text: string }> }>;

    // DAG with explicit but incomplete edge (in → out wired, llm text port missing)
    const disconnectedDag = {
      dagId: 'test-disconnected',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'in', nodeType: 'input', dependsOn: [], config: {} },
        { nodeId: 'llm', nodeType: 'llm-text-anthropic', dependsOn: ['in'], config: {} },
        { nodeId: 'out', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
      ],
      edges: [
        // Wire llm → out but NOT in → llm (llm.text input is disconnected)
        { from: 'llm', to: 'out', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      ],
    };
    const result = await callHandler({
      params: { name: 'dag_validate', arguments: { definition: disconnectedDag } },
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}') as {
      valid: boolean;
      errors: Array<{ code: string; fix?: { action: string } }>;
    };
    expect(parsed.valid).toBe(false);
    const portErr = parsed.errors.find((e) => e.code === 'UNCONNECTED_REQUIRED_PORT');
    expect(portErr).toBeDefined();
    expect(portErr?.fix?.action).toBe('connect_port');
  });
});
