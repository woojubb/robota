/**
 * The person's connectors: what they connected, kept in one owner-only `connectors.json`. A record
 * holds no credential — a service address that carries one is refused — so the file is as safe to
 * read and back up as the person's other state.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { containsSensitiveMemoryContent } from '@robota-sdk/agent-framework';

import { CONNECTOR_KINDS } from './types.js';

import type { IConnector, TConnectorKind, TToolDecision } from './types.js';

export interface IConnectorStore {
  list(): Promise<readonly IConnector[]>;
  get(id: string): Promise<IConnector | undefined>;
  put(connector: IConnector): Promise<void>;
  remove(id: string): Promise<void>;
}

export class ConnectorRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ConnectorRefusedError';
  }
}

const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/;
const PROTOCOL = /^[a-z][a-z0-9-]{0,30}$/;
/** The characters RFC 6749 allows in one scope token. */
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]{1,200}$/;
const MAX_TITLE = 80;
const MAX_DECISIONS = 200;
const MAX_TOOL_NAME = 128;

export function createMemoryConnectorStore(): IConnectorStore {
  const connectors = new Map<string, IConnector>();
  return {
    list: async () => [...connectors.values()],
    get: async (id) => connectors.get(id),
    put: async (connector) => {
      connectors.set(connector.id, connector);
    },
    remove: async (id) => {
      connectors.delete(id);
    },
  };
}

/** Connectors in one owner-only `connectors.json`, rewritten atomically. */
export function createFileConnectorStore(directory: string): IConnectorStore {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'connectors.json');
  const read = (): Record<string, IConnector> =>
    existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, IConnector>) : {};
  const write = (connectors: Record<string, IConnector>): void => {
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(connectors, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  };
  return {
    list: async () => Object.values(read()),
    get: async (id) => {
      const connectors = read();
      return Object.hasOwn(connectors, id) ? connectors[id] : undefined;
    },
    put: async (connector) => {
      if (!CONNECTOR_ID.test(connector.id))
        throw new Error(`Invalid connector id: ${connector.id}`);
      write({ ...read(), [connector.id]: connector });
    },
    remove: async (id) => {
      const { [id]: _removed, ...rest } = read();
      write(rest);
    },
  };
}

function slug(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 30);
}

/** An endpoint the person typed, as the address a service is reached at; refused when it could carry a secret. */
function checkEndpoint(endpoint: string): string {
  if (!URL.canParse(endpoint)) throw new ConnectorRefusedError('The endpoint is not an address');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new ConnectorRefusedError('The endpoint must be https');
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new ConnectorRefusedError(
      'The endpoint carries no credential, query or fragment: signing in is how a connector gets access',
    );
  }
  return url.href;
}

export interface ICreateConnectorInput {
  readonly title: string;
  readonly kind: TConnectorKind;
  readonly protocol: string;
  readonly endpoint: string;
  readonly oauth?: { readonly clientId?: string; readonly scopes?: readonly string[] };
}

export class ConnectorBook {
  private readonly store: IConnectorStore;
  private readonly now: () => Date;
  private sequence = 0;

  constructor(options: { readonly store: IConnectorStore; readonly now?: () => Date }) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
  }

  async create(input: ICreateConnectorInput): Promise<IConnector> {
    const title = input.title.replace(/\s+/gu, ' ').trim();
    if (title === '' || title.length > MAX_TITLE) {
      throw new ConnectorRefusedError(`A connector needs a name of 1 to ${MAX_TITLE} characters`);
    }
    if (containsSensitiveMemoryContent(title)) {
      throw new ConnectorRefusedError('This looks like a secret and is not kept as a name');
    }
    if (!CONNECTOR_KINDS.includes(input.kind)) {
      throw new ConnectorRefusedError(`kind must be one of ${CONNECTOR_KINDS.join(', ')}`);
    }
    if (!PROTOCOL.test(input.protocol)) throw new ConnectorRefusedError('Unknown protocol name');
    const endpoint = checkEndpoint(input.endpoint);
    const oauth = this.checkOAuth(input.oauth);
    const at = this.now().toISOString();
    this.sequence += 1;
    const unique = `${this.now().getTime().toString(36)}${this.sequence.toString(36)}`;
    const base = slug(title);
    const connector: IConnector = {
      id: `connector-${base === '' ? '' : `${base}-`}${unique}`,
      title,
      kind: input.kind,
      protocol: input.protocol,
      endpoint,
      ...(oauth !== undefined && { oauth }),
      decisions: {},
      createdAt: at,
      updatedAt: at,
    };
    await this.store.put(connector);
    return connector;
  }

  private checkOAuth(oauth: ICreateConnectorInput['oauth']): IConnector['oauth'] | undefined {
    if (oauth === undefined) return undefined;
    const { clientId, scopes } = oauth;
    if (
      clientId !== undefined &&
      (clientId === '' || /\s/u.test(clientId) || clientId.length > 256)
    ) {
      throw new ConnectorRefusedError('The client id must be one word of at most 256 characters');
    }
    if (scopes !== undefined && !scopes.every((scope) => SCOPE_TOKEN.test(scope))) {
      throw new ConnectorRefusedError('Each scope must be a single scope word');
    }
    if (clientId === undefined && (scopes === undefined || scopes.length === 0)) return undefined;
    return {
      ...(clientId !== undefined && { clientId }),
      ...(scopes !== undefined && scopes.length > 0 && { scopes: [...scopes] }),
    };
  }

  async list(): Promise<readonly IConnector[]> {
    return [...(await this.store.list())].sort((a, b) => a.title.localeCompare(b.title));
  }

  get(id: string): Promise<IConnector | undefined> {
    return this.store.get(id);
  }

  async existing(id: string): Promise<IConnector> {
    const connector = await this.store.get(id);
    if (connector === undefined) throw new ConnectorRefusedError(`No connector ${id}`);
    return connector;
  }

  /** Record the person's decision about one tool, or clear it with `undefined`. */
  async decide(id: string, tool: string, decision: TToolDecision | undefined): Promise<IConnector> {
    const connector = await this.existing(id);
    if (tool === '' || tool.length > MAX_TOOL_NAME) {
      throw new ConnectorRefusedError(`A tool name has 1 to ${MAX_TOOL_NAME} characters`);
    }
    const { [tool]: _previous, ...rest } = connector.decisions;
    if (decision !== undefined && Object.keys(rest).length >= MAX_DECISIONS) {
      throw new ConnectorRefusedError(`At most ${MAX_DECISIONS} tool decisions are kept`);
    }
    const next: IConnector = {
      ...connector,
      decisions: decision === undefined ? rest : { ...rest, [tool]: decision },
      updatedAt: this.now().toISOString(),
    };
    await this.store.put(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.existing(id);
    await this.store.remove(id);
  }
}
