import type { IPluginOptions, IPluginStats } from '@robota-sdk/agent-core';

export interface INotionPluginOptions extends IPluginOptions {
  token: string;
}

export interface INotionPage {
  id: string;
  title: string;
  url: string;
  lastEdited: string;
  properties: Record<string, unknown>;
}

export interface INotionBlock {
  id: string;
  type: string;
  text: string;
}

export interface INotionDatabase {
  id: string;
  title: string;
  url: string;
}

export interface INotionPluginStats extends IPluginStats {
  pagesFetched: number;
  pagesCreated: number;
  blocksRead: number;
}
