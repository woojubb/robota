/**
 * Which chats are side chats, and the chat each was started beside. The conversations themselves are
 * ordinary sessions; this record only lets the menu list side chats apart and reopen them.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { containsSensitiveMemoryContent } from '@robota-sdk/agent-framework';

export interface ISideChat {
  /** The side chat's session id. */
  readonly id: string;
  /** The chat it was started beside, when there was one. */
  readonly parentId?: string;
  readonly title: string;
  readonly createdAt: string;
}

export interface ISideChatBook {
  list(): readonly ISideChat[];
  add(input: {
    readonly id: string;
    readonly parentId?: string;
    readonly title: string;
  }): ISideChat;
  remove(id: string): boolean;
  /**
   * Replace text in the titles the person was shown for their side chats; `redactFor` gives the
   * replacement for one chat's title, or nothing to leave it. Returns the ids whose title changed.
   */
  redactTitles(
    redactFor: (id: string) => ((value: string) => string) | undefined,
  ): readonly string[];
}

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const TITLE_LENGTH = 80;
const UNTITLED = 'Side chat';

export class SideChatRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SideChatRefusedError';
  }
}

/** A one-line title; a question that carries a secret is not kept as a title. */
function title(text: string): string {
  const line = text.replace(/\s+/gu, ' ').trim();
  if (line === '' || containsSensitiveMemoryContent(line)) return UNTITLED;
  return line.length <= TITLE_LENGTH ? line : `${line.slice(0, TITLE_LENGTH - 1)}…`;
}

/** Side chats in one owner-only `side-chats.json`, newest first, rewritten atomically. */
export function createSideChatBook(
  directory: string,
  now: () => Date = () => new Date(),
): ISideChatBook {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'side-chats.json');
  const read = (): ISideChat[] =>
    existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ISideChat[]) : [];
  const write = (chats: readonly ISideChat[]): void => {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(chats, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  };
  return {
    list: () => read(),
    add: (input) => {
      for (const id of [input.id, input.parentId]) {
        if (id !== undefined && !SESSION_ID.test(id))
          throw new SideChatRefusedError(`Invalid session id: ${id}`);
      }
      const chats = read();
      const known = chats.find((chat) => chat.id === input.id);
      if (known !== undefined) return known;
      const chat: ISideChat = {
        id: input.id,
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        title: title(input.title),
        createdAt: now().toISOString(),
      };
      write([chat, ...chats]);
      return chat;
    },
    remove: (id) => {
      const chats = read();
      const rest = chats.filter((chat) => chat.id !== id);
      if (rest.length === chats.length) return false;
      write(rest);
      return true;
    },
    redactTitles: (redactFor) => {
      const changed: string[] = [];
      const chats = read().map((chat) => {
        const redact = redactFor(chat.id);
        const next = redact === undefined ? chat.title : redact(chat.title);
        if (next === chat.title) return chat;
        changed.push(chat.id);
        return { ...chat, title: next };
      });
      if (changed.length > 0) write(chats);
      return changed;
    },
  };
}
