/**
 * Services a person may choose to add: suggested values for the add form, never a connection. An entry
 * is accepted only if the connector it stands for could be created, so a suggestion can never fill the
 * form with something the book would refuse. Everything in an entry is text somebody else wrote: it is
 * shown to the person and never handed to the model.
 */
import { ConnectorRefusedError, checkConnectorInput } from './book.js';
import { CONNECTOR_AUTHS, CONNECTOR_KINDS } from './types.js';

import type { ICreateConnectorInput } from './book.js';
import type { TConnectorAuth, TConnectorKind } from './types.js';

export interface IConnectorCatalogEntry {
  readonly title: string;
  readonly endpoint: string;
  readonly kind: TConnectorKind;
  /** How the service is expected to be signed in to; the person can change it before adding. */
  readonly auth: TConnectorAuth;
  readonly tokenHeader?: string;
  /**
   * A client the owner registered with the service for this agent, so a person need not register one:
   * only the owner's file can carry it. The client's secret, if it has one, is never in a suggestion;
   * the person types it at sign-in.
   */
  readonly oauth?: {
    readonly clientId?: string;
    readonly scopes?: readonly string[];
    readonly authorizationParams?: Readonly<Record<string, string>>;
  };
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

const FORMATTING = /^\p{Cf}$/u;
const JOINER = /^[‌‍]$/u;
const WORD_OR_EMOJI = /^[\p{L}\p{M}\p{N}\p{Extended_Pictographic}\p{Emoji_Modifier}️]$/u;

/**
 * Invisible formatting (direction overrides, zero-width marks) can make a name read as another, so
 * it is removed. A zero-width joiner or non-joiner stays only between two word or emoji characters
 * of the original text: it changes how a word in some scripts, and an emoji sequence, is drawn.
 */
function withoutInvisibleFormatting(characters: readonly string[]): string {
  return characters
    .filter((character, index) => {
      if (!FORMATTING.test(character)) return true;
      if (!JOINER.test(character)) return false;
      const before = characters[index - 1];
      const after = characters[index + 1];
      return (
        before !== undefined &&
        after !== undefined &&
        WORD_OR_EMOJI.test(before) &&
        WORD_OR_EMOJI.test(after)
      );
    })
    .join('');
}

/** Text of somebody else's, as one plain line of at most `limit` characters. */
function plain(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const collapsed = withoutInvisibleFormatting(
    [...value].map((character) => (isControl(character) ? ' ' : character)),
  )
    .replace(/\s+/gu, ' ')
    .trim();
  // Clipped to `limit` UTF-16 units, the length the connector book checks, without cutting a
  // character in two; a joiner the clip leaves last joins nothing.
  let clipped = '';
  for (const character of collapsed) {
    if (clipped.length + character.length > limit) break;
    clipped += character;
  }
  const line = clipped.replace(/[‌‍]+$/u, '').trim();
  return line === '' ? undefined : line;
}

/** The sign-in settings of a raw record, or `invalid` when they are not the shapes a connector takes. */
function oauthOf(value: unknown): ICreateConnectorInput['oauth'] | 'invalid' | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return 'invalid';
  const { clientId, scopes, authorizationParams } = value;
  if (clientId !== undefined && typeof clientId !== 'string') return 'invalid';
  if (
    scopes !== undefined &&
    !(Array.isArray(scopes) && scopes.every((scope) => typeof scope === 'string'))
  ) {
    return 'invalid';
  }
  if (
    authorizationParams !== undefined &&
    !(
      isRecord(authorizationParams) &&
      Object.values(authorizationParams).every((v) => typeof v === 'string')
    )
  ) {
    return 'invalid';
  }
  return {
    ...(clientId !== undefined && { clientId }),
    ...(scopes !== undefined && { scopes: scopes as string[] }),
    ...(authorizationParams !== undefined && {
      authorizationParams: authorizationParams as Record<string, string>,
    }),
  };
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
  // A client belongs to whoever registered it: the owner's file may name one, a registry never does.
  const oauth = source === 'file' ? oauthOf(raw['oauth']) : undefined;
  if (
    oauth === 'invalid' ||
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
      ...(oauth !== undefined && { oauth }),
    });
    return {
      title: checked.title,
      endpoint: checked.endpoint,
      kind: kind as TConnectorKind,
      auth: checked.auth,
      ...(checked.tokenHeader !== undefined && { tokenHeader: checked.tokenHeader }),
      ...(checked.oauth !== undefined && { oauth: checked.oauth }),
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
  for (const remote of remotes) {
    // A remote whose address still has a variable in it needs the person's value first: not offered.
    if (
      !isRecord(remote) ||
      remote['type'] !== 'streamable-http' ||
      typeof remote['url'] !== 'string' ||
      remote['url'].includes('{')
    ) {
      continue;
    }
    const signIn = signInOf(remote['headers']);
    if (signIn === undefined) continue;
    const entry = catalogEntryOf(
      {
        title: server['title'] ?? server['name'],
        description: server['description'],
        endpoint: remote['url'],
        auth: signIn.auth,
        ...(signIn.tokenHeader !== undefined && { tokenHeader: signIn.tokenHeader }),
      },
      'registry',
    );
    // The first remote that can be signed in to and added is the one offered.
    if (entry !== undefined) return entry;
  }
  return undefined;
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
