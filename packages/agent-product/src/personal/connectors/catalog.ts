/**
 * Services a person may choose to add: suggested values for the add form, never a connection. An entry
 * is accepted only if the connector it stands for could be created, so a suggestion can never fill the
 * form with something the book would refuse. Everything in an entry is text somebody else wrote: it is
 * shown to the person and never handed to the model.
 */
import { ConnectorRefusedError, checkConnectorInput } from './book.js';
import { CONNECTOR_AUTHS, CONNECTOR_KINDS } from './types.js';

import type { TConnectorAuth, TConnectorKind } from './types.js';

export interface IConnectorCatalogEntry {
  readonly title: string;
  readonly endpoint: string;
  readonly kind: TConnectorKind;
  /** How the service is expected to be signed in to; the person can change it before adding. */
  readonly auth: TConnectorAuth;
  readonly tokenHeader?: string;
  readonly description?: string;
  /** Where the suggestion came from, as a word the page shows. */
  readonly source: string;
}

const MAX_TITLE = 80;
const MAX_DESCRIPTION = 300;
/** The status word a registry gives a server that is still offered; anything else is withdrawn or deprecated. */
const ACTIVE = 'active';
const REGISTRY_META = 'io.modelcontextprotocol.registry/official';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isControl = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
};

/** Text of somebody else's, as one plain line of at most `limit` characters. */
function plain(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = [...value]
    .map((character) => (isControl(character) ? ' ' : character))
    .join('')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, limit)
    .trim();
  return line === '' ? undefined : line;
}

/**
 * A catalog entry from one raw record, or `undefined` when the record is not a suggestion the book
 * would accept (a missing or unusable address, an unknown sign-in way, a header the connection owns).
 */
export function catalogEntryOf(raw: unknown, source: string): IConnectorCatalogEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const title = plain(raw['title'], MAX_TITLE);
  const description = plain(raw['description'], MAX_DESCRIPTION);
  const kind = raw['kind'] ?? 'other';
  const auth = raw['auth'] ?? 'oauth';
  const tokenHeader = raw['tokenHeader'];
  if (
    title === undefined ||
    typeof raw['endpoint'] !== 'string' ||
    !CONNECTOR_KINDS.includes(kind as TConnectorKind) ||
    !CONNECTOR_AUTHS.includes(auth as TConnectorAuth) ||
    (tokenHeader !== undefined && typeof tokenHeader !== 'string')
  ) {
    return undefined;
  }
  try {
    const checked = checkConnectorInput({
      title,
      kind: kind as TConnectorKind,
      protocol: 'mcp',
      endpoint: raw['endpoint'],
      auth: auth as TConnectorAuth,
      ...(tokenHeader !== undefined && { tokenHeader }),
    });
    return {
      title: checked.title,
      endpoint: checked.endpoint,
      kind: kind as TConnectorKind,
      auth: checked.auth,
      ...(checked.tokenHeader !== undefined && { tokenHeader: checked.tokenHeader }),
      ...(description !== undefined && { description }),
      source,
    };
  } catch (error) {
    // allow-fallback: a suggestion the book would refuse is left out of the list; it is somebody else's data.
    if (error instanceof ConnectorRefusedError) return undefined;
    throw error;
  }
}

/**
 * How a registry's remote asks to be signed in to, in the ways a connector can: no required header
 * means the usual OAuth sign-in; one required secret header that carries a bearer token or the token
 * alone means a token. Anything else (several required headers, a fixed non-secret header, another
 * scheme) cannot be filled in by pasting one token, so the entry is not offered.
 */
function signInOf(headers: unknown): { auth: TConnectorAuth; tokenHeader?: string } | undefined {
  const required = Array.isArray(headers)
    ? headers.filter((header) => isRecord(header) && header['isRequired'] === true)
    : [];
  if (required.length === 0) return { auth: 'oauth' };
  const [header] = required;
  if (required.length > 1 || !isRecord(header) || header['isSecret'] !== true) return undefined;
  const name = typeof header['name'] === 'string' ? header['name'] : '';
  const value = typeof header['value'] === 'string' ? header['value'] : undefined;
  if (name.toLowerCase() === 'authorization') {
    return value === undefined || /^Bearer \{[^{}]+\}$/iu.test(value)
      ? { auth: 'token' }
      : undefined;
  }
  return value === undefined || /^\{[^{}]+\}$/u.test(value)
    ? { auth: 'token', tokenHeader: name }
    : undefined;
}

function entryFromServer(item: unknown): IConnectorCatalogEntry | undefined {
  if (!isRecord(item) || !isRecord(item['server'])) return undefined;
  const server = item['server'];
  const meta = isRecord(item['_meta']) ? item['_meta'][REGISTRY_META] : undefined;
  const status = isRecord(meta) ? meta['status'] : undefined;
  if (typeof status === 'string' && status !== ACTIVE) return undefined;
  const remotes = Array.isArray(server['remotes']) ? server['remotes'] : [];
  // A remote whose address still has a variable in it needs the person's value first: not offered.
  const remote = remotes.find(
    (candidate) =>
      isRecord(candidate) &&
      candidate['type'] === 'streamable-http' &&
      typeof candidate['url'] === 'string' &&
      !candidate['url'].includes('{'),
  );
  if (!isRecord(remote)) return undefined;
  const signIn = signInOf(remote['headers']);
  if (signIn === undefined) return undefined;
  return catalogEntryOf(
    {
      title: server['title'] ?? server['name'],
      description: server['description'],
      endpoint: remote['url'],
      auth: signIn.auth,
      ...(signIn.tokenHeader !== undefined && { tokenHeader: signIn.tokenHeader }),
    },
    'registry',
  );
}

/** The services of one page of a registry's answer that can be added here, one entry per address. */
export function catalogEntriesFromRegistry(page: unknown): IConnectorCatalogEntry[] {
  const servers = isRecord(page) ? page['servers'] : undefined;
  if (!Array.isArray(servers)) return [];
  const seen = new Set<string>();
  const entries: IConnectorCatalogEntry[] = [];
  for (const item of servers) {
    const entry = entryFromServer(item);
    if (entry === undefined || seen.has(entry.endpoint)) continue;
    seen.add(entry.endpoint);
    entries.push(entry);
  }
  return entries;
}
