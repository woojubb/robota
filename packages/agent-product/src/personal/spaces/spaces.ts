/**
 * Spaces: one area of the person's life (a trip, a renovation, a job search) with the person's own
 * instructions for working in it. A chat started in a space begins with those instructions as the
 * person's first message, because they are the person's words; ideas filed in a space carry its tag.
 * A space also keeps the library pages the person pinned to it, so a chat there starts by reading them.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { containsSensitiveMemoryContent } from '@robota-sdk/agent-framework';

export interface ISpace {
  readonly id: string;
  readonly name: string;
  /** How the person wants the agent to work in this space, in their words. */
  readonly instructions: string;
  /** The tag the space's ideas carry. */
  readonly tag: string;
  /** Library pages pinned to the space, by page id, in pinning order. */
  readonly pages: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ISpaceStore {
  list(): Promise<readonly ISpace[]>;
  get(id: string): Promise<ISpace | undefined>;
  put(space: ISpace): Promise<void>;
  remove(id: string): Promise<void>;
}

export class SpaceRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SpaceRefusedError';
  }
}

const SPACE_ID = /^space-[a-z0-9-]{1,60}$/;
const MAX_PINNED_PAGES = 20;

/** A library page as the opening of a chat names it. */
export interface ISpacePage {
  readonly id: string;
  readonly title: string;
}

/** Spaces written before pages could be pinned have none. */
function withPages(space: ISpace | undefined): ISpace | undefined {
  return space === undefined ? undefined : { ...space, pages: space.pages ?? [] };
}

export function createMemorySpaceStore(): ISpaceStore {
  const spaces = new Map<string, ISpace>();
  return {
    list: async () => [...spaces.values()],
    get: async (id) => spaces.get(id),
    put: async (space) => {
      spaces.set(space.id, space);
    },
    remove: async (id) => {
      spaces.delete(id);
    },
  };
}

/** Spaces in one owner-only `spaces.json`, rewritten atomically. */
export function createFileSpaceStore(directory: string): ISpaceStore {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'spaces.json');
  const read = (): Record<string, ISpace> =>
    existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, ISpace>) : {};
  const write = (spaces: Record<string, ISpace>): void => {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(spaces, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  };
  return {
    list: async () => Object.values(read()),
    get: async (id) => {
      const spaces = read();
      return Object.hasOwn(spaces, id) ? spaces[id] : undefined;
    },
    put: async (space) => {
      if (!SPACE_ID.test(space.id)) throw new Error(`Invalid space id: ${space.id}`);
      write({ ...read(), [space.id]: space });
    },
    remove: async (id) => {
      const { [id]: _removed, ...rest } = read();
      write(rest);
    },
  };
}

function slug(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
}

export class SpaceBook {
  private readonly store: ISpaceStore;
  private readonly now: () => Date;
  private sequence = 0;

  constructor(options: { readonly store: ISpaceStore; readonly now?: () => Date }) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  private check(name: string, instructions: string): void {
    if (name.trim() === '') throw new SpaceRefusedError('A space needs a name');
    if (containsSensitiveMemoryContent(name) || containsSensitiveMemoryContent(instructions)) {
      throw new SpaceRefusedError('This looks like a secret and is not kept in a space');
    }
  }

  async create(input: { readonly name: string; readonly instructions: string }): Promise<ISpace> {
    this.check(input.name, input.instructions);
    const at = this.now().toISOString();
    this.sequence += 1;
    const id = `space-${this.now().getTime().toString(36)}${this.sequence.toString(36)}`;
    const base = slug(input.name);
    // A name with no ASCII letters still needs a tag that stays unique across restarts.
    const tag = base === '' || !/^[a-z0-9-]+$/u.test(base) ? id : base;
    const space: ISpace = {
      id,
      name: input.name.replace(/\s+/gu, ' ').trim(),
      instructions: input.instructions.trim(),
      tag,
      pages: [],
      createdAt: at,
      updatedAt: at,
    };
    await this.store.put(space);
    return space;
  }

  async list(): Promise<readonly ISpace[]> {
    return (await this.store.list())
      .map((space) => withPages(space)!)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<ISpace | undefined> {
    return withPages(await this.store.get(id));
  }

  private async existing(id: string): Promise<ISpace> {
    const space = await this.get(id);
    if (space === undefined) throw new SpaceRefusedError(`No space ${id}`);
    return space;
  }

  /** Pin a library page; the caller has checked that the page exists. Pinning twice is a no-op. */
  async pin(id: string, pageId: string): Promise<ISpace> {
    const space = await this.existing(id);
    if (space.pages.includes(pageId)) return space;
    if (space.pages.length >= MAX_PINNED_PAGES) {
      throw new SpaceRefusedError(`A space keeps at most ${MAX_PINNED_PAGES} pinned pages`);
    }
    const next = { ...space, pages: [...space.pages, pageId], updatedAt: this.now().toISOString() };
    await this.store.put(next);
    return next;
  }

  async unpin(id: string, pageId: string): Promise<ISpace> {
    const space = await this.existing(id);
    const next = {
      ...space,
      pages: space.pages.filter((page) => page !== pageId),
      updatedAt: this.now().toISOString(),
    };
    await this.store.put(next);
    return next;
  }

  async update(
    id: string,
    input: { readonly name: string; readonly instructions: string },
  ): Promise<ISpace> {
    const space = await this.existing(id);
    this.check(input.name, input.instructions);
    const next: ISpace = {
      ...space,
      name: input.name.replace(/\s+/gu, ' ').trim(),
      instructions: input.instructions.trim(),
      updatedAt: this.now().toISOString(),
    };
    await this.store.put(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.existing(id);
    await this.store.remove(id);
  }

  /**
   * The first message of a chat started in the space: the person's own instructions, named as such,
   * and the pinned pages that still exist, by title and id so the agent can read them.
   */
  opening(space: ISpace, pages: readonly ISpacePage[] = []): string {
    const instructions = space.instructions === '' ? '' : `\n\n${space.instructions}`;
    const pinned =
      pages.length === 0
        ? ''
        : `\n\nRead these pages from my library first:\n${pages
            .map((page) => `- ${page.title.replace(/\s+/gu, ' ')} (${page.id})`)
            .join('\n')}`;
    return `Let's work in my space "${space.name}".${instructions}${pinned}`;
  }
}
