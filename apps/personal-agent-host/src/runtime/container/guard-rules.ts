import { bridgePrefix, GUI_PORT, ipToInt, WS_PORT } from './names.js';

/**
 * The network guard as data: one firewall table with a chain on each path a packet of a unit can
 * take. The same rules render to nftables text and evaluate against sample packets, so the tests
 * assert what the rules decide and not only how they read.
 *
 * Only drops are relied on. A drop in a base chain is final whatever other firewall managers
 * accept; an accept here only ends this table's own evaluation.
 */

export type GuardPath = 'input' | 'forward' | 'output';

export interface IGuardPacket {
  path: GuardPath;
  /** Interface the packet arrives on, when it has one. */
  iif?: string;
  /** Interface it leaves on, when it has one. */
  oif?: string;
  family: 4 | 6;
  protocol: 'tcp' | 'udp' | 'icmp';
  daddr?: string;
  dport?: number;
  conntrack: 'new' | 'established';
}

export type Verdict = 'accept' | 'drop';

interface IRule {
  text: string;
  applies(packet: IGuardPacket): boolean;
  verdict: Verdict;
}

export interface IGuardChain {
  name: GuardPath;
  rules: IRule[];
}

export interface IGuardRuleset {
  table: string;
  bridgePrefix: string;
  resolvers: string[];
  chains: IGuardChain[];
}

/** Ranges a unit may never reach: private, loopback, link-local (metadata), carrier-grade NAT, reserved. */
export const DENIED_RANGES: readonly string[] = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/3',
];

const DNS_PORTS = [53, 853];
const PRIORITY = -10;
const INSTALL_ID = /^[a-f0-9]{8}$/u;

export function guardTableName(installId: string): string {
  return `pah_${installId}`;
}

function inCidr(address: string, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const value = ipToInt(address);
  const start = ipToInt(base);
  if (value === undefined || start === undefined) return false;
  return value >= start && value < start + 2 ** (32 - Number(bits));
}

export function validResolver(address: string): boolean {
  return ipToInt(address) !== undefined;
}

/** Builds the rules. Resolvers are the only addresses a unit's DNS may go to. */
export function buildGuard(input: {
  installId: string;
  resolvers: readonly string[];
}): IGuardRuleset {
  if (!INSTALL_ID.test(input.installId)) throw new Error('The install id is not eight hex digits');
  for (const resolver of input.resolvers) {
    if (!validResolver(resolver)) throw new Error(`"${resolver}" is not an IPv4 address`);
  }
  const resolvers = [...new Set(input.resolvers)].sort(
    (a, b) => (ipToInt(a) ?? 0) - (ipToInt(b) ?? 0),
  );
  const prefix = bridgePrefix(input.installId);
  const ours = (name: string | undefined): boolean => name !== undefined && name.startsWith(prefix);
  const resolverSet = resolvers.join(', ');
  const toResolver = (p: IGuardPacket): boolean =>
    p.family === 4 && p.daddr !== undefined && resolvers.includes(p.daddr);
  const isDns = (p: IGuardPacket): boolean =>
    (p.protocol === 'tcp' || p.protocol === 'udp') &&
    p.dport !== undefined &&
    DNS_PORTS.includes(p.dport);
  const denied = (p: IGuardPacket): boolean =>
    p.family === 4 &&
    p.daddr !== undefined &&
    DENIED_RANGES.some((range) => inCidr(p.daddr ?? '', range));
  const unitPorts = [GUI_PORT, WS_PORT];
  const portList = unitPorts.join(', ');
  const from = `iifname "${prefix}*"`;
  const into = `oifname "${prefix}*"`;

  const dnsAccept: IRule[] =
    resolvers.length === 0
      ? []
      : (['udp', 'tcp'] as const).map((protocol) => ({
          text: `${from} ${protocol} dport 53 ip daddr { ${resolverSet} } accept`,
          applies: (p: IGuardPacket) =>
            ours(p.iif) && p.protocol === protocol && p.dport === 53 && toResolver(p),
          verdict: 'accept' as const,
        }));
  const dnsDrop: IRule[] = [
    {
      text: `${from} meta l4proto { tcp, udp } th dport { ${DNS_PORTS.join(', ')} } drop`,
      applies: (p) => ours(p.iif) && isDns(p),
      verdict: 'drop',
    },
  ];

  const input_: IGuardChain = {
    name: 'input',
    rules: [
      {
        text: `meta nfproto ipv6 ${from} drop`,
        applies: (p) => p.family === 6 && ours(p.iif),
        verdict: 'drop',
      },
      {
        text: `${from} ct state established,related accept`,
        applies: (p) => ours(p.iif) && p.conntrack === 'established',
        verdict: 'accept',
      },
      ...dnsAccept,
      { text: `${from} drop`, applies: (p) => ours(p.iif), verdict: 'drop' },
    ],
  };

  const forward: IGuardChain = {
    name: 'forward',
    rules: [
      {
        text: `meta nfproto ipv6 ${from} drop`,
        applies: (p) => p.family === 6 && ours(p.iif),
        verdict: 'drop',
      },
      {
        text: `meta nfproto ipv6 ${into} drop`,
        applies: (p) => p.family === 6 && ours(p.oif),
        verdict: 'drop',
      },
      {
        text: `${from} ${into} drop`,
        applies: (p) => ours(p.iif) && ours(p.oif),
        verdict: 'drop',
      },
      {
        text: `${into} ct state established,related accept`,
        applies: (p) => ours(p.oif) && p.conntrack === 'established',
        verdict: 'accept',
      },
      { text: `${into} drop`, applies: (p) => ours(p.oif), verdict: 'drop' },
      ...dnsAccept,
      ...dnsDrop,
      {
        text: `${from} ip daddr { ${DENIED_RANGES.join(', ')} } drop`,
        applies: (p) => ours(p.iif) && denied(p),
        verdict: 'drop',
      },
    ],
  };

  const output: IGuardChain = {
    name: 'output',
    rules: [
      {
        text: `meta nfproto ipv6 ${into} drop`,
        applies: (p) => p.family === 6 && ours(p.oif),
        verdict: 'drop',
      },
      {
        text: `${into} ct state established,related accept`,
        applies: (p) => ours(p.oif) && p.conntrack === 'established',
        verdict: 'accept',
      },
      {
        text: `${into} tcp dport { ${portList} } ct state new accept`,
        applies: (p) =>
          ours(p.oif) &&
          p.protocol === 'tcp' &&
          p.dport !== undefined &&
          unitPorts.includes(p.dport) &&
          p.conntrack === 'new',
        verdict: 'accept',
      },
      { text: `${into} drop`, applies: (p) => ours(p.oif), verdict: 'drop' },
    ],
  };

  return {
    table: guardTableName(input.installId),
    bridgePrefix: prefix,
    resolvers,
    chains: [input_, forward, output],
  };
}

/** What the table decides for a packet; a packet no rule names is left to other tables. */
export function evaluateGuard(ruleset: IGuardRuleset, packet: IGuardPacket): Verdict {
  const chain = ruleset.chains.find((c) => c.name === packet.path);
  for (const rule of chain?.rules ?? []) {
    if (rule.applies(packet)) return rule.verdict;
  }
  return 'accept';
}

/**
 * Atomic replacement text for `nft -f`: declare the table so the delete cannot fail, delete it, and
 * define it again, all in one transaction. A packet never meets a half-built table.
 */
export function renderGuard(ruleset: IGuardRuleset): string {
  const lines: string[] = [
    `table inet ${ruleset.table}`,
    `delete table inet ${ruleset.table}`,
    `table inet ${ruleset.table} {`,
  ];
  for (const chain of ruleset.chains) {
    lines.push(
      `  chain ${chain.name} {`,
      `    type filter hook ${chain.name} priority ${PRIORITY}; policy accept;`,
      ...chain.rules.map((rule) => `    ${rule.text}`),
      '  }',
    );
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
