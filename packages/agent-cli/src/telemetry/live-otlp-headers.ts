/**
 * Static OTLP request headers from Robota telemetry settings. Header values are usually
 * credentials, so every error names only the setting and, for an entry, its 1-based position.
 */

export type TOtlpHeaderMap = Readonly<Record<string, string>>;

const MAX_SETTING_BYTES = 8192;
const MAX_ENTRIES = 32;
const MAX_NAME_BYTES = 128;
const MAX_VALUE_BYTES = 4096;
const MAX_MERGED_BYTES = 8192;

/** RFC 9110 token. `%` is deliberately absent: names are never percent-decoded. */
const TOKEN = /^[!#$&'*+.^_`|~0-9A-Za-z-]+$/u;
/** Visible ASCII, space and tab only — no control characters, no non-ASCII. */
const SAFE_VALUE = /^[\x20-\x7E\t]*$/u;

/** Transport, content negotiation and trace propagation belong to the exporter, never to a setting. */
const RESERVED_NAMES = new Set([
  'content-type', 'content-length', 'content-encoding', 'transfer-encoding', 'host', 'connection',
  'keep-alive', 'upgrade', 'te', 'trailer', 'expect', 'accept', 'accept-encoding',
  'traceparent', 'tracestate', 'baggage',
]);

function invalidSetting(variable: string, entry?: number): Error {
  return new Error(entry === undefined
    ? `Invalid Robota telemetry header setting ${variable}.`
    : `Invalid Robota telemetry header setting ${variable} (entry ${entry}).`);
}

function freezeHeaderMap(entries: Iterable<readonly [string, string]>): TOtlpHeaderMap {
  const map = Object.create(null) as Record<string, string>;
  for (const [name, value] of entries) map[name] = value;
  return Object.freeze(map);
}

/** Parse OTel's `name=value,name2=value2` form; values are percent-decoded, names never are. */
export function parseOtlpHeaderSetting(variable: string, raw: string): TOtlpHeaderMap {
  if (Buffer.byteLength(raw, 'utf8') > MAX_SETTING_BYTES) throw invalidSetting(variable);
  const entries = raw.split(',');
  if (entries.length > MAX_ENTRIES) throw invalidSetting(variable);
  const headers = new Map<string, string>();
  entries.forEach((entry, index) => {
    const position = index + 1;
    const separator = entry.indexOf('=');
    if (entry.trim() === '' || separator < 0) throw invalidSetting(variable, position);
    const name = entry.slice(0, separator).trim();
    const encoded = entry.slice(separator + 1).trim();
    if (name === '' || encoded === '' || name.includes('%') ||
      name.length > MAX_NAME_BYTES || !TOKEN.test(name)) {
      throw invalidSetting(variable, position);
    }
    let value: string;
    try { value = decodeURIComponent(encoded); }
    catch { throw invalidSetting(variable, position); }
    if (value === '' || value.length > MAX_VALUE_BYTES || !SAFE_VALUE.test(value) ||
      /^[ \t]|[ \t]$/u.test(value)) {
      throw invalidSetting(variable, position);
    }
    const lower = name.toLowerCase();
    if (RESERVED_NAMES.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-') ||
      headers.has(lower)) {
      throw invalidSetting(variable, position);
    }
    headers.set(lower, value);
  });
  return freezeHeaderMap(headers);
}

/**
 * Later maps win on a shared name. Names are already lowercased, so the override is
 * case-insensitive. `variables` are only for the error, which names the settings involved.
 */
export function mergeOtlpHeaderMaps(variables: readonly string[], ...maps: readonly TOtlpHeaderMap[]): TOtlpHeaderMap {
  const merged = new Map<string, string>();
  for (const map of maps) for (const name of Object.keys(map)) merged.set(name, map[name]!);
  let bytes = 0;
  // Header names and values are ASCII after validation, so length is their byte size on the wire.
  for (const [name, value] of merged) bytes += name.length + value.length + 4;
  if (bytes > MAX_MERGED_BYTES) {
    throw new Error(`Robota telemetry headers from ${variables.join(' and ')} exceed the size limit.`);
  }
  return freezeHeaderMap(merged);
}

/** Built once at startup; a runtime that disagrees with this validation fails with a fixed message. */
export function buildOtlpRequestHeaders(variables: readonly string[], map: TOtlpHeaderMap): Headers {
  try {
    return new Headers(Object.keys(map).map((name) => [name, map[name]!] as [string, string]));
  } catch {
    throw new Error(`Robota telemetry headers from ${variables.join(' and ')} could not be prepared.`);
  }
}

/** Every sender copies the prebuilt headers and sets its own content type last. */
export function otlpProtobufRequestHeaders(headers: Headers | undefined): Headers {
  const request = new Headers(headers);
  request.set('content-type', 'application/x-protobuf');
  return request;
}
