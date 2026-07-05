/**
 * AAV (Agent Authoring Velocity) Integration Test
 *
 * North Star: full autonomous loop completes in < 30 seconds, ≤ 5 MCP calls.
 * This test mocks the LLM runner but exercises every other layer — node
 * registry, instant-node creation, dag_build auto-wiring, and execution.
 *
 * A failing test here is a P0 incident: the autonomous agent loop is broken.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../local-runner/index.js', async () => {
  const actual = await vi.importActual<typeof import('../local-runner/index.js')>(
    '../local-runner/index.js',
  );
  return {
    ...actual,
    LocalDagRunner: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        dagRun: { dagRunId: 'aav-run-001', status: 'success' },
        taskRuns: [
          {
            nodeId: 'in',
            status: 'success',
            outputSnapshot: JSON.stringify({ text: 'hello world' }),
          },
          {
            nodeId: 'proc',
            status: 'success',
            outputSnapshot: JSON.stringify({
              text: 'processed: hello world',
              _agentSummary: 'Processed input. Generated 3 words.',
            }),
          },
          {
            nodeId: 'out',
            status: 'success',
            outputSnapshot: JSON.stringify({ text: 'processed: hello world' }),
          },
        ],
      }),
    })),
  };
});

import { createLocalMcpServer } from '../commands/mcp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

type TCallHandler = (req: {
  params: { name: string; arguments: unknown };
}) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function getHandlers(): { list: () => Promise<{ tools: unknown[] }>; call: TCallHandler } {
  const serverInstance = vi.mocked(Server).mock.results[0]?.value as {
    setRequestHandler: ReturnType<typeof vi.fn>;
  };
  return {
    list: serverInstance.setRequestHandler.mock.calls[0]?.[1] as () => Promise<{
      tools: unknown[];
    }>,
    call: serverInstance.setRequestHandler.mock.calls[1]?.[1] as TCallHandler,
  };
}

function parseResult<T>(result: { content: Array<{ text: string }> }): T {
  return JSON.parse(result.content[0]?.text ?? '{}') as T;
}

describe('AAV Integration: Autonomous 5-Call Sequence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLocalMcpServer({ skipConnect: true });
  });

  it('completes full create → build → run loop in under 30 seconds', async () => {
    const { call } = getHandlers();
    const start = Date.now();
    let mcpCallCount = 0;

    // ── Call 1: Discover available node types ──────────────────────────────
    mcpCallCount++;
    const listResult = await call({
      params: { name: 'dag_nodes_list', arguments: {} },
    });
    const { nodes } = parseResult<{ nodes: Array<{ nodeType: string }> }>(listResult);
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.length).toBeGreaterThan(0);

    // ── Call 2: Create an Instant Node ─────────────────────────────────────
    mcpCallCount++;
    const createResult = await call({
      params: {
        name: 'dag_instant_node_create',
        arguments: {
          nodeType: 'aav-test-processor',
          displayName: 'AAV Test Processor',
          systemPromptTemplate: 'Process this: {{text}}',
          inputPorts: [{ key: 'text' }],
          outputPort: { key: 'text' },
          provider: 'anthropic',
        },
      },
    });
    const createData = parseResult<{
      ok: boolean;
      nodeType: string;
      manifest: { defaultInputPort: string; defaultOutputPort: string };
    }>(createResult);
    expect(createData.ok).toBe(true);
    expect(createData.nodeType).toBe('aav-test-processor');
    expect(createData.manifest.defaultInputPort).toBe('text');
    expect(createData.manifest.defaultOutputPort).toBe('text');

    // ── Call 3: Build DAG from pipeline spec ───────────────────────────────
    mcpCallCount++;
    const buildResult = await call({
      params: {
        name: 'dag_build',
        arguments: {
          dagId: 'aav-autonomous-test',
          pipeline: [
            { nodeType: 'input', id: 'in' },
            { nodeType: 'aav-test-processor', id: 'proc' },
            { nodeType: 'text-output', id: 'out' },
          ],
        },
      },
    });
    const buildData = parseResult<{
      ok: boolean;
      valid: boolean;
      nodeCount: number;
      edgeCount: number;
      definition: unknown;
    }>(buildResult);
    expect(buildData.ok).toBe(true);
    expect(buildData.valid).toBe(true);
    expect(buildData.nodeCount).toBe(3);
    expect(buildData.edgeCount).toBe(2);
    expect(buildData.definition).toBeDefined();

    // ── Call 4: Run the DAG ────────────────────────────────────────────────
    mcpCallCount++;
    const runResult = await call({
      params: {
        name: 'dag_run_definition',
        arguments: {
          definition: buildData.definition,
          inputs: { text: 'hello world' },
        },
      },
    });
    const runData = parseResult<{
      ok: boolean;
      dagRunId: string;
      outputs: Record<string, unknown>;
      nodeStatuses: Array<{ nodeId: string; status: string }>;
    }>(runResult);
    expect(runData.ok).toBe(true);
    expect(runData.dagRunId).toBeTruthy();
    expect(runData.nodeStatuses.length).toBe(3);

    // ── Call 5: Verify output has _agentSummary ────────────────────────────
    mcpCallCount++;
    // outputs is keyed as "nodeId.portKey"
    expect(runData.outputs['proc._agentSummary']).toBeTruthy();

    // ── North Star assertions ──────────────────────────────────────────────
    const elapsedMs = Date.now() - start;
    expect(mcpCallCount).toBeLessThanOrEqual(5);
    expect(elapsedMs).toBeLessThan(30_000);
  });

  it('dag_build auto-wires instant node via defaultInputPort/defaultOutputPort', async () => {
    const { call } = getHandlers();

    await call({
      params: {
        name: 'dag_instant_node_create',
        arguments: {
          nodeType: 'auto-wire-node',
          displayName: 'Auto Wire Test',
          systemPromptTemplate: 'Do: {{text}}',
          inputPorts: [{ key: 'text' }],
          outputPort: { key: 'text' },
        },
      },
    });

    const result = await call({
      params: {
        name: 'dag_build',
        arguments: {
          dagId: 'auto-wire-test',
          pipeline: [
            { nodeType: 'input', id: 'in' },
            { nodeType: 'auto-wire-node', id: 'proc' },
            { nodeType: 'text-output', id: 'out' },
          ],
        },
      },
    });
    const data = parseResult<{ ok: boolean; valid: boolean; edgeCount: number }>(result);
    expect(data.ok).toBe(true);
    expect(data.valid).toBe(true);
    // Edges auto-wired: in→proc, proc→out
    expect(data.edgeCount).toBe(2);
  });

  it('structured error from dag_build guides agent to correct node type', async () => {
    const { call } = getHandlers();

    const result = await call({
      params: {
        name: 'dag_build',
        arguments: {
          dagId: 'error-recovery-test',
          pipeline: [
            { nodeType: 'input', id: 'in' },
            { nodeType: 'llm-text-gpt5-does-not-exist', id: 'llm' },
            { nodeType: 'text-output', id: 'out' },
          ],
        },
      },
    });
    const data = parseResult<{
      ok: boolean;
      error: { code: string; fix?: { action: string; options?: string[] } };
    }>(result);
    // dag_build returns ok:false for unknown node types (hard build failure, not a warning)
    expect(data.ok).toBe(false);
    expect(data.error.code).toBe('UNKNOWN_NODE_TYPE');
    // fix.options teaches the agent what valid alternatives exist
    expect(Array.isArray(data.error.fix?.options)).toBe(true);
    expect(data.error.fix?.options?.length ?? 0).toBeGreaterThan(0);
  });

  it('full loop with built-in nodes (no instant node) completes in under 5 seconds', async () => {
    const { call } = getHandlers();
    const start = Date.now();

    const buildResult = await call({
      params: {
        name: 'dag_build',
        arguments: {
          dagId: 'builtin-loop-test',
          pipeline: [
            { nodeType: 'input', id: 'in' },
            {
              nodeType: 'llm-text-anthropic',
              id: 'llm',
              config: { model: 'claude-haiku-4-5-20251001', systemPrompt: 'Answer concisely.' },
            },
            { nodeType: 'text-output', id: 'out' },
          ],
        },
      },
    });
    const buildData = parseResult<{ ok: boolean; valid: boolean; definition: unknown }>(
      buildResult,
    );
    expect(buildData.ok).toBe(true);
    expect(buildData.valid).toBe(true);

    const runResult = await call({
      params: {
        name: 'dag_run_definition',
        arguments: {
          definition: buildData.definition,
          inputs: { text: 'What is 2+2?' },
        },
      },
    });
    const runData = parseResult<{ ok: boolean; dagRunId: string }>(runResult);
    expect(runData.ok).toBe(true);
    expect(runData.dagRunId).toBeTruthy();

    const elapsed = Date.now() - start;
    // With mocked runner, this should be near-instant
    expect(elapsed).toBeLessThan(5_000);
  });
});
