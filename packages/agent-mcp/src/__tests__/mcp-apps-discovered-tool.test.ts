import { wasToolResultAdmitted } from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import { MCP_APP_MIME_TYPE } from '../catalog/app-view.js';
import { createDiscoveredTool } from '../catalog/discovered-tool.js';

import type { IMCPToolInvoker } from '../catalog/discovered-tool.js';
import type { IMCPCatalogToolEntry } from '../catalog/types.js';
import type { IMCPReadResourceResult, IMCPToolCallResult } from '../client/session.js';
import type {
  IToolResult,
  IToolResultAdmissionOptions,
  IToolWithEventService,
} from '@robota-sdk/agent-core';

const VIEW_URI = 'ui://show/view';
const HTML = '<!doctype html><html><body>chart</body></html>';

function entry(overrides: Partial<IMCPCatalogToolEntry> = {}): IMCPCatalogToolEntry {
  return {
    kind: 'tool',
    canonicalName: 'srv__show',
    sourceName: 'show',
    schema: { type: 'object', properties: { query: { type: 'string' } } },
    unenforceablePaths: [],
    provenance: {
      serverId: 'srv',
      serverName: 'Server',
      serverVersion: '1',
      protocolVersion: '2025-06-18',
      origin: 'fixture',
    },
    disposition: 'adopted',
    ui: { resourceUri: VIEW_URI, visibility: ['model', 'app'] },
    ...overrides,
  };
}

const SUCCESS: IMCPToolCallResult = {
  content: [{ type: 'text', text: 'rendered 2 rows' }],
  structuredContent: { rows: [1, 2] },
  isError: false,
};

const VIEW_RESOURCE: IMCPReadResourceResult = {
  contents: [{ uri: VIEW_URI, mimeType: MCP_APP_MIME_TYPE, text: HTML }],
};

interface IHarness {
  readonly tool: IToolWithEventService;
  readonly callTool: ReturnType<typeof vi.fn>;
  readonly readResource: ReturnType<typeof vi.fn>;
  readonly problems: string[];
}

function harness(
  options: {
    entry?: IMCPCatalogToolEntry;
    call?: IMCPToolCallResult;
    read?: () => Promise<IMCPReadResourceResult>;
    withoutReader?: boolean;
    isDispatchAdmitted?: () => boolean;
    appCallableTools?: Readonly<Record<string, string>>;
    admission?: IToolResultAdmissionOptions;
  } = {},
): IHarness {
  const callTool = vi.fn(async () => options.call ?? SUCCESS);
  const readResource = vi.fn(options.read ?? (async () => VIEW_RESOURCE));
  const invoker: IMCPToolInvoker = options.withoutReader
    ? { callTool }
    : { callTool, readResource };
  const problems: string[] = [];
  const tool = createDiscoveredTool(options.entry ?? entry(), invoker, {
    reportAppViewProblem: (reason) => problems.push(reason),
    ...(options.isDispatchAdmitted ? { isDispatchAdmitted: options.isDispatchAdmitted } : {}),
    ...(options.appCallableTools ? { appCallableTools: options.appCallableTools } : {}),
    ...(options.admission ? { admission: options.admission } : {}),
  });
  return { tool, callTool, readResource, problems };
}

const CALLABLE = { show: 'srv__show', lookup: 'srv__lookup' };

function withoutView(result: IToolResult): Omit<IToolResult, 'view'> {
  const { view: _view, ...rest } = result;
  return rest;
}

describe('DiscoveredMCPTool — MCP app view', () => {
  it('attaches the view after a successful call, with what the surface needs to host it', async () => {
    const { tool, callTool, readResource, problems } = harness({ appCallableTools: CALLABLE });
    const controller = new AbortController();
    const result = await tool.execute(
      { query: 'revenue' },
      { toolName: 'srv__show', parameters: { query: 'revenue' }, signal: controller.signal },
    );
    expect(result.success).toBe(true);
    expect(result.view).toEqual({
      sourceId: 'srv',
      resourceUri: VIEW_URI,
      mimeType: MCP_APP_MIME_TYPE,
      html: HTML,
      structuredContent: { rows: [1, 2] },
      toolInput: { query: 'revenue' },
      callableTools: CALLABLE,
    });
    expect(wasToolResultAdmitted(result)).toBe(true);
    expect(callTool).toHaveBeenCalledOnce();
    // The read happens after the call, on the same signal, for the declared reference only.
    expect(readResource).toHaveBeenCalledExactlyOnceWith(VIEW_URI, { signal: controller.signal });
    expect(callTool.mock.invocationCallOrder[0]).toBeLessThan(
      readResource.mock.invocationCallOrder[0] ?? 0,
    );
    expect(problems).toEqual([]);
  });

  it('leaves structured content out of the view when the call returned none, and allows no callbacks by default', async () => {
    const { tool } = harness({
      call: { content: [{ type: 'text', text: 'plain' }], isError: false },
    });
    const result = await tool.execute({}, { toolName: 'srv__show', parameters: {} });
    expect(result.view).toBeDefined();
    expect(result.view).not.toHaveProperty('structuredContent');
    expect(result.view?.callableTools).toEqual({});
    expect(result.view?.toolInput).toEqual({});
  });

  it('gives the model exactly the same result with and without a view', async () => {
    const withView = await harness({ appCallableTools: CALLABLE }).tool.execute(
      { query: 'q' },
      { toolName: 'srv__show', parameters: { query: 'q' } },
    );
    const plain = await harness({ entry: entry({ ui: undefined }) }).tool.execute(
      { query: 'q' },
      { toolName: 'srv__show', parameters: { query: 'q' } },
    );
    expect(withView.view).toBeDefined();
    expect(plain).not.toHaveProperty('view');
    expect(withoutView(withView)).toEqual(plain);
    expect(JSON.stringify(withoutView(withView))).not.toContain('chart');
  });

  it('does not count the document against the result limits that admission applies', async () => {
    const onWarning = vi.fn();
    const huge = 'x'.repeat(1_000_000);
    const { tool } = harness({
      read: async () => ({
        contents: [{ uri: VIEW_URI, mimeType: MCP_APP_MIME_TYPE, text: huge }],
      }),
      admission: { warningChars: 100, hardChars: 200, onWarning },
    });
    const result = await tool.execute({}, { toolName: 'srv__show', parameters: {} });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ rows: [1, 2] });
    expect(result.view?.html).toBe(huge);
    expect(onWarning).not.toHaveBeenCalled();
  });

  it('keeps the text result and names a fixed reason when the read throws', async () => {
    const { tool, problems } = harness({
      read: async () => {
        throw new Error('secret-token-123 leaked by the server');
      },
    });
    const result = await tool.execute({}, { toolName: 'srv__show', parameters: {} });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ rows: [1, 2] });
    expect(result).not.toHaveProperty('view');
    expect(wasToolResultAdmitted(result)).toBe(true);
    expect(problems).toEqual(['read-failed']);
    expect(JSON.stringify(problems)).not.toContain('secret');
  });

  it.each([
    ['a different media type', [{ uri: VIEW_URI, mimeType: 'text/html', text: HTML }], 'mime-type'],
    [
      'another uri',
      [{ uri: 'ui://other', mimeType: MCP_APP_MIME_TYPE, text: HTML }],
      'uri-mismatch',
    ],
    [
      'two documents',
      [
        { uri: VIEW_URI, mimeType: MCP_APP_MIME_TYPE, text: HTML },
        { uri: VIEW_URI, mimeType: MCP_APP_MIME_TYPE, text: HTML },
      ],
      'content',
    ],
    ['no document', [], 'missing'],
    [
      'an over-size document',
      [{ uri: VIEW_URI, mimeType: MCP_APP_MIME_TYPE, text: 'x'.repeat(2 * 1024 * 1024 + 1) }],
      'too-large',
    ],
  ])('keeps the text result and names a fixed reason for %s', async (_label, contents, reason) => {
    const { tool, problems } = harness({ read: async () => ({ contents }) });
    const result = await tool.execute({}, { toolName: 'srv__show', parameters: {} });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ rows: [1, 2] });
    expect(result).not.toHaveProperty('view');
    expect(problems).toEqual([reason]);
  });

  it('never reads the view for a failed call', async () => {
    const { tool, readResource, problems } = harness({
      call: { content: [{ type: 'text', text: 'boom' }], isError: true },
    });
    const result = await tool.execute({}, { toolName: 'srv__show', parameters: {} });
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty('view');
    expect(readResource).not.toHaveBeenCalled();
    expect(problems).toEqual([]);
  });

  it('never reads the view for a result with an invalid observation', async () => {
    const { tool, readResource } = harness({
      call: {
        content: [{ type: 'image', mimeType: 'image/png', data: 'not-base64' }],
        isError: false,
      },
    });
    const result = await tool.execute({}, { toolName: 'srv__show', parameters: {} });
    expect(result.success).toBe(false);
    expect(result).not.toHaveProperty('view');
    expect(readResource).not.toHaveBeenCalled();
  });

  it('never reads a view the tool did not declare', async () => {
    for (const ui of [undefined, { visibility: ['model', 'app'] as const }]) {
      const { tool, readResource, problems } = harness({ entry: entry({ ui }) });
      const result = await tool.execute({}, { toolName: 'srv__show', parameters: {} });
      expect(result.success).toBe(true);
      expect(result).not.toHaveProperty('view');
      expect(readResource).not.toHaveBeenCalled();
      expect(problems).toEqual([]);
    }
  });

  it('delivers the text result unchanged when the connection cannot read resources', async () => {
    const { tool, problems } = harness({ withoutReader: true });
    const result = await tool.execute({}, { toolName: 'srv__show', parameters: {} });
    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('view');
    expect(problems).toEqual([]);
  });

  it('re-checks the host admission before the extra request and omits the view when it is withdrawn', async () => {
    const admitted = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const { tool, readResource, problems } = harness({ isDispatchAdmitted: admitted });
    const result = await tool.execute({}, { toolName: 'srv__show', parameters: {} });
    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('view');
    expect(readResource).not.toHaveBeenCalled();
    expect(problems).toEqual(['not-admitted']);
  });
});
