/**
 * Unit tests for MCP handler functions.
 * All external I/O and LLM calls are mocked via vi.mock().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDagDefinition, INodeManifest, IDagEdgeDefinition } from '@robota-sdk/dag-core';
import type { ILocalMcpServerContext } from '../mcp/context.js';
import type { IMcpCommandOptions } from '../mcp/types.js';

function getText(content: Array<{ type: string }>, idx = 0): string {
  const item = content[idx];
  if (!item || item.type !== 'text') return '';
  return (item as { type: 'text'; text: string }).text;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../catalog/catalog-scanner.js', () => ({
  scanCatalogDir: vi.fn().mockResolvedValue([]),
  resolveCatalogDirs: vi.fn().mockReturnValue(['/fake/catalog']),
  matchesCatalogQuery: vi.fn().mockReturnValue(false),
}));

vi.mock('../marketplace/external-node-scanner.js', () => ({
  discoverExternalNodePackages: vi.fn().mockResolvedValue([]),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('{}'),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));

vi.mock('../local-runner/index.js', async () => {
  const actual = await vi.importActual<typeof import('../local-runner/index.js')>(
    '../local-runner/index.js',
  );
  return {
    ...actual,
    LocalDagRunner: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        dagRun: { dagRunId: 'run-mock-1', status: 'success' },
        taskRuns: [
          {
            nodeId: 'out',
            status: 'success',
            outputSnapshot: JSON.stringify({ text: 'hello world' }),
          },
        ],
      }),
      events: {
        subscribe: vi.fn().mockReturnValue(() => undefined),
      },
    })),
    createCliNodeRegistry: actual.createCliNodeRegistry,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MINIMAL_MANIFESTS: INodeManifest[] = [
  {
    nodeType: 'input',
    displayName: 'Input',
    category: 'Core',
    inputs: [],
    outputs: [{ key: 'text', type: 'string', required: true }],
    configSchema: undefined,
    defaultInputPort: undefined,
    defaultOutputPort: 'text',
  },
  {
    nodeType: 'text-output',
    displayName: 'Text Output',
    category: 'Core',
    inputs: [{ key: 'text', type: 'string', required: true }],
    outputs: [],
    configSchema: undefined,
    defaultInputPort: 'text',
    defaultOutputPort: undefined,
  },
  {
    nodeType: 'llm-text-anthropic',
    displayName: 'LLM Text (Anthropic)',
    category: 'LLM',
    inputs: [{ key: 'text', type: 'string', required: true }],
    outputs: [{ key: 'text', type: 'string', required: true }],
    configSchema: undefined,
    defaultInputPort: 'text',
    defaultOutputPort: 'text',
  },
];

const MOCK_OPTIONS: IMcpCommandOptions = {
  skipConnect: true,
  projectDir: '/fake/project',
  catalogDir: '/fake/catalog',
};

function makeContext(overrides?: Partial<ILocalMcpServerContext>): ILocalMcpServerContext {
  const instantNodeDefinitions: ILocalMcpServerContext['instantNodeDefinitions'] = [];
  return {
    getAllDefinitions: vi.fn().mockReturnValue([]),
    getManifests: vi.fn().mockReturnValue(MINIMAL_MANIFESTS),
    invalidateNodeCache: vi.fn(),
    addCompletedRun: vi.fn(),
    getCompletedRun: vi.fn().mockReturnValue(undefined),
    listCompletedRuns: vi.fn().mockReturnValue([]),
    getActiveProvider: vi.fn().mockReturnValue({ providerId: 'local' }),
    setActiveProvider: vi.fn(),
    instantNodeDefinitions,
    options: MOCK_OPTIONS,
    ...overrides,
  };
}

const MINIMAL_DAG = {
  dagId: 'test-dag',
  version: 1 as const,
  status: 'draft' as const,
  nodes: [
    { nodeId: 'in', nodeType: 'input', dependsOn: [] as string[], config: {} },
    { nodeId: 'llm', nodeType: 'llm-text-anthropic', dependsOn: ['in'], config: {} },
    { nodeId: 'out', nodeType: 'text-output', dependsOn: ['llm'], config: {} },
  ],
  edges: [] as IDagEdgeDefinition[],
};

// ---------------------------------------------------------------------------
// format.ts handlers
// ---------------------------------------------------------------------------

describe('handleDagExport', () => {
  it('returns workflowFile and companion for valid definition', async () => {
    const { handleDagExport } = await import('../mcp/handlers/format.js');
    const result = handleDagExport({ definition: MINIMAL_DAG });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      ok: boolean;
      workflowFile: unknown;
      companion: unknown;
      note: string;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.workflowFile).toBeDefined();
    expect(parsed.companion).toBeDefined();
    expect(parsed.note).toContain('.dag.json');
  });

  it('returns error when definition is missing', async () => {
    const { handleDagExport } = await import('../mcp/handlers/format.js');
    const result = handleDagExport({});
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"definition" is required');
  });

  it('returns error when definition is not an object', async () => {
    const { handleDagExport } = await import('../mcp/handlers/format.js');
    const result = handleDagExport({ definition: 'not-an-object' });
    expect(result.isError).toBe(true);
  });

  it('returns error when definition is an array', async () => {
    const { handleDagExport } = await import('../mcp/handlers/format.js');
    const result = handleDagExport({ definition: [] });
    expect(result.isError).toBe(true);
  });
});

describe('handleDagImport', () => {
  it('returns error when workflowFile is not valid format', async () => {
    const { handleDagImport } = await import('../mcp/handlers/format.js');
    const result = handleDagImport({ workflowFile: { not: 'valid' } });
    // Should return error or treat as legacy
    expect(result.content.length).toBeGreaterThan(0);
  });

  it('returns definition as-is for legacy IDagDefinition format', async () => {
    const { handleDagImport } = await import('../mcp/handlers/format.js');
    // MINIMAL_DAG has nodes[] which is legacy IDagDefinition format
    const result = handleDagImport({ workflowFile: MINIMAL_DAG });
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      ok: boolean;
      definition: unknown;
      note: string;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.note).toContain('IDagDefinition');
  });

  it('returns error when workflowFile is null', async () => {
    const { handleDagImport } = await import('../mcp/handlers/format.js');
    const result = handleDagImport({ workflowFile: null });
    expect(result.isError).toBe(true);
  });

  it('returns definition when valid workflowFile and companion object are provided', async () => {
    const { handleDagImport, handleDagExport } = await import('../mcp/handlers/format.js');
    // First export MINIMAL_DAG to get a valid IDagWorkflowFile
    const exportResult = handleDagExport({ definition: MINIMAL_DAG });
    const exportParsed = JSON.parse(getText(exportResult.content, 0) || '{}') as {
      workflowFile: unknown;
      companion: unknown;
    };
    // Import with a companion object (non-null triggers the true branch at lines 41-44)
    const result = handleDagImport({
      workflowFile: exportParsed.workflowFile,
      companion: { portValues: {} },
    });
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nodes.ts handlers
// ---------------------------------------------------------------------------

describe('handleDagNodesList', () => {
  it('returns node list from manifests', async () => {
    const { handleDagNodesList } = await import('../mcp/handlers/nodes.js');
    const ctx = makeContext();
    const result = await handleDagNodesList(ctx);
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      nodes: Array<{ nodeType: string; displayName: string; category: string }>;
    };
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(parsed.nodes.length).toBe(MINIMAL_MANIFESTS.length);
    expect(parsed.nodes[0]?.nodeType).toBeDefined();
  });
});

describe('handleDagNodePackagesList', () => {
  it('returns empty packages list when none discovered', async () => {
    const { handleDagNodePackagesList } = await import('../mcp/handlers/nodes.js');
    const ctx = makeContext();
    const result = await handleDagNodePackagesList(ctx, {});
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      packages: unknown[];
      totalPackages: number;
      totalNodes: number;
    };
    expect(Array.isArray(parsed.packages)).toBe(true);
    expect(parsed.totalPackages).toBe(0);
    expect(parsed.totalNodes).toBe(0);
  });

  it('passes searchRoots array correctly', async () => {
    const { handleDagNodePackagesList } = await import('../mcp/handlers/nodes.js');
    const ctx = makeContext();
    const result = await handleDagNodePackagesList(ctx, {
      searchRoots: ['/path/one', '/path/two'],
    });
    expect(result.isError).toBeFalsy();
  });

  it('ignores invalid searchRoots (non-string elements)', async () => {
    const { handleDagNodePackagesList } = await import('../mcp/handlers/nodes.js');
    const ctx = makeContext();
    const result = await handleDagNodePackagesList(ctx, { searchRoots: [1, 2, 3] });
    expect(result.isError).toBeFalsy();
  });
});

describe('handleDagNodesInfo', () => {
  it('returns manifest for known nodeType', async () => {
    const { handleDagNodesInfo } = await import('../mcp/handlers/nodes.js');
    const ctx = makeContext();
    const result = handleDagNodesInfo(ctx, { nodeType: 'input' });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as { nodeType: string };
    expect(parsed.nodeType).toBe('input');
  });

  it('returns error for unknown nodeType', async () => {
    const { handleDagNodesInfo } = await import('../mcp/handlers/nodes.js');
    const ctx = makeContext();
    const result = handleDagNodesInfo(ctx, { nodeType: 'does-not-exist' });
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('Unknown node type');
  });

  it('returns error when nodeType is missing', async () => {
    const { handleDagNodesInfo } = await import('../mcp/handlers/nodes.js');
    const ctx = makeContext();
    const result = handleDagNodesInfo(ctx, {});
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"nodeType" is required');
  });

  it('returns error when nodeType is empty string', async () => {
    const { handleDagNodesInfo } = await import('../mcp/handlers/nodes.js');
    const ctx = makeContext();
    const result = handleDagNodesInfo(ctx, { nodeType: '   ' });
    expect(result.isError).toBe(true);
  });

  it('suggests similar node types when not found', async () => {
    const { handleDagNodesInfo } = await import('../mcp/handlers/nodes.js');
    // Add a recognizable nodeType to manifests
    const ctx = makeContext({
      getManifests: vi.fn().mockReturnValue([
        ...MINIMAL_MANIFESTS,
        {
          nodeType: 'llm-text-openai',
          displayName: 'LLM Text (OpenAI)',
          category: 'LLM',
          inputs: [],
          outputs: [],
          configSchema: undefined,
          defaultInputPort: undefined,
          defaultOutputPort: undefined,
        },
      ]),
    });
    // Query for 'llm-text' — should suggest 'llm-text-anthropic' and 'llm-text-openai'
    const result = handleDagNodesInfo(ctx, { nodeType: 'llm-text' });
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('Did you mean');
  });
});

// ---------------------------------------------------------------------------
// templates.ts handlers
// ---------------------------------------------------------------------------

describe('handleDagTemplatesList', () => {
  it('returns a list of templates', async () => {
    const { handleDagTemplatesList } = await import('../mcp/handlers/templates.js');
    const result = handleDagTemplatesList();
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      templates: Array<{ id: string; description: string; topology: string; slots: unknown[] }>;
    };
    expect(Array.isArray(parsed.templates)).toBe(true);
    expect(parsed.templates.length).toBeGreaterThan(0);
    expect(parsed.templates[0]?.id).toBeDefined();
    expect(parsed.templates[0]?.slots).toBeDefined();
  });
});

describe('handleDagBuildFromTemplate', () => {
  it('returns error when templateId is missing', async () => {
    const { handleDagBuildFromTemplate } = await import('../mcp/handlers/templates.js');
    const ctx = makeContext();
    const result = handleDagBuildFromTemplate(ctx, { slots: {} });
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"templateId" is required');
  });

  it('returns error when templateId is empty string', async () => {
    const { handleDagBuildFromTemplate } = await import('../mcp/handlers/templates.js');
    const ctx = makeContext();
    const result = handleDagBuildFromTemplate(ctx, { templateId: '   ', slots: {} });
    expect(result.isError).toBe(true);
  });

  it('returns error when slots is missing', async () => {
    const { handleDagBuildFromTemplate } = await import('../mcp/handlers/templates.js');
    const ctx = makeContext();
    const result = handleDagBuildFromTemplate(ctx, { templateId: 'linear' });
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"slots" must be an object');
  });

  it('returns error when slots is an array', async () => {
    const { handleDagBuildFromTemplate } = await import('../mcp/handlers/templates.js');
    const ctx = makeContext();
    const result = handleDagBuildFromTemplate(ctx, { templateId: 'linear', slots: [] });
    expect(result.isError).toBe(true);
  });

  it('returns ok: false for unknown templateId', async () => {
    const { handleDagBuildFromTemplate } = await import('../mcp/handlers/templates.js');
    const ctx = makeContext();
    const result = handleDagBuildFromTemplate(ctx, {
      templateId: 'no-such-template',
      slots: {},
    });
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      ok: boolean;
      error: string;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// catalog.ts handlers
// ---------------------------------------------------------------------------

describe('handleDagCatalogList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty workflows list when catalog is empty', async () => {
    const { scanCatalogDir, resolveCatalogDirs } = await import('../catalog/catalog-scanner.js');
    vi.mocked(scanCatalogDir).mockResolvedValue([]);
    vi.mocked(resolveCatalogDirs).mockReturnValue(['/fake/catalog']);

    const { handleDagCatalogList } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogList(ctx, {});
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      workflows: unknown[];
    };
    expect(Array.isArray(parsed.workflows)).toBe(true);
    expect(parsed.workflows).toHaveLength(0);
  });

  it('passes catalogDir arg to resolveCatalogDirs', async () => {
    const { resolveCatalogDirs, scanCatalogDir } = await import('../catalog/catalog-scanner.js');
    vi.mocked(resolveCatalogDirs).mockReturnValue(['/custom/catalog']);
    vi.mocked(scanCatalogDir).mockResolvedValue([]);

    const { handleDagCatalogList } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    await handleDagCatalogList(ctx, { catalogDir: '/custom/catalog' });
    expect(resolveCatalogDirs).toHaveBeenCalledWith(
      expect.objectContaining({ catalogDir: '/custom/catalog' }),
    );
  });

  it('returns workflow entries from catalog scan', async () => {
    const { scanCatalogDir, resolveCatalogDirs } = await import('../catalog/catalog-scanner.js');
    vi.mocked(resolveCatalogDirs).mockReturnValue(['/fake/catalog']);
    vi.mocked(scanCatalogDir).mockResolvedValue([
      {
        id: 'my-workflow',
        filePath: '/fake/catalog/my-workflow.dag.json',
        definition: MINIMAL_DAG,
        meta: { description: 'A test workflow', tags: ['test'] },
      },
    ]);

    const { handleDagCatalogList } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogList(ctx, {});
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      workflows: Array<{ id: string; description: string; nodeCount: number }>;
    };
    expect(parsed.workflows).toHaveLength(1);
    expect(parsed.workflows[0]?.id).toBe('my-workflow');
    expect(parsed.workflows[0]?.nodeCount).toBe(3);
  });

  it('deduplicates entries with same id across multiple dirs', async () => {
    const { scanCatalogDir, resolveCatalogDirs } = await import('../catalog/catalog-scanner.js');
    vi.mocked(resolveCatalogDirs).mockReturnValue(['/dir1', '/dir2']);
    const entry = {
      id: 'same-workflow',
      filePath: '/dir1/same-workflow.dag.json',
      definition: MINIMAL_DAG,
      meta: {},
    };
    vi.mocked(scanCatalogDir)
      .mockResolvedValueOnce([entry])
      .mockResolvedValueOnce([{ ...entry, filePath: '/dir2/same-workflow.dag.json' }]);

    const { handleDagCatalogList } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogList(ctx, {});
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      workflows: unknown[];
    };
    expect(parsed.workflows).toHaveLength(1);
  });
});

describe('handleDagCatalogSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when query is missing', async () => {
    const { handleDagCatalogSearch } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogSearch(ctx, {});
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"query" is required');
  });

  it('returns error when query is empty string', async () => {
    const { handleDagCatalogSearch } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogSearch(ctx, { query: '   ' });
    expect(result.isError).toBe(true);
  });

  it('returns matches when matchesCatalogQuery returns true', async () => {
    const { scanCatalogDir, resolveCatalogDirs, matchesCatalogQuery } =
      await import('../catalog/catalog-scanner.js');
    vi.mocked(resolveCatalogDirs).mockReturnValue(['/fake/catalog']);
    vi.mocked(scanCatalogDir).mockResolvedValue([
      {
        id: 'translate-workflow',
        filePath: '/fake/catalog/translate-workflow.dag.json',
        definition: MINIMAL_DAG,
        meta: { description: 'Translation workflow', tags: ['translate'] },
      },
    ]);
    vi.mocked(matchesCatalogQuery).mockReturnValue(true);

    const { handleDagCatalogSearch } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogSearch(ctx, { query: 'translate' });
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      query: string;
      matches: unknown[];
    };
    expect(parsed.query).toBe('translate');
    expect(parsed.matches).toHaveLength(1);
  });

  it('returns empty matches when nothing matches', async () => {
    const { scanCatalogDir, resolveCatalogDirs, matchesCatalogQuery } =
      await import('../catalog/catalog-scanner.js');
    vi.mocked(resolveCatalogDirs).mockReturnValue(['/fake/catalog']);
    vi.mocked(scanCatalogDir).mockResolvedValue([
      {
        id: 'some-workflow',
        filePath: '/fake/catalog/some-workflow.dag.json',
        definition: MINIMAL_DAG,
        meta: {},
      },
    ]);
    vi.mocked(matchesCatalogQuery).mockReturnValue(false);

    const { handleDagCatalogSearch } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogSearch(ctx, { query: 'unrelated' });
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      matches: unknown[];
    };
    expect(parsed.matches).toHaveLength(0);
  });
});

describe('handleDagCatalogRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when id is missing', async () => {
    const { handleDagCatalogRun } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogRun(ctx, {});
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"id" is required');
  });

  it('returns error when id is empty', async () => {
    const { handleDagCatalogRun } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogRun(ctx, { id: '  ' });
    expect(result.isError).toBe(true);
  });

  it('returns error when workflow not found', async () => {
    const { scanCatalogDir, resolveCatalogDirs } = await import('../catalog/catalog-scanner.js');
    vi.mocked(resolveCatalogDirs).mockReturnValue(['/fake/catalog']);
    vi.mocked(scanCatalogDir).mockResolvedValue([]);

    const { handleDagCatalogRun } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogRun(ctx, { id: 'no-such-workflow' });
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('No workflow found');
  });

  it('suggests similar workflows when not found', async () => {
    const { scanCatalogDir, resolveCatalogDirs } = await import('../catalog/catalog-scanner.js');
    vi.mocked(resolveCatalogDirs).mockReturnValue(['/fake/catalog']);
    vi.mocked(scanCatalogDir).mockResolvedValue([
      {
        id: 'translate-en-fr',
        filePath: '/fake/catalog/translate-en-fr.dag.json',
        definition: MINIMAL_DAG,
        meta: {},
      },
    ]);

    const { handleDagCatalogRun } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogRun(ctx, { id: 'translate' });
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('Did you mean');
  });

  it('runs workflow when found', async () => {
    const { scanCatalogDir, resolveCatalogDirs } = await import('../catalog/catalog-scanner.js');
    vi.mocked(resolveCatalogDirs).mockReturnValue(['/fake/catalog']);
    vi.mocked(scanCatalogDir).mockResolvedValue([
      {
        id: 'my-workflow',
        filePath: '/fake/catalog/my-workflow.dag.json',
        definition: MINIMAL_DAG,
        meta: {},
      },
    ]);

    const { handleDagCatalogRun } = await import('../mcp/handlers/catalog.js');
    const ctx = makeContext();
    const result = await handleDagCatalogRun(ctx, {
      id: 'my-workflow',
      inputs: { text: 'hello' },
    });
    // With mocked runner, should return ok result
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      ok: boolean;
    };
    expect(parsed.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runs.ts handlers
// ---------------------------------------------------------------------------

describe('handleDagRunsPollProgress', () => {
  it('returns error when runId is missing', async () => {
    const { handleDagRunsPollProgress } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext();
    const result = handleDagRunsPollProgress(ctx, {});
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"runId" is required');
  });

  it('returns error when runId is empty', async () => {
    const { handleDagRunsPollProgress } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext();
    const result = handleDagRunsPollProgress(ctx, { runId: '  ' });
    expect(result.isError).toBe(true);
  });

  it('returns not_found status when run does not exist', async () => {
    const { handleDagRunsPollProgress } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext({ getCompletedRun: vi.fn().mockReturnValue(undefined) });
    const result = handleDagRunsPollProgress(ctx, { runId: 'nonexistent-run' });
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as { status: string };
    expect(parsed.status).toBe('not_found');
  });

  it('returns run record when found', async () => {
    const { handleDagRunsPollProgress } = await import('../mcp/handlers/runs.js');
    const completedRun = {
      dagRunId: 'found-run-id',
      status: 'success',
      completedAt: Date.now(),
      durationMs: 100,
      nodeStatuses: [{ nodeId: 'out', status: 'success' }],
    };
    const ctx = makeContext({ getCompletedRun: vi.fn().mockReturnValue(completedRun) });
    const result = handleDagRunsPollProgress(ctx, { runId: 'found-run-id' });
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      runId: string;
      status: string;
    };
    expect(parsed.runId).toBe('found-run-id');
    expect(parsed.status).toBe('success');
  });
});

describe('handleDagRunsCancel', () => {
  it('returns error when runId is missing', async () => {
    const { handleDagRunsCancel } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext();
    const result = handleDagRunsCancel(ctx, {});
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"runId" is required');
  });

  it('returns error when runId is empty', async () => {
    const { handleDagRunsCancel } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext();
    const result = handleDagRunsCancel(ctx, { runId: '' });
    expect(result.isError).toBe(true);
  });

  it('returns ok: false when run not found', async () => {
    const { handleDagRunsCancel } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext({ getCompletedRun: vi.fn().mockReturnValue(undefined) });
    const result = handleDagRunsCancel(ctx, { runId: 'missing-run' });
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      ok: boolean;
      error: string;
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('Run not found');
  });

  it('returns ok: true for completed run', async () => {
    const { handleDagRunsCancel } = await import('../mcp/handlers/runs.js');
    const completedRun = {
      dagRunId: 'completed-run',
      status: 'success',
      completedAt: Date.now(),
      durationMs: 200,
      nodeStatuses: [
        { nodeId: 'in', status: 'success' },
        { nodeId: 'out', status: 'success' },
      ],
    };
    const ctx = makeContext({ getCompletedRun: vi.fn().mockReturnValue(completedRun) });
    const result = handleDagRunsCancel(ctx, { runId: 'completed-run' });
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      ok: boolean;
      runId: string;
      previousStatus: string;
      partialResults: { completedNodes: string[] };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.runId).toBe('completed-run');
    expect(parsed.previousStatus).toBe('success');
    expect(parsed.partialResults.completedNodes).toContain('in');
    expect(parsed.partialResults.completedNodes).toContain('out');
  });
});

describe('handleDagRunFile', () => {
  it('returns error when file is missing', async () => {
    const { handleDagRunFile } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext();
    const result = await handleDagRunFile(ctx, {});
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"file" is required');
  });

  it('returns error when file is empty string', async () => {
    const { handleDagRunFile } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext();
    const result = await handleDagRunFile(ctx, { file: '  ' });
    expect(result.isError).toBe(true);
  });

  it('returns error when file cannot be read', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockRejectedValueOnce(new Error('File not found'));

    const { handleDagRunFile } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext();
    const result = await handleDagRunFile(ctx, { file: '/nonexistent/file.dag.json' });
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('Failed to read file');
  });

  it('returns error when file contains invalid JSON', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce('not-valid-json' as unknown as string);

    const { handleDagRunFile } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext();
    const result = await handleDagRunFile(ctx, { file: '/some/file.dag.json' });
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('Failed to parse JSON');
  });

  it('runs DAG when file is valid', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(
      JSON.stringify(MINIMAL_DAG) as unknown as string,
    );

    const { handleDagRunFile } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext();
    const result = await handleDagRunFile(ctx, { file: '/valid/file.dag.json' });
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });
});

describe('handleDagRunDefinition', () => {
  it('returns error when definition is missing', async () => {
    const { handleDagRunDefinition } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext();
    const result = await handleDagRunDefinition(ctx, {}, undefined);
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"definition" is required');
  });

  it('runs the DAG when valid definition is provided', async () => {
    const { handleDagRunDefinition } = await import('../mcp/handlers/runs.js');
    const ctx = makeContext();
    const result = await handleDagRunDefinition(
      ctx,
      { definition: MINIMAL_DAG, inputs: { text: 'hello' } },
      undefined,
    );
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it('calls addCompletedRun with run record', async () => {
    const { handleDagRunDefinition } = await import('../mcp/handlers/runs.js');
    const addCompletedRun = vi.fn();
    const ctx = makeContext({ addCompletedRun });
    await handleDagRunDefinition(ctx, { definition: MINIMAL_DAG }, undefined);
    expect(addCompletedRun).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// instant-nodes.ts handlers
// ---------------------------------------------------------------------------

describe('handleDagInstantNodeList', () => {
  it('returns empty list when no instant nodes registered', async () => {
    const { handleDagInstantNodeList } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = handleDagInstantNodeList(ctx);
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      instantNodes: unknown[];
    };
    expect(Array.isArray(parsed.instantNodes)).toBe(true);
    expect(parsed.instantNodes).toHaveLength(0);
  });
});

describe('handleDagInstantNodeCreate', () => {
  it('returns error when nodeType is missing', async () => {
    const { handleDagInstantNodeCreate } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreate(
      ctx,
      {
        displayName: 'My Node',
        systemPromptTemplate: 'Translate: {{text}}',
        inputPorts: [{ key: 'text' }],
        outputPort: { key: 'text' },
      },
      undefined,
    );
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"nodeType" is required');
  });

  it('returns error when displayName is missing', async () => {
    const { handleDagInstantNodeCreate } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreate(
      ctx,
      {
        nodeType: 'my-node',
        systemPromptTemplate: 'Translate: {{text}}',
        inputPorts: [{ key: 'text' }],
        outputPort: { key: 'text' },
      },
      undefined,
    );
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"displayName" is required');
  });

  it('returns error when systemPromptTemplate is missing', async () => {
    const { handleDagInstantNodeCreate } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreate(
      ctx,
      {
        nodeType: 'my-node',
        displayName: 'My Node',
        inputPorts: [{ key: 'text' }],
        outputPort: { key: 'text' },
      },
      undefined,
    );
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"systemPromptTemplate" is required');
  });

  it('returns error when inputPorts is empty array', async () => {
    const { handleDagInstantNodeCreate } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreate(
      ctx,
      {
        nodeType: 'my-node',
        displayName: 'My Node',
        systemPromptTemplate: 'Do: {{text}}',
        inputPorts: [],
        outputPort: { key: 'text' },
      },
      undefined,
    );
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"inputPorts"');
  });

  it('returns error when outputPort is missing key', async () => {
    const { handleDagInstantNodeCreate } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreate(
      ctx,
      {
        nodeType: 'my-node',
        displayName: 'My Node',
        systemPromptTemplate: 'Do: {{text}}',
        inputPorts: [{ key: 'text' }],
        outputPort: {},
      },
      undefined,
    );
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"outputPort"');
  });

  it('creates node successfully with valid args', async () => {
    const { handleDagInstantNodeCreate } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreate(
      ctx,
      {
        nodeType: 'my-translator',
        displayName: 'My Translator',
        systemPromptTemplate: 'Translate to French: {{text}}',
        inputPorts: [{ key: 'text' }],
        outputPort: { key: 'result' },
        provider: 'anthropic',
      },
      undefined,
    );
    const parsed = JSON.parse(getText(result.content, 0) || '{}') as {
      ok: boolean;
      nodeType: string;
      instantNodeCount: number;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.nodeType).toBe('my-translator');
    expect(parsed.instantNodeCount).toBe(1);
  });

  it('returns error when same nodeType registered twice', async () => {
    const { handleDagInstantNodeCreate } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const args = {
      nodeType: 'dup-node',
      displayName: 'Dup',
      systemPromptTemplate: 'Do: {{text}}',
      inputPorts: [{ key: 'text' }],
      outputPort: { key: 'text' },
    };
    await handleDagInstantNodeCreate(ctx, args, undefined);
    const second = await handleDagInstantNodeCreate(ctx, args, undefined);
    expect(second.isError).toBe(true);
    expect(getText(second.content, 0)).toContain('already registered');
  });
});

describe('handleDagInstantNodeCreateComposite', () => {
  it('returns error when nodeType is missing', async () => {
    const { handleDagInstantNodeCreateComposite } =
      await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreateComposite(ctx, {}, undefined);
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"nodeType" is required');
  });

  it('returns error when displayName is missing', async () => {
    const { handleDagInstantNodeCreateComposite } =
      await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreateComposite(
      ctx,
      { nodeType: 'composite-node' },
      undefined,
    );
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"displayName" is required');
  });

  it('returns error when innerDag is null', async () => {
    const { handleDagInstantNodeCreateComposite } =
      await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreateComposite(
      ctx,
      { nodeType: 'composite-node', displayName: 'Composite', innerDag: null },
      undefined,
    );
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"innerDag"');
  });

  it('returns error when exposedInputPort is missing key', async () => {
    const { handleDagInstantNodeCreateComposite } =
      await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreateComposite(
      ctx,
      {
        nodeType: 'composite-node',
        displayName: 'Composite',
        innerDag: MINIMAL_DAG,
        exposedInputPort: {},
        exposedOutputPorts: [{ nodeId: 'out', portKey: 'text', exposedAs: 'result' }],
      },
      undefined,
    );
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"exposedInputPort"');
  });

  it('returns error when exposedOutputPorts is empty', async () => {
    const { handleDagInstantNodeCreateComposite } =
      await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreateComposite(
      ctx,
      {
        nodeType: 'composite-node',
        displayName: 'Composite',
        innerDag: MINIMAL_DAG,
        exposedInputPort: { key: 'text', mapsTo: 'in.text' },
        exposedOutputPorts: [],
      },
      undefined,
    );
    expect(result.isError).toBe(true);
    expect(getText(result.content, 0)).toContain('"exposedOutputPorts"');
  });
});

describe('BEHAVIOR-006: composite instant node save → reload', () => {
  const VALID_COMPOSITE = {
    nodeType: 'my-composite',
    displayName: 'My Composite',
    innerDag: MINIMAL_DAG,
    exposedInputPort: { key: 'text', mapsTo: { nodeId: 'in', portKey: 'text' } },
    exposedOutputPorts: [{ key: 'result', mapsTo: { nodeId: 'out', portKey: 'text' } }],
  };

  async function lastWrittenRecord(): Promise<Record<string, unknown>> {
    const fs = await import('node:fs/promises');
    const call = vi.mocked(fs.writeFile).mock.calls.at(-1);
    return JSON.parse(call![1] as string) as Record<string, unknown>;
  }

  it('persists a composite with kind/innerDag/exposed ports, no taskCode (TC-01)', async () => {
    const { handleDagInstantNodeCreateComposite } =
      await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleDagInstantNodeCreateComposite(
      ctx,
      { ...VALID_COMPOSITE },
      undefined,
    );
    expect(result.isError).toBeFalsy();

    const written = await lastWrittenRecord();
    expect(written['kind']).toBe('composite');
    expect(written['innerDag']).toBeTruthy();
    expect((written['exposedInputPort'] as { key: string }).key).toBe('text');
    expect(written['exposedOutputPorts']).toHaveLength(1);
    expect(written['taskCode']).toBeUndefined();
  });

  it('reloads a persisted composite instead of dropping it (TC-02)', async () => {
    const { loadSavedInstantNodes } = await import('../mcp/handlers/instant-nodes.js');
    const fs = await import('node:fs/promises');
    const record = { kind: 'composite', ...VALID_COMPOSITE };
    vi.mocked(fs.readdir).mockResolvedValueOnce(['my-composite.node.json'] as unknown as Awaited<
      ReturnType<typeof fs.readdir>
    >);
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(record));

    const liveDefs: ILocalMcpServerContext['instantNodeDefinitions'] = [];
    await loadSavedInstantNodes('/proj', liveDefs);
    expect(liveDefs.map((n) => n.nodeType)).toContain('my-composite');
  });

  it('round-trips a composite: create → save → reload (TC-03)', async () => {
    const { handleDagInstantNodeCreateComposite, loadSavedInstantNodes } =
      await import('../mcp/handlers/instant-nodes.js');
    const fs = await import('node:fs/promises');
    const ctx = makeContext();
    await handleDagInstantNodeCreateComposite(ctx, { ...VALID_COMPOSITE }, undefined);
    const written = await lastWrittenRecord();

    // Simulate restart: a fresh registry reloads from the exact written record.
    vi.mocked(fs.readdir).mockResolvedValueOnce(['my-composite.node.json'] as unknown as Awaited<
      ReturnType<typeof fs.readdir>
    >);
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(written));
    const reloaded: ILocalMcpServerContext['instantNodeDefinitions'] = [];
    await loadSavedInstantNodes('/proj', reloaded);
    expect(reloaded.some((n) => n.nodeType === written['nodeType'])).toBe(true);
  });

  it('reloads a valid prompt manifest; an unrecoverable record is skipped (TC-04)', async () => {
    const { loadSavedInstantNodes } = await import('../mcp/handlers/instant-nodes.js');
    const fs = await import('node:fs/promises');
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      'good-prompt.node.json',
      'bad-composite.node.json',
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(
        JSON.stringify({
          kind: 'prompt',
          nodeType: 'good-prompt',
          displayName: 'Good',
          systemPromptTemplate: 'Say hi to {{text}}',
          inputPorts: [{ key: 'text' }],
          outputPort: { key: 'text' },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ kind: 'composite', nodeType: 'bad-composite', displayName: 'Bad' }),
      );

    const defs: ILocalMcpServerContext['instantNodeDefinitions'] = [];
    await loadSavedInstantNodes('/proj', defs);
    expect(defs.map((n) => n.nodeType)).toContain('good-prompt');
    expect(defs.map((n) => n.nodeType)).not.toContain('bad-composite');
  });
});

describe('handleInstantNodeListSaved', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns message when .dag/nodes dir does not exist', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readdir).mockRejectedValueOnce(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    const { handleInstantNodeListSaved } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleInstantNodeListSaved({}, ctx);
    expect(getText(result.content, 0)).toContain('No saved nodes');
  });

  it('returns empty message when dir exists but no node manifest files', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readdir).mockResolvedValueOnce(['other-file.json'] as unknown as never);

    const { handleInstantNodeListSaved } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleInstantNodeListSaved({}, ctx);
    expect(getText(result.content, 0)).toContain('No saved nodes');
  });

  it('returns list of saved nodes', async () => {
    const fsModule = await import('node:fs/promises');
    vi.mocked(fsModule.readdir).mockResolvedValueOnce(['my-node.node.json'] as unknown as never);
    vi.mocked(fsModule.readFile).mockResolvedValueOnce(
      JSON.stringify({
        nodeType: 'my-node',
        displayName: 'My Node',
        createdAt: '2024-01-01T00:00:00.000Z',
      }) as unknown as string,
    );

    const { handleInstantNodeListSaved } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleInstantNodeListSaved({}, ctx);
    expect(getText(result.content, 0)).toContain('my-node');
    expect(getText(result.content, 0)).toContain('My Node');
  });
});

describe('handleInstantNodeSave', () => {
  it('returns error when nodeType is missing', async () => {
    const { handleInstantNodeSave } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleInstantNodeSave({}, ctx);
    expect(getText(result.content, 0)).toContain('nodeType is required');
  });

  it('returns error when instant node is not found in memory', async () => {
    const { handleInstantNodeSave } = await import('../mcp/handlers/instant-nodes.js');
    const ctx = makeContext();
    const result = await handleInstantNodeSave({ nodeType: 'not-there' }, ctx);
    expect(getText(result.content, 0)).toContain('not found in memory');
  });
});
