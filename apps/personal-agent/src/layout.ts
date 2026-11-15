/**
 * The order of the person's tabs in the menu, kept in the state directory so it follows them across
 * browsers. It holds tab ids only: the fixed menus and `space:<id>` for each space.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TAB_ID = /^(chat|feed|ideas|goals|library|connectors|space:space-[a-z0-9-]{1,60})$/u;
const MAX_TABS = 200;

export class LayoutRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'LayoutRefusedError';
  }
}

export interface ILayoutBook {
  tabs(): readonly string[];
  saveTabs(tabs: readonly unknown[]): readonly string[];
}

export function createLayoutBook(stateDir: string): ILayoutBook {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const path = join(stateDir, 'layout.json');
  return {
    tabs: () => {
      if (!existsSync(path)) return [];
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { tabs?: unknown };
      return Array.isArray(parsed.tabs)
        ? parsed.tabs.filter((tab): tab is string => typeof tab === 'string' && TAB_ID.test(tab))
        : [];
    },
    saveTabs: (tabs) => {
      if (tabs.length > MAX_TABS) throw new LayoutRefusedError('Too many tabs');
      const kept: string[] = [];
      for (const tab of tabs) {
        if (typeof tab !== 'string' || !TAB_ID.test(tab))
          throw new LayoutRefusedError(`Not a tab: ${String(tab)}`);
        if (!kept.includes(tab)) kept.push(tab);
      }
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ tabs: kept }, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, path);
      return kept;
    },
  };
}
