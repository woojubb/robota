import { describe, expect, it, vi } from 'vitest';

import { appCallableToolNames } from '../catalog/app-view.js';
import { buildCatalog } from '../catalog/build.js';
import { parseMCPToolUiMetadata } from '../catalog/ui-metadata.js';

import type { IMCPCatalogInput } from '../catalog/build.js';
import type { IMCPDiscoveredTool, IMCPDiscovery } from '../catalog/types.js';

const APP_ONLY_REASON = 'app-only tool; this host offers tools to the model only';

function tool(name: string, extra: Partial<IMCPDiscoveredTool> = {}): IMCPDiscoveredTool {
  return { name, inputSchema: { type: 'object', properties: {} }, ...extra };
}

function input(serverId: string, tools: readonly IMCPDiscoveredTool[]): IMCPCatalogInput {
  const discovery: IMCPDiscovery = {
    identity: {
      serverId,
      serverName: serverId,
      serverVersion: '1',
      protocolVersion: '2025-06-18',
    },
    tools: {
      state: { kind: 'supported', count: tools.length, listChanged: false },
      pages: 1,
      items: tools,
    },
    prompts: { state: { kind: 'unsupported' }, pages: 0, items: [] },
    resources: { state: { kind: 'unsupported' }, pages: 0, items: [] },
  };
  return { serverId, origin: 'fixture', transport: 'stdio', discovery };
}

describe('catalog — MCP app view metadata', () => {
  it('carries the accepted reference and audience onto the tool entry', () => {
    const catalog = buildCatalog([
      input('srv', [
        tool('show', { ui: { resourceUri: 'ui://show/view', visibility: ['model', 'app'] } }),
      ]),
    ]);
    expect(catalog.adopted).toHaveLength(1);
    expect(catalog.adopted[0]).toMatchObject({
      kind: 'tool',
      canonicalName: 'srv__show',
      ui: { resourceUri: 'ui://show/view', visibility: ['model', 'app'] },
    });
  });

  it('rejects a tool hidden from the model with the exact reason, and keeps its name free', () => {
    const catalog = buildCatalog([
      input('srv', [
        tool('refresh', { ui: { visibility: ['app'] } }),
        tool('show', { ui: { resourceUri: 'ui://show/view', visibility: ['app'] } }),
        tool('plain'),
      ]),
    ]);
    expect(catalog.rejected).toEqual([
      { kind: 'tool', serverId: 'srv', name: 'srv__refresh', reason: APP_ONLY_REASON },
      { kind: 'tool', serverId: 'srv', name: 'srv__show', reason: APP_ONLY_REASON },
    ]);
    expect([...catalog.adopted, ...catalog.adapted].map((entry) => entry.canonicalName)).toEqual([
      'srv__plain',
    ]);
  });

  it('does not let a rejected app-only tool take the name of a tool that is offered', () => {
    // Both sanitise to the same canonical name; only the one the model may see can win it.
    const catalog = buildCatalog([
      input('srv', [
        tool('a.b', { ui: { visibility: ['app'] } }),
        tool('a_b'),
      ]),
    ]);
    const offered = [...catalog.adopted, ...catalog.adapted];
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ sourceName: 'a_b', canonicalName: 'srv__a_b' });
    expect(catalog.rejected.map((rejection) => rejection.reason)).toEqual([APP_ONLY_REASON]);
  });

  it('reports invalid metadata once by fixed reason and still offers the tool without a view', () => {
    const reportUiMetadataProblem = vi.fn();
    const catalog = buildCatalog(
      [input('srv', [tool('broken', { uiProblem: 'invalid-uri' }), tool('fine')])],
      { reportUiMetadataProblem },
    );
    expect(reportUiMetadataProblem).toHaveBeenCalledExactlyOnceWith('srv__broken', 'invalid-uri');
    const broken = catalog.adopted.find((entry) => entry.canonicalName === 'srv__broken');
    expect(broken).toMatchObject({ kind: 'tool', disposition: 'adopted' });
    expect(broken).not.toHaveProperty('ui');
    expect(catalog.rejected).toEqual([]);
  });

  it('is silent when no tool declared anything', () => {
    const reportUiMetadataProblem = vi.fn();
    buildCatalog([input('srv', [tool('fine')])], { reportUiMetadataProblem });
    expect(reportUiMetadataProblem).not.toHaveBeenCalled();
  });
});

describe('appCallableToolNames', () => {
  it('keeps a parsed model-only tool without a view out of app callbacks', () => {
    const tools = [
      { name: 'model_only', meta: { ui: { visibility: ['model'] } } },
      { name: 'app_only', meta: { ui: { visibility: ['app'] } } },
      { name: 'default_audience', meta: { ui: {} } },
      { name: 'both_audiences', meta: { ui: { visibility: ['model', 'app'] } } },
    ].map(({ name, meta }) => {
      const ui = parseMCPToolUiMetadata(meta);
      return tool(name, ui.kind === 'accepted' ? { ui } : {});
    });
    const catalog = buildCatalog([input('srv', tools)]);

    expect([...catalog.adopted, ...catalog.adapted].map((entry) => entry.sourceName)).toEqual([
      'model_only',
      'default_audience',
      'both_audiences',
    ]);
    expect(catalog.rejected).toEqual([
      { kind: 'tool', serverId: 'srv', name: 'srv__app_only', reason: APP_ONLY_REASON },
    ]);
    expect(appCallableToolNames(catalog, 'srv')).toEqual({
      default_audience: 'srv__default_audience',
      both_audiences: 'srv__both_audiences',
    });
  });

  it('maps source names to runtime names for the tools a view of that server may call', () => {
    const catalog = buildCatalog([
      input('srv', [
        tool('plain'),
        tool('show', { ui: { resourceUri: 'ui://show/view', visibility: ['model', 'app'] } }),
        tool('model.only', { ui: { resourceUri: 'ui://other/view', visibility: ['model'] } }),
        tool('hidden', { ui: { visibility: ['app'] } }),
        tool('get.data'),
      ]),
      input('other', [tool('foreign')]),
    ]);
    const names = appCallableToolNames(catalog, 'srv');
    expect(Object.keys(names).sort()).toEqual(['get.data', 'plain', 'show']);
    expect(names['plain']).toBe('srv__plain');
    expect(names['show']).toBe('srv__show');
    // A renamed tool is reachable under the name the runtime registered, not the one it declared.
    const renamed = [...catalog.adopted, ...catalog.adapted].find(
      (entry) => entry.kind === 'tool' && entry.sourceName === 'get.data',
    );
    expect(names['get.data']).toBe(renamed?.canonicalName);
    expect(names['get.data']).not.toBe('get.data');
    expect(appCallableToolNames(catalog, 'other')).toEqual({ foreign: 'other__foreign' });
    expect(appCallableToolNames(catalog, 'absent')).toEqual({});
  });

  it('is safe for a tool named like an object member', () => {
    const catalog = buildCatalog([input('srv', [tool('__proto__'), tool('constructor')])]);
    const names = appCallableToolNames(catalog, 'srv');
    expect(Object.getPrototypeOf(names)).toBe(Object.prototype);
    expect(Object.keys(names).sort()).toEqual(['__proto__', 'constructor']);
  });
});
