import { describe, expect, it, vi } from 'vitest';

import { buildCatalog } from '../catalog/build.js';

import type { IMCPDiscovery } from '../catalog/types.js';

function catalogFor(
  resultSizeMetadata: IMCPDiscovery['tools']['items'][number]['resultSizeMetadata'],
) {
  const discovery: IMCPDiscovery = {
    identity: {
      serverId: 'srv',
      serverName: 'server',
      serverVersion: '1',
      protocolVersion: '2025-06-18',
    },
    tools: {
      state: { kind: 'supported', count: 1, listChanged: false },
      pages: 1,
      items: [
        { name: 'large', inputSchema: { type: 'object', properties: {} }, resultSizeMetadata },
      ],
    },
    prompts: { state: { kind: 'unsupported' }, pages: 0, items: [] },
    resources: { state: { kind: 'unsupported' }, pages: 0, items: [] },
  };
  const reportResultSizeProblem = vi.fn();
  const catalog = buildCatalog(
    [{ serverId: 'srv', origin: 'fixture', transport: 'stdio', discovery }],
    { reportResultSizeProblem },
  );
  return { entry: [...catalog.adopted, ...catalog.adapted][0], reportResultSizeProblem };
}

describe('catalog result-size metadata projection', () => {
  it('carries only the validated numeric limit into the catalog', () => {
    const { entry, reportResultSizeProblem } = catalogFor({
      kind: 'accepted',
      maxResultChars: 40_000,
    });
    expect(entry).toMatchObject({ kind: 'tool', maxResultChars: 40_000 });
    expect(reportResultSizeProblem).not.toHaveBeenCalled();
  });

  it('reports an invalid request by fixed reason without granting a larger limit', () => {
    const { entry, reportResultSizeProblem } = catalogFor({
      kind: 'invalid',
      reason: 'out-of-range',
    });
    expect(entry).not.toHaveProperty('maxResultChars');
    expect(reportResultSizeProblem).toHaveBeenCalledExactlyOnceWith('out-of-range');
  });
});
