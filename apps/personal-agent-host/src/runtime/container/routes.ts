import { bridgePrefix, cidrsOverlap, ipFromInt } from './names.js';

export interface IHostRoute {
  iface: string;
  cidr: string;
}

function littleEndian(hex: string): number {
  return Number.parseInt(hex.match(/../gu)?.reverse().join('') ?? '0', 16);
}

/** `/proc/net/route` of the engine host: hex, little-endian, one route per line. */
export function parseHostRoutes(text: string): IHostRoute[] {
  const routes: IHostRoute[] = [];
  for (const line of text.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length < 8 || !/^[0-9A-Fa-f]{8}$/u.test(fields[1] ?? '')) continue;
    const mask = littleEndian(fields[7] ?? '');
    if (mask === 0) continue; // the default route says nothing about where a subnet may go
    const prefix = 32 - Math.log2(2 ** 32 - mask);
    routes.push({
      iface: fields[0] ?? '',
      cidr: `${ipFromInt(littleEndian(fields[1] ?? ''))}/${prefix}`,
    });
  }
  return routes;
}

/** The first route a subnet would shadow or be shadowed by, ignoring this install's own bridges. */
export function conflictingRoute(
  routes: readonly IHostRoute[],
  installId: string,
  cidr: string,
): IHostRoute | undefined {
  const own = bridgePrefix(installId);
  return routes.find((route) => !route.iface.startsWith(own) && cidrsOverlap(route.cidr, cidr));
}
