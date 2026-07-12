/**
 * Browser ICE-config decoder + validator (REMOTE-010). The `ice` pairing-URL query param is a base64url-encoded
 * JSON `RTCIceServer[]`. It is **attacker-influenceable** (anyone who crafts a pairing link controls it), so the
 * decoded value MUST be validated into a well-formed `RTCIceServer[]` (sane URL schemes) and **fail closed** on
 * malformed input — never a loose cast into `RTCConfiguration`. Browser-local (agent-web-ui takes no dependency on
 * the node validators in agent-cli / agent-transport-webrtc).
 */

const ICE_URL_SCHEME = /^(stuns?|turns?):/i;

/** Decode a base64url string to a proper UTF-8 string (so non-ASCII TURN creds survive). Throws on malformed base64. */
function base64UrlToUtf8(b64url: string): string {
  const b64 = b64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const binary = atob(b64); // latin1 bytes
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function validateUrl(url: unknown, where: string): string {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error(`Invalid ice param: ${where} must be a non-empty url string.`);
  }
  if (!ICE_URL_SCHEME.test(url)) {
    throw new Error(
      `Invalid ice param: ${where} "${url}" must use a stun:/stuns:/turn:/turns: scheme.`,
    );
  }
  return url;
}

function validateServer(entry: unknown, index: number): RTCIceServer {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`Invalid ice param: iceServers[${index}] must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  const rawUrls = record.urls;
  const urls = Array.isArray(rawUrls)
    ? rawUrls.map((u, i) => validateUrl(u, `iceServers[${index}].urls[${i}]`))
    : validateUrl(rawUrls, `iceServers[${index}].urls`);
  const server: RTCIceServer = { urls };
  if (record.username !== undefined) {
    if (typeof record.username !== 'string') {
      throw new Error(`Invalid ice param: iceServers[${index}].username must be a string.`);
    }
    server.username = record.username;
  }
  if (record.credential !== undefined) {
    if (typeof record.credential !== 'string') {
      throw new Error(`Invalid ice param: iceServers[${index}].credential must be a string.`);
    }
    server.credential = record.credential;
  }
  return server;
}

/** Decode + validate the `ice` query param → `RTCIceServer[]`. Throws (fail-closed) on any malformed input. */
export function parseIceServersParam(encoded: string): RTCIceServer[] {
  let decoded: string;
  try {
    decoded = base64UrlToUtf8(encoded);
  } catch {
    throw new Error('Invalid ice param: not valid base64url.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('Invalid ice param: not valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid ice param: must be a JSON array of RTCIceServer.');
  }
  return parsed.map((entry, index) => validateServer(entry, index));
}

/** True when any server is a TURN (`turn:`/`turns:`) server. */
export function iceHasTurn(iceServers: readonly RTCIceServer[] | undefined): boolean {
  if (!iceServers) return false;
  return iceServers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    return urls.some((u) => /^turns?:/i.test(u));
  });
}
