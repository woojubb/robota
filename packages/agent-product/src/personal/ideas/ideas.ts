/**
 * Ideas: thoughts kept for later, by the person or suggested by the agent. An idea the agent
 * suggests is marked as a suggestion and stays one until the person takes it up; the agent never acts
 * on an idea by itself. Taking one up (into a goal, for instance) is recorded on the idea.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { containsSensitiveMemoryContent } from '@robota-sdk/agent-framework';

export type TIdeaOrigin = 'owner' | 'agent';
export type TIdeaStatus = 'open' | 'taken-up' | 'archived';

export interface IIdea {
  readonly id: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly origin: TIdeaOrigin;
  readonly status: TIdeaStatus;
  /** What the idea became, such as the goal it was turned into. */
  readonly takenUpAs?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Where ideas live; a host supplies one per principal. */
export interface IIdeaStore {
  list(): Promise<readonly IIdea[]>;
  get(id: string): Promise<IIdea | undefined>;
  put(idea: IIdea): Promise<void>;
  remove(id: string): Promise<void>;
}

export class IdeaRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'IdeaRefusedError';
  }
}

const IDEA_ID = /^idea-[a-z0-9]{1,40}$/;
const TAG = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,39}$/u;

export function createMemoryIdeaStore(): IIdeaStore {
  const ideas = new Map<string, IIdea>();
  return {
    list: async () => [...ideas.values()],
    get: async (id) => ideas.get(id),
    put: async (idea) => {
      ideas.set(idea.id, idea);
    },
    remove: async (id) => {
      ideas.delete(id);
    },
  };
}

/** Ideas in one owner-only `ideas.json`, rewritten atomically. */
export function createFileIdeaStore(directory: string): IIdeaStore {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'ideas.json');
  const read = (): Record<string, IIdea> =>
    existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, IIdea>) : {};
  const write = (ideas: Record<string, IIdea>): void => {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(ideas, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  };
  return {
    list: async () => Object.values(read()),
    get: async (id) => {
      const ideas = read();
      return Object.hasOwn(ideas, id) ? ideas[id] : undefined;
    },
    put: async (idea) => {
      if (!IDEA_ID.test(idea.id)) throw new Error(`Invalid idea id: ${idea.id}`);
      write({ ...read(), [idea.id]: idea });
    },
    remove: async (id) => {
      const { [id]: _removed, ...rest } = read();
      write(rest);
    },
  };
}

export interface IIdeaBookOptions {
  readonly store: IIdeaStore;
  readonly now?: () => Date;
}

export class IdeaBook {
  private readonly store: IIdeaStore;
  private readonly now: () => Date;
  private sequence = 0;

  constructor(options: IIdeaBookOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  private async require(id: string): Promise<IIdea> {
    const idea = await this.store.get(id);
    if (idea === undefined) throw new IdeaRefusedError(`No idea ${id}`);
    return idea;
  }

  async add(input: {
    readonly text: string;
    readonly tags?: readonly string[];
    readonly origin: TIdeaOrigin;
  }): Promise<IIdea> {
    const text = input.text.trim();
    if (text === '') throw new IdeaRefusedError('An idea needs some text');
    if (containsSensitiveMemoryContent(text))
      throw new IdeaRefusedError('This looks like a secret and is not kept as an idea');
    const tags = [
      ...new Set(
        (input.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== ''),
      ),
    ];
    const bad = tags.find((tag) => !TAG.test(tag));
    if (bad !== undefined) throw new IdeaRefusedError(`Not a tag: ${bad}`);
    const at = this.now().toISOString();
    this.sequence += 1;
    const idea: IIdea = {
      id: `idea-${this.now().getTime().toString(36)}${this.sequence.toString(36)}`,
      text,
      tags,
      origin: input.origin,
      status: 'open',
      createdAt: at,
      updatedAt: at,
    };
    await this.store.put(idea);
    return idea;
  }

  /** Ideas newest first; archived ones only when asked. */
  async list(
    options: { readonly tag?: string; readonly includeArchived?: boolean } = {},
  ): Promise<readonly IIdea[]> {
    return (await this.store.list())
      .filter((idea) => options.includeArchived === true || idea.status !== 'archived')
      .filter((idea) => options.tag === undefined || idea.tags.includes(options.tag.toLowerCase()))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  }

  async get(id: string): Promise<IIdea | undefined> {
    return this.store.get(id);
  }

  /** The person took the idea up; `as` names what it became. */
  async takeUp(id: string, as: string): Promise<IIdea> {
    const idea = await this.require(id);
    if (idea.status !== 'open')
      throw new IdeaRefusedError('This idea was already taken up or archived');
    const next: IIdea = {
      ...idea,
      status: 'taken-up',
      takenUpAs: as,
      updatedAt: this.now().toISOString(),
    };
    await this.store.put(next);
    return next;
  }

  async archive(id: string): Promise<IIdea> {
    const idea = await this.require(id);
    const next: IIdea = { ...idea, status: 'archived', updatedAt: this.now().toISOString() };
    await this.store.put(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.require(id);
    await this.store.remove(id);
  }
}
