import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginCategory, PluginPriority } from '@robota-sdk/agent-core';

// Mock NotionClient before importing NotionPlugin
vi.mock('../notion-client.js', () => {
  const NotionClient = vi.fn().mockImplementation(() => ({
    getPage: vi.fn(),
    getPageBlocks: vi.fn(),
    createPage: vi.fn(),
    searchPages: vi.fn(),
  }));
  return { NotionClient };
});

import { NotionPlugin } from '../notion-plugin.js';
import { NotionClient } from '../notion-client.js';
import type { INotionPage, INotionBlock } from '../types.js';

const MOCK_TOKEN = 'secret_test_token';

function makePage(overrides: Partial<INotionPage> = {}): INotionPage {
  return {
    id: 'page-id-1',
    title: 'Test Page',
    url: 'https://www.notion.so/Test-Page-page-id-1',
    lastEdited: '2024-01-01T00:00:00.000Z',
    properties: {},
    ...overrides,
  };
}

function makeBlock(overrides: Partial<INotionBlock> = {}): INotionBlock {
  return {
    id: 'block-id-1',
    type: 'paragraph',
    text: 'Hello world',
    ...overrides,
  };
}

describe('NotionPlugin', () => {
  let plugin: NotionPlugin;
  let clientMock: {
    getPage: ReturnType<typeof vi.fn>;
    getPageBlocks: ReturnType<typeof vi.fn>;
    createPage: ReturnType<typeof vi.fn>;
    searchPages: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    plugin = new NotionPlugin({ token: MOCK_TOKEN });
    clientMock = vi.mocked(NotionClient).mock.results[0].value as typeof clientMock;
  });

  it('initializes with correct name, category, and priority', () => {
    expect(plugin.name).toBe('NotionPlugin');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.category).toBe(PluginCategory.CUSTOM);
    expect(plugin.priority).toBe(PluginPriority.NORMAL);
    expect(plugin.enabled).toBe(true);
  });

  it('getPage delegates to client and increments pagesFetched', async () => {
    const page = makePage();
    clientMock.getPage.mockResolvedValueOnce(page);

    const result = await plugin.getPage('page-id-1');

    expect(clientMock.getPage).toHaveBeenCalledWith('page-id-1');
    expect(result).toEqual(page);
    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.pagesFetched).toBe(1);
    expect(stats.pagesCreated).toBe(0);
    expect(stats.blocksRead).toBe(0);
  });

  it('getPageBlocks delegates to client and increments blocksRead', async () => {
    const blocks = [makeBlock({ id: 'b1' }), makeBlock({ id: 'b2' }), makeBlock({ id: 'b3' })];
    clientMock.getPageBlocks.mockResolvedValueOnce(blocks);

    const result = await plugin.getPageBlocks('page-id-1');

    expect(clientMock.getPageBlocks).toHaveBeenCalledWith('page-id-1');
    expect(result).toHaveLength(3);
    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.blocksRead).toBe(3);
    expect(stats.pagesFetched).toBe(0);
  });

  it('createPage delegates to client and increments pagesCreated', async () => {
    const page = makePage({ title: 'New Page' });
    clientMock.createPage.mockResolvedValueOnce(page);

    const result = await plugin.createPage('parent-id', 'New Page', 'Some content');

    expect(clientMock.createPage).toHaveBeenCalledWith('parent-id', 'New Page', 'Some content');
    expect(result).toEqual(page);
    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.pagesCreated).toBe(1);
    expect(stats.pagesFetched).toBe(0);
  });

  it('searchPages delegates to client and increments pagesFetched by result count', async () => {
    const pages = [makePage({ id: 'p1' }), makePage({ id: 'p2' })];
    clientMock.searchPages.mockResolvedValueOnce(pages);

    const result = await plugin.searchPages('test query', 10);

    expect(clientMock.searchPages).toHaveBeenCalledWith('test query', 10);
    expect(result).toHaveLength(2);
    const stats = plugin.getStats();
    expect(stats.calls).toBe(1);
    expect(stats.pagesFetched).toBe(2);
    expect(stats.pagesCreated).toBe(0);
  });

  it('getStats returns merged base and Notion-specific stats', async () => {
    clientMock.getPage.mockResolvedValueOnce(makePage());
    clientMock.createPage.mockResolvedValueOnce(makePage({ title: 'Created' }));
    clientMock.getPageBlocks.mockResolvedValueOnce([makeBlock(), makeBlock()]);

    await plugin.getPage('page-id-1');
    await plugin.createPage('parent-id', 'Created');
    await plugin.getPageBlocks('page-id-1');

    const stats = plugin.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.calls).toBe(3);
    expect(stats.errors).toBe(0);
    expect(stats.pagesFetched).toBe(1);
    expect(stats.pagesCreated).toBe(1);
    expect(stats.blocksRead).toBe(2);
    expect(stats.moduleEventsReceived).toBe(0);
    expect(stats.lastActivity).toBeInstanceOf(Date);
  });

  it('plugin is disabled after disable() and re-enabled after enable()', () => {
    expect(plugin.isEnabled()).toBe(true);

    plugin.disable();
    expect(plugin.isEnabled()).toBe(false);
    expect(plugin.getStats().enabled).toBe(false);

    plugin.enable();
    expect(plugin.isEnabled()).toBe(true);
    expect(plugin.getStats().enabled).toBe(true);
  });
});
