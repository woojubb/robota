/**
 * A knowledge store in an owner-only directory: one JSON record per page (the source of truth), a
 * Markdown rendering beside it that a person can read and export without Robota, an `index.md` of
 * every page, and a `log.md` that grows with every change and is rewritten only to forget.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { renderPageMarkdown } from './render.js';

import type { IKnowledgeStore, IWikiLogEntry, IWikiPage } from './types.js';

const PAGE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

function writeAtomic(path: string, content: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, path);
}

function logLine(entry: IWikiLogEntry): string {
  return `- ${entry.at} ${entry.action}${entry.pageId === undefined ? '' : ` ${entry.pageId}`}: ${entry.summary}\n`;
}

export function createFileKnowledgeStore(directory: string): IKnowledgeStore {
  const pagesDir = join(directory, 'pages');
  mkdirSync(pagesDir, { recursive: true, mode: 0o700 });
  const logPath = join(directory, 'log.jsonl');
  const logMarkdownPath = join(directory, 'log.md');
  const readEntries = (): IWikiLogEntry[] =>
    existsSync(logPath)
      ? readFileSync(logPath, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as IWikiLogEntry)
      : [];

  const assertId = (id: string): void => {
    if (!PAGE_ID.test(id)) throw new Error(`Invalid wiki page id: ${id}`);
  };
  const readPage = (id: string): IWikiPage | undefined => {
    const path = join(pagesDir, `${id}.json`);
    if (!existsSync(path)) return undefined;
    return JSON.parse(readFileSync(path, 'utf8')) as IWikiPage;
  };
  const listIds = (): string[] =>
    readdirSync(pagesDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((id) => PAGE_ID.test(id));
  const writeIndex = (): void => {
    const pages = listIds()
      .map(readPage)
      .filter((page): page is IWikiPage => page !== undefined)
      .sort((a, b) => a.title.localeCompare(b.title));
    const lines = [
      '# Index',
      '',
      ...pages.map((page) => `- [${page.title}](pages/${page.id}.md) — ${page.kind}`),
      '',
    ];
    writeAtomic(join(directory, 'index.md'), lines.join('\n'));
  };

  return {
    listPages: async () =>
      listIds()
        .map(readPage)
        .filter((page): page is IWikiPage => page !== undefined),
    getPage: async (id) => (PAGE_ID.test(id) ? readPage(id) : undefined),
    putPage: async (page) => {
      assertId(page.id);
      writeAtomic(join(pagesDir, `${page.id}.json`), `${JSON.stringify(page, null, 2)}\n`);
      writeAtomic(join(pagesDir, `${page.id}.md`), renderPageMarkdown(page));
      writeIndex();
    },
    deletePage: async (id) => {
      assertId(id);
      rmSync(join(pagesDir, `${id}.json`), { force: true });
      rmSync(join(pagesDir, `${id}.md`), { force: true });
      writeIndex();
    },
    appendLog: async (entry) => {
      appendFileSync(logPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      appendFileSync(logMarkdownPath, logLine(entry), { mode: 0o600 });
    },
    readLog: async (limit) => readEntries().slice(-limit).reverse(),
    rewriteLog: async (keep) => {
      const kept = readEntries().filter(keep);
      writeAtomic(logPath, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
      writeAtomic(logMarkdownPath, kept.map(logLine).join(''));
    },
  };
}
