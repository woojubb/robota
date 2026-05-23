import { AbstractPlugin, PluginCategory, PluginPriority } from '@robota-sdk/agent-core';

import { NotionClient } from './notion-client.js';
import type {
  INotionPluginOptions,
  INotionPluginStats,
  INotionPage,
  INotionBlock,
} from './types.js';

export class NotionPlugin extends AbstractPlugin<INotionPluginOptions, INotionPluginStats> {
  readonly name = 'NotionPlugin';
  readonly version = '1.0.0';

  private client: NotionClient;
  private pagesFetched = 0;
  private pagesCreated = 0;
  private blocksRead = 0;

  constructor(options: INotionPluginOptions) {
    super();
    this.category = PluginCategory.CUSTOM;
    this.priority = PluginPriority.NORMAL;
    this.client = new NotionClient(options.token);
  }

  async getPage(pageId: string): Promise<INotionPage> {
    this.updateCallStats();
    const page = await this.client.getPage(pageId);
    this.pagesFetched++;
    return page;
  }

  async getPageBlocks(pageId: string): Promise<INotionBlock[]> {
    this.updateCallStats();
    const blocks = await this.client.getPageBlocks(pageId);
    this.blocksRead += blocks.length;
    return blocks;
  }

  async createPage(parentPageId: string, title: string, content?: string): Promise<INotionPage> {
    this.updateCallStats();
    const page = await this.client.createPage(parentPageId, title, content);
    this.pagesCreated++;
    return page;
  }

  async searchPages(query: string, limit?: number): Promise<INotionPage[]> {
    this.updateCallStats();
    const pages = await this.client.searchPages(query, limit);
    this.pagesFetched += pages.length;
    return pages;
  }

  override getStats(): INotionPluginStats {
    return {
      ...super.getStats(),
      pagesFetched: this.pagesFetched,
      pagesCreated: this.pagesCreated,
      blocksRead: this.blocksRead,
    };
  }
}
