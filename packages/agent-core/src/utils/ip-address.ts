/**
 * Address classification for the egress boundary (#2026) — the "is this address public unicast?"
 * half of `egress-policy.ts`, split out so each module holds one job: that one owns the FETCH
 * (scheme, redirects, headers, deadline, byte cap), this one owns the ARITHMETIC of an address.
 *
 * The awkward part lives here on purpose. A literal destination reaches the policy already
 * normalized by `URL` (`2130706433`, `0x7f.1` and `[::ffff:7f00:1]` all collapse to one hostname),
 * but a RESOLVED one does not: `dns.lookup` renders an IPv4-mapped AAAA answer through `inet_ntop`,
 * which prints the dotted spelling `::ffff:127.0.0.1`. So the expansion below accepts BOTH
 * spellings rather than trusting any normalizer to have run — on the resolution path an attacker
 * controls the record. Every "cannot parse" answer is `undefined`/`true`, i.e. NOT public: an
 * address this module cannot read is never treated as reachable.
 *
 * Node-only (`node:net`): reached through `egress-policy.ts`, never the browser barrel.
 */

import { isIP } from 'node:net';

/** True when `ip` (v4 or v6 text) is not a public unicast address. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIpv4(ip.split('.').map(Number));
  if (version === 6) return isPrivateIpv6(ip);
  return true; // not an address at all: never treat it as public
}

function isPrivateIpv4(o: readonly number[]): boolean {
  const [a = 0, b = 0, c = 0] = o;
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, incl. 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast + reserved + broadcast
  );
}

function isPrivateIpv6(ip: string): boolean {
  const groups = expandIpv6(ip);
  if (groups === undefined) return true;
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  const isMapped = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff;
  const isNat64 = g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0;
  if (isMapped || isNat64) {
    return isPrivateIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  // ::/96 in one rule: the unspecified address `::`, loopback `::1`, and the DEPRECATED
  // IPv4-compatible form (`::127.0.0.1`, which `URL` renders as `::7f00:1`) — which embeds an IPv4
  // address just as a mapped one does. None of that range is public unicast.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return true;
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated, still routable)
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * Rewrite a trailing dotted-quad (`::ffff:127.0.0.1`) into the two hex groups it stands for, so the
 * rest of the expansion only ever sees colon groups. `undefined` when the tail is not a valid IPv4
 * address — a refusal, never a guess, because {@link isPrivateIpv6} reads `undefined` as private.
 *
 * This form is not exotic: `URL` normalizes a literal to `[::ffff:7f00:1]`, but `dns.lookup` renders
 * an IPv4-mapped AAAA answer through `inet_ntop`, which prints the dotted form — so it is exactly
 * what arrives on the RESOLUTION path, where an attacker controls the record.
 */
function withoutDottedQuadTail(ip: string): string | undefined {
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (!tail.includes('.')) return ip;
  if (lastColon < 0 || isIP(tail) !== 4) return undefined;
  const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
  const high = ((a << 8) | b).toString(16);
  const low = ((c << 8) | d).toString(16);
  return `${ip.slice(0, lastColon + 1)}${high}:${low}`;
}

/** Expand an IPv6 literal (as `URL` or a resolver renders it, brackets removed) into 8 16-bit groups. */
function expandIpv6(ip: string): number[] | undefined {
  const zoneless = ip.split('%')[0] ?? ip;
  const withoutZone = withoutDottedQuadTail(zoneless);
  if (withoutZone === undefined) return undefined;
  const halves = withoutZone.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string): number[] =>
    part.length === 0 ? [] : part.split(':').map((g) => Number.parseInt(g, 16));
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return undefined;
  const groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  return groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff) ? undefined : groups;
}
