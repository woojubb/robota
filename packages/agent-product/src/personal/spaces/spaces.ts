/**
 * Spaces: one area of the person's life (a trip, a renovation, a job search) with the person's own
 * instructions for working in it. A chat started in a space begins with those instructions as the
 * person's first message, because they are the person's words; ideas filed in a space carry its tag.
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
    const base = slug(input.name);
    const tag = base === '' || !/^[a-z0-9-]+$/u.test(base) ? `space${this.sequence}` : base;
    const space: ISpace = {
      id: `space-${this.now().getTime().toString(36)}${this.sequence.toString(36)}`,
      name: input.name.replace(/\s+/gu, ' ').trim(),
      instructions: input.instructions.trim(),
      tag,
      createdAt: at,
      updatedAt: at,
    };
    await this.store.put(space);
    return space;
  }

  async list(): Promise<readonly ISpace[]> {
    return [...(await this.store.list())].sort((a, b) => a.name.localeCompare(b.name));
  }

  async get(id: string): Promise<ISpace | undefined> {
    return this.store.get(id);
  }

  async update(
    id: string,
    input: { readonly name: string; readonly instructions: string },
  ): Promise<ISpace> {
    const space = await this.store.get(id);
    if (space === undefined) throw new SpaceRefusedError(`No space ${id}`);
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
    if ((await this.store.get(id)) === undefined) throw new SpaceRefusedError(`No space ${id}`);
    await this.store.remove(id);
  }

  /** The first message of a chat started in the space: the person's own instructions, named as such. */
  opening(space: ISpace): string {
    const instructions = space.instructions === '' ? '' : `\n\n${space.instructions}`;
    return `Let's work in my space "${space.name}".${instructions}`;
  }
}
