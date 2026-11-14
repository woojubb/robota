/** A knowledge store held in memory: for tests, and for a host that keeps state elsewhere. */
import type { IKnowledgeStore, IWikiLogEntry, IWikiPage } from './types.js';

export function createMemoryKnowledgeStore(): IKnowledgeStore {
  const pages = new Map<string, IWikiPage>();
  const log: IWikiLogEntry[] = [];
  return {
    listPages: async () => [...pages.values()],
    getPage: async (id) => pages.get(id),
    putPage: async (page) => {
      pages.set(page.id, page);
    },
    deletePage: async (id) => {
      pages.delete(id);
    },
    appendLog: async (entry) => {
      log.push(entry);
    },
    readLog: async (limit) => log.slice(-limit).reverse(),
  };
}
