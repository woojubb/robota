/**
 * Strict decoding of a foreign `mcpServers` object into raw entries and validated definitions
 * (MCP-001).
 *
 * "Strict" means a bad entry is REFUSED and named, never partially built. A half-decoded definition
 * is the shape that later looks like a working server and fails at connection time, where the
 * operator can no longer see which file it came from.
 *
 * Nothing here reads a file or contacts anything: the caller supplies the parsed object and says
 * which source and origin it came from.
 */

import { isAbsolute } from 'node:path';

import { UNSUPPORTED_AUTHENTICATION_KEYS } from '../client/authentication.js';
import type {
  IMCPDefinitionProblem,
  IMCPHeadersHelper,
  IMCPServerDefinition,
  IMCPServerDefinitionRaw,
  TMCPDefinitionSource,
  TMCPTransport,
} from './types.js';

/** What a decode produced: the definitions that are usable, and the entries that are not. */
export interface IMCPDecodeResult {
  readonly definitions: readonly IMCPServerDefinition[];
  readonly problems: readonly IMCPDefinitionProblem[];
}

const REMOTE_TRANSPORTS: ReadonlySet<TMCPTransport> = new Set(['http', 'sse', 'ws']);
const MAX_STDIO_CWD_LENGTH = 16_384;
const MAX_HELPER_FIELD_LENGTH = 16_384;
const MAX_HELPER_ARGS = 128;
const TEMPLATE = /\$\{[^}]*\}/;
const HELPER_ARGV_EXAMPLE = '{"command": "/absolute/path/to/helper", "args": ["--flag"]}';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `streamable-http` is the MCP specification's own name for the transport this repository spells
 * `http`. Both are accepted on input and normalised to `http`, so one spelling reaches the rest of
 * the pipeline and a definition written either way behaves identically.
 */
function normaliseTransport(value: unknown): TMCPTransport | null {
  if (typeof value !== 'string') return null;
  if (value === 'streamable-http') return 'http';
  if (value === 'stdio' || value === 'http' || value === 'sse' || value === 'ws') return value;
  return null;
}

function stringRecord(value: unknown, field: string): Record<string, string> | string {
  if (!isPlainObject(value)) return `\`${field}\` must be an object of string values`;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return `\`${field}.${key}\` must be a string`;
    out[key] = entry;
  }
  return out;
}

function helperField(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= MAX_HELPER_FIELD_LENGTH && !value.includes('\0')
  );
}

/**
 * A header helper as an exact argv. The shell-string form other clients accept is refused with the
 * argv form spelled out, because the host allowlists the exact executable and arguments — a shell
 * line cannot be matched that way. Templates are refused for the same reason, as they are for stdio.
 * Neither refusal quotes the configured text.
 */
function decodeHeadersHelper(value: unknown): IMCPHeadersHelper | string {
  if (typeof value === 'string') {
    return `\`headersHelper\` must be an argv object, not a shell command; write ${HELPER_ARGV_EXAMPLE}`;
  }
  if (!isPlainObject(value)) {
    return `\`headersHelper\` must be an object such as ${HELPER_ARGV_EXAMPLE}`;
  }
  const unknown = Object.keys(value).filter((key) => key !== 'command' && key !== 'args');
  if (unknown.length > 0) return '`headersHelper` accepts only `command` and `args`';
  const command = value['command'];
  if (!helperField(command) || command.trim() === '') {
    return '`headersHelper.command` must be an absolute path to an executable';
  }
  const args = value['args'] ?? [];
  if (
    !Array.isArray(args) ||
    args.length > MAX_HELPER_ARGS ||
    args.some((arg) => !helperField(arg))
  ) {
    return '`headersHelper.args` must be an array of strings';
  }
  if ([command, ...(args as string[])].some((part) => TEMPLATE.test(part))) {
    return '`headersHelper` must not contain `${}` templates; the host allows its exact command and arguments';
  }
  if (!isAbsolute(command)) {
    return '`headersHelper.command` must be an absolute path to an executable';
  }
  return { command, args: [...(args as string[])] };
}

/**
 * Read the entries of one `mcpServers` object.
 *
 * The object itself being wrong is one problem, not one per entry: there are no entries to blame.
 */
export function readRawEntries(
  container: unknown,
  source: TMCPDefinitionSource,
  origin: string,
): { entries: readonly IMCPServerDefinitionRaw[]; problems: readonly IMCPDefinitionProblem[] } {
  if (!isPlainObject(container)) {
    return {
      entries: [],
      problems: [{ name: '', source, origin, reason: 'the configuration root is not an object' }],
    };
  }
  // NO SHAPE FALLBACK. This read was `container['mcpServers'] ?? container`, which made a file
  // spelled `{"servers": {…}}` decode as a server map and report a bogus server named `servers`
  // instead of "this file declares no `mcpServers`" — an OR-fallback in the module whose contract
  // is strict, fail-closed decoding (operational.md § No Fallback Policy).
  const servers = container['mcpServers'];
  if (servers === undefined) {
    return {
      entries: [],
      problems: [{ name: '', source, origin, reason: 'no `mcpServers` key' }],
    };
  }
  if (!isPlainObject(servers)) {
    return {
      entries: [],
      problems: [{ name: '', source, origin, reason: '`mcpServers` is not an object' }],
    };
  }
  const entries: IMCPServerDefinitionRaw[] = [];
  const problems: IMCPDefinitionProblem[] = [];
  for (const [name, entry] of Object.entries(servers)) {
    if (!isPlainObject(entry)) {
      problems.push({ name, source, origin, reason: `entry "${name}" is not an object` });
      continue;
    }
    entries.push({ name, source, origin, entry });
  }
  return { entries, problems };
}

/**
 * Decode one raw entry.
 *
 * Returns the definition, or the problem that stopped it — never both and never a partial. The
 * missing-`type` case is called out explicitly because it is the documented configuration error
 * that reads as a stdio server and then fails at connection time.
 */
export function decodeEntry(
  raw: IMCPServerDefinitionRaw,
): IMCPServerDefinition | IMCPDefinitionProblem {
  const { name, source, origin, entry } = raw;
  const problem = (reason: string): IMCPDefinitionProblem => ({ name, source, origin, reason });

  const transport = normaliseTransport(entry['type']);
  if (transport === null) {
    if (entry['type'] === undefined) {
      return problem(
        entry['url'] === undefined
          ? 'no `type`; a definition must name stdio, http, sse or ws'
          : 'no `type`, but a `url` is present — declare `"type": "http"`, `"sse"` or `"ws"` rather than letting it read as stdio',
      );
    }
    return problem(`unknown transport ${JSON.stringify(entry['type'])}`);
  }

  const definition: {
    -readonly [K in keyof IMCPServerDefinition]: IMCPServerDefinition[K];
  } = { name, source, origin, transport };

  if (transport === 'stdio') {
    const command = entry['command'];
    if (typeof command !== 'string' || command.trim() === '') {
      return problem('a stdio definition needs a non-empty `command`');
    }
    definition.command = command;
    const args = entry['args'];
    if (args !== undefined) {
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
        return problem('`args` must be an array of strings');
      }
      definition.args = args as readonly string[];
    }
    const cwd = entry['cwd'];
    if (cwd !== undefined) {
      if (
        typeof cwd !== 'string' ||
        cwd.trim() === '' ||
        cwd.length > MAX_STDIO_CWD_LENGTH ||
        cwd.includes('\0')
      ) {
        return problem('`cwd` must be a bounded non-empty string without NUL');
      }
      definition.cwd = cwd;
    }
    if (entry['url'] !== undefined) return problem('a stdio definition must not carry a `url`');
    if (entry['headersHelper'] !== undefined) {
      return problem('a stdio definition must not carry `headersHelper`');
    }
  } else {
    const url = entry['url'];
    if (typeof url !== 'string' || url.trim() === '') {
      return problem(`a ${transport} definition needs a non-empty \`url\``);
    }
    definition.url = url;
    if (entry['command'] !== undefined) {
      return problem(`a ${transport} definition must not carry a \`command\``);
    }
    // The fourth cross-transport pair. Without it, `{"type":"http","url":…,"args":[…]}` decoded
    // CLEANLY and dropped `args` on the floor: a stdio entry mistyped as `http` lost its whole
    // command line with nothing said. Its three siblings were each refused by name; this one was
    // the gap, and a silently discarded field is exactly the "partially built" entry the header
    // above says never happens.
    if (entry['args'] !== undefined) {
      return problem(`a ${transport} definition must not carry \`args\``);
    }
    if (entry['cwd'] !== undefined) {
      return problem(`a ${transport} definition must not carry \`cwd\``);
    }
    // `env` is deliberately NOT refused alongside it, and the asymmetry is the point: `env` is
    // stored and carried on a remote definition (see the shared block below), so it is visible in
    // a projection and hashed into the fingerprint. Nothing is silently lost, which is the only
    // property this module promises. Whether a remote transport should ACT on it is MCP-002's
    // question, and answering it here by rejecting the field would decide it early.
    const headers = entry['headers'];
    if (headers !== undefined) {
      const decoded = stringRecord(headers, 'headers');
      if (typeof decoded === 'string') return problem(decoded);
      definition.headers = decoded;
    }
    const helper = entry['headersHelper'];
    if (helper !== undefined) {
      const decoded = decodeHeadersHelper(helper);
      if (typeof decoded === 'string') return problem(decoded);
      definition.headersHelper = decoded;
    }
  }

  if (entry['headers'] !== undefined && transport === 'stdio') {
    return problem('a stdio definition must not carry `headers`');
  }

  const env = entry['env'];
  if (env !== undefined) {
    const decoded = stringRecord(env, 'env');
    if (typeof decoded === 'string') return problem(decoded);
    definition.env = decoded;
  }

  const timeout = entry['timeout'];
  if (timeout !== undefined) {
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0) {
      return problem('`timeout` must be a positive number of milliseconds');
    }
    definition.timeout = timeout;
  }

  if (REMOTE_TRANSPORTS.has(transport) && definition.url === undefined) {
    return problem(`a ${transport} definition needs a \`url\``);
  }

  // Declared authentication this version cannot perform is kept, not ignored: the server stays
  // listed, and admission refuses it by name instead of connecting without the credential.
  const unsupported = UNSUPPORTED_AUTHENTICATION_KEYS.filter((key) => entry[key] !== undefined);
  if (unsupported.length > 0) {
    // Only a remote server authenticates this way; on a stdio entry the keys mean nothing.
    if (transport === 'stdio') {
      return problem(`a stdio definition must not carry \`${unsupported.join('`, `')}\``);
    }
    definition.unsupportedAuthentication = unsupported;
  }

  return definition;
}

/** Decode a whole `mcpServers` container from one source. */
export function decodeSource(
  container: unknown,
  source: TMCPDefinitionSource,
  origin: string,
): IMCPDecodeResult {
  const { entries, problems } = readRawEntries(container, source, origin);
  const definitions: IMCPServerDefinition[] = [];
  const all: IMCPDefinitionProblem[] = [...problems];
  for (const raw of entries) {
    const decoded = decodeEntry(raw);
    if ('reason' in decoded) all.push(decoded);
    else definitions.push(decoded);
  }
  return { definitions, problems: all };
}
