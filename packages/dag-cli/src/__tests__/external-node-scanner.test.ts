import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { readdir, readFile } from 'node:fs/promises';
import { discoverExternalNodePackages } from '../marketplace/external-node-scanner.js';

const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);

const VALID_PKG_JSON = JSON.stringify({
  name: '@acme/robota-dag-node-sentiment',
  version: '1.2.3',
  description: 'Sentiment analysis node for robota-dag',
  keywords: ['robota-dag-node', 'nlp'],
  'robota-dag': {
    type: 'node-package',
    schemaVersion: '1',
    nodes: [
      {
        nodeType: 'sentiment-analyzer',
        displayName: 'Sentiment Analyzer',
        category: 'Analysis',
        description: 'Analyzes text sentiment',
        defaultInputPort: 'text',
        defaultOutputPort: 'sentiment',
      },
    ],
  },
});

const NO_KEYWORD_PKG = JSON.stringify({
  name: 'some-unrelated-package',
  version: '1.0.0',
  keywords: ['utility'],
});

const MISSING_MANIFEST_PKG = JSON.stringify({
  name: '@acme/robota-dag-no-manifest',
  version: '1.0.0',
  keywords: ['robota-dag-node'],
  // no "robota-dag" field
});

describe('discoverExternalNodePackages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array when node_modules does not exist', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    const result = await discoverExternalNodePackages(['/fake/project']);
    expect(result).toEqual([]);
  });

  it('discovers a valid scoped robota-dag-node package', async () => {
    // readdir for node_modules → ['@acme']
    mockReaddir.mockResolvedValueOnce(['@acme'] as unknown as Awaited<ReturnType<typeof readdir>>);
    // readdir for @acme scope → ['robota-dag-node-sentiment']
    mockReaddir.mockResolvedValueOnce(['robota-dag-node-sentiment'] as unknown as Awaited<
      ReturnType<typeof readdir>
    >);
    // readFile for package.json
    mockReadFile.mockResolvedValueOnce(VALID_PKG_JSON as unknown as string);

    const result = await discoverExternalNodePackages(['/fake/project']);

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('@acme/robota-dag-node-sentiment');
    expect(result[0]?.version).toBe('1.2.3');
    expect(result[0]?.nodeManifest.nodes).toHaveLength(1);
    expect(result[0]?.nodeManifest.nodes[0]?.nodeType).toBe('sentiment-analyzer');
  });

  it('skips packages without robota-dag-node keyword', async () => {
    mockReaddir.mockResolvedValueOnce(['some-unrelated-package'] as unknown as Awaited<
      ReturnType<typeof readdir>
    >);
    mockReadFile.mockResolvedValueOnce(NO_KEYWORD_PKG as unknown as string);

    const result = await discoverExternalNodePackages(['/fake/project']);
    expect(result).toEqual([]);
  });

  it('skips packages with keyword but missing robota-dag manifest field', async () => {
    mockReaddir.mockResolvedValueOnce(['@acme'] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReaddir.mockResolvedValueOnce(['robota-dag-no-manifest'] as unknown as Awaited<
      ReturnType<typeof readdir>
    >);
    mockReadFile.mockResolvedValueOnce(MISSING_MANIFEST_PKG as unknown as string);

    const result = await discoverExternalNodePackages(['/fake/project']);
    expect(result).toEqual([]);
  });

  it('deduplicates packages found in multiple search roots', async () => {
    // First root scan
    mockReaddir.mockResolvedValueOnce(['@acme'] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReaddir.mockResolvedValueOnce(['robota-dag-node-sentiment'] as unknown as Awaited<
      ReturnType<typeof readdir>
    >);
    mockReadFile.mockResolvedValueOnce(VALID_PKG_JSON as unknown as string);

    // Second root scan — same package
    mockReaddir.mockResolvedValueOnce(['@acme'] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReaddir.mockResolvedValueOnce(['robota-dag-node-sentiment'] as unknown as Awaited<
      ReturnType<typeof readdir>
    >);
    mockReadFile.mockResolvedValueOnce(VALID_PKG_JSON as unknown as string);

    const result = await discoverExternalNodePackages(['/root1', '/root2']);
    expect(result).toHaveLength(1);
  });

  it('uses process.cwd() as default search root', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    const result = await discoverExternalNodePackages();
    expect(result).toEqual([]);
    expect(mockReaddir).toHaveBeenCalledOnce();
  });
});
