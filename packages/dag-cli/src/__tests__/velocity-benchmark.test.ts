/**
 * COMPOSE-006: Agent Authoring Velocity Benchmark
 *
 * Measures MCP call count and DAG validity for each scenario.
 * Scenario C (Instant Node) is gated behind VISION-003 and skipped here.
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
        dagRun: { dagRunId: 'bench-run', status: 'success' },
        taskRuns: [{ nodeId: 'out', status: 'success', outputSnapshot: '{"text":"ok"}' }],
      }),
    })),
  };
});

import { createLocalMcpServer } from '../commands/mcp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { IDagDefinition } from '@robota-sdk/dag-core';

type TCallHandler = (req: {
  params: { name: string; arguments: unknown };
}) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;

function getCallHandler(): TCallHandler {
  const serverInstance = vi.mocked(Server).mock.results[0]?.value as {
    setRequestHandler: ReturnType<typeof vi.fn>;
  };
  return serverInstance.setRequestHandler.mock.calls[1]?.[1] as TCallHandler;
}

async function callTool(
  handler: TCallHandler,
  name: string,
  args: unknown,
): Promise<{ text: string; isError?: boolean }> {
  const result = await handler({ params: { name, arguments: args } });
  return { text: result.content[0]?.text ?? '{}', isError: result.isError };
}

describe('COMPOSE-006: Agent Authoring Velocity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createLocalMcpServer({ skipConnect: true });
  });

  describe('Scenario A: Hello World (input → LLM → output)', () => {
    it('dag_build produces a valid 3-node definition in 1 MCP call', async () => {
      const callCount = { n: 0 };
      const rawHandler = getCallHandler();
      const trackedHandler: TCallHandler = (req) => {
        callCount.n += 1;
        return rawHandler(req);
      };

      const result = await callTool(trackedHandler, 'dag_build', {
        dagId: 'scenario-a',
        pipeline: [
          { nodeType: 'input', id: 'in' },
          {
            nodeType: 'llm-text-anthropic',
            id: 'llm',
            config: { model: 'claude-opus-4-7', systemPrompt: 'Answer concisely' },
          },
          { nodeType: 'text-output', id: 'out' },
        ],
      });

      const parsed = JSON.parse(result.text) as {
        ok: boolean;
        valid: boolean;
        nodeCount: number;
        edgeCount: number;
        definition: IDagDefinition;
      };

      // 1 MCP call for definition assembly
      expect(callCount.n).toBe(1);
      expect(parsed.ok).toBe(true);
      expect(parsed.valid).toBe(true);
      expect(parsed.nodeCount).toBe(3);
      expect(parsed.edgeCount).toBe(2);
    });

    it('dag_build + dag_run_definition = 2 MCP calls total', async () => {
      const callCount = { n: 0 };
      const rawHandler = getCallHandler();
      const trackedHandler: TCallHandler = (req) => {
        callCount.n += 1;
        return rawHandler(req);
      };

      // Call 1: build
      const buildResult = await callTool(trackedHandler, 'dag_build', {
        dagId: 'scenario-a-run',
        pipeline: [
          { nodeType: 'input', id: 'in' },
          { nodeType: 'llm-text-anthropic', id: 'llm' },
          { nodeType: 'text-output', id: 'out' },
        ],
      });
      const { definition } = JSON.parse(buildResult.text) as { definition: IDagDefinition };

      // Call 2: run
      await callTool(trackedHandler, 'dag_run_definition', {
        definition,
        inputs: { text: 'hello world' },
      });

      expect(callCount.n).toBe(2);
    });
  });

  describe('Scenario B: Parallel Review (input → [LLM×3] → output)', () => {
    it('dag_build produces a 5-node parallel DAG in 1 MCP call', async () => {
      const callCount = { n: 0 };
      const rawHandler = getCallHandler();
      const trackedHandler: TCallHandler = (req) => {
        callCount.n += 1;
        return rawHandler(req);
      };

      const result = await callTool(trackedHandler, 'dag_build', {
        dagId: 'scenario-b',
        pipeline: [
          { nodeType: 'input', id: 'in' },
          {
            parallel: [
              {
                nodeType: 'llm-text-anthropic',
                id: 'security',
                config: { systemPrompt: 'Security review' },
              },
              {
                nodeType: 'llm-text-anthropic',
                id: 'perf',
                config: { systemPrompt: 'Performance review' },
              },
              {
                nodeType: 'llm-text-anthropic',
                id: 'quality',
                config: { systemPrompt: 'Quality review' },
              },
            ],
          },
        ],
      });

      const parsed = JSON.parse(result.text) as {
        ok: boolean;
        valid: boolean;
        nodeCount: number;
        edgeCount: number;
      };

      expect(callCount.n).toBe(1);
      expect(parsed.ok).toBe(true);
      expect(parsed.nodeCount).toBe(4); // in + security + perf + quality
      expect(parsed.edgeCount).toBe(3); // in→security, in→perf, in→quality
    });
  });

  describe('Scenario C: Instant Node (VISION-003 Phase A)', () => {
    it('dag_instant_node_create + dag_build + dag_run_definition = 3 MCP calls total', async () => {
      const callCount = { n: 0 };
      const rawHandler = getCallHandler();
      const trackedHandler: TCallHandler = (req) => {
        callCount.n += 1;
        return rawHandler(req);
      };

      // Call 1: create instant node
      await callTool(trackedHandler, 'dag_instant_node_create', {
        nodeType: 'french-translator',
        displayName: 'French Translator',
        systemPromptTemplate: 'Translate to French: {{text}}',
        inputPorts: [{ key: 'text' }],
        outputPort: { key: 'text' },
        provider: 'anthropic',
      });

      // Call 2: build DAG using the instant node
      const buildResult = await callTool(trackedHandler, 'dag_build', {
        dagId: 'scenario-c',
        pipeline: [
          { nodeType: 'input', id: 'in' },
          { nodeType: 'french-translator', id: 'translate' },
          { nodeType: 'text-output', id: 'out' },
        ],
      });
      const { definition, valid, nodeCount, edgeCount } = JSON.parse(buildResult.text) as {
        definition: IDagDefinition;
        valid: boolean;
        nodeCount: number;
        edgeCount: number;
      };
      expect(valid).toBe(true);
      expect(nodeCount).toBe(3);
      expect(edgeCount).toBe(2);

      // Call 3: run the DAG
      await callTool(trackedHandler, 'dag_run_definition', {
        definition,
        inputs: { text: 'hello world' },
      });

      expect(callCount.n).toBe(3);
    });
  });
});
