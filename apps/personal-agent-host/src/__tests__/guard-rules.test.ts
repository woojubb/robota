import { describe, expect, it } from 'vitest';

import {
  buildGuard,
  DENIED_RANGES,
  evaluateGuard,
  type IGuardPacket,
  renderGuard,
} from '../runtime/container/guard-rules.js';
import { bridgeName, ipFromInt } from '../runtime/container/names.js';

const INSTALL = 'abcdef01';
const RESOLVERS = ['10.0.0.54', '10.0.0.53'];

const GOLDEN = `table inet pah_abcdef01
delete table inet pah_abcdef01
table inet pah_abcdef01 {
  chain input {
    type filter hook input priority -10; policy accept;
    meta nfproto ipv6 iifname "pahabcdef*" drop
    iifname "pahabcdef*" ct state established,related accept
    iifname "pahabcdef*" udp dport 53 ip daddr { 10.0.0.53, 10.0.0.54 } accept
    iifname "pahabcdef*" tcp dport 53 ip daddr { 10.0.0.53, 10.0.0.54 } accept
    iifname "pahabcdef*" drop
  }
  chain forward {
    type filter hook forward priority -10; policy accept;
    meta nfproto ipv6 iifname "pahabcdef*" drop
    meta nfproto ipv6 oifname "pahabcdef*" drop
    iifname "pahabcdef*" oifname "pahabcdef*" drop
    oifname "pahabcdef*" ct state established,related accept
    oifname "pahabcdef*" drop
    iifname "pahabcdef*" udp dport 53 ip daddr { 10.0.0.53, 10.0.0.54 } accept
    iifname "pahabcdef*" tcp dport 53 ip daddr { 10.0.0.53, 10.0.0.54 } accept
    iifname "pahabcdef*" meta l4proto { tcp, udp } th dport { 53, 853 } drop
    iifname "pahabcdef*" ip daddr { 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.168.0.0/16, 198.18.0.0/15, 224.0.0.0/3 } drop
  }
  chain output {
    type filter hook output priority -10; policy accept;
    meta nfproto ipv6 oifname "pahabcdef*" drop
    oifname "pahabcdef*" ct state established,related accept
    oifname "pahabcdef*" tcp dport { 7360, 7361 } ct state new accept
    oifname "pahabcdef*" drop
  }
}
`;

const ACCOUNT_A = bridgeName(INSTALL, 0);
const ACCOUNT_B = bridgeName(INSTALL, 1);
const UPLINK = 'eth0';

function packet(overrides: Partial<IGuardPacket> & Pick<IGuardPacket, 'path'>): IGuardPacket {
  return { family: 4, protocol: 'tcp', conntrack: 'new', ...overrides };
}

const ruleset = buildGuard({ installId: INSTALL, resolvers: RESOLVERS });
const decide = (p: IGuardPacket): string => evaluateGuard(ruleset, p);

describe('network guard rules', () => {
  it('renders the exact table, replaced atomically', () => {
    expect(renderGuard(ruleset)).toBe(GOLDEN);
  });

  it('covers every account bridge by one name pattern and nothing else', () => {
    expect(ACCOUNT_A).toMatch(/^pahabcdef[0-9a-z]{3}$/u);
    expect(ACCOUNT_A.length).toBeLessThanOrEqual(15);
    expect(ACCOUNT_B).not.toBe(ACCOUNT_A);
    for (const rule of renderGuard(ruleset)
      .split('\n')
      .filter((l) => /^ {4}(iif|oif|meta nfproto)/u.test(l))) {
      expect(rule).toContain('"pahabcdef*"');
    }
    // A bridge that is not an account's is not named by any rule.
    expect(
      decide(packet({ path: 'forward', iif: 'docker0', oif: UPLINK, daddr: '10.1.2.3' })),
    ).toBe('accept');
  });

  describe('what it decides', () => {
    it('drops account-to-account traffic, whatever the state', () => {
      for (const conntrack of ['new', 'established'] as const) {
        expect(
          decide(
            packet({
              path: 'forward',
              iif: ACCOUNT_A,
              oif: ACCOUNT_B,
              daddr: '10.200.0.10',
              conntrack,
            }),
          ),
        ).toBe('drop');
      }
    });

    it('lets only the host reach a unit, on the agent ports', () => {
      expect(decide(packet({ path: 'output', oif: ACCOUNT_A, dport: 7360 }))).toBe('accept');
      expect(decide(packet({ path: 'output', oif: ACCOUNT_A, dport: 7361 }))).toBe('accept');
      expect(decide(packet({ path: 'output', oif: ACCOUNT_A, dport: 22 }))).toBe('drop');
      expect(decide(packet({ path: 'output', oif: ACCOUNT_A, protocol: 'udp', dport: 7360 }))).toBe(
        'drop',
      );
      expect(decide(packet({ path: 'output', oif: ACCOUNT_A, protocol: 'icmp' }))).toBe('drop');
    });

    it('drops every new connection routed into a unit but lets replies in', () => {
      expect(decide(packet({ path: 'forward', iif: UPLINK, oif: ACCOUNT_A, dport: 7360 }))).toBe(
        'drop',
      );
      expect(decide(packet({ path: 'forward', iif: 'docker0', oif: ACCOUNT_A, dport: 7360 }))).toBe(
        'drop',
      );
      expect(
        decide(packet({ path: 'forward', iif: UPLINK, oif: ACCOUNT_A, conntrack: 'established' })),
      ).toBe('accept');
    });

    it('drops a unit reaching the host, its gateway or any local service', () => {
      expect(
        decide(packet({ path: 'input', iif: ACCOUNT_A, daddr: '10.200.0.1', dport: 22 })),
      ).toBe('drop');
      expect(decide(packet({ path: 'input', iif: ACCOUNT_A, protocol: 'udp', dport: 67 }))).toBe(
        'drop',
      );
      expect(decide(packet({ path: 'input', iif: ACCOUNT_A, conntrack: 'established' }))).toBe(
        'accept',
      );
    });

    it('drops private, link-local, metadata, carrier-grade NAT and reserved destinations', () => {
      for (const daddr of [
        '10.0.0.1',
        '172.16.5.5',
        '172.31.255.255',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '100.127.255.255',
        '127.0.0.1',
        '0.0.0.0',
        '198.19.0.1',
        '224.0.0.251',
        '255.255.255.255',
      ]) {
        expect(
          decide(packet({ path: 'forward', iif: ACCOUNT_A, oif: UPLINK, daddr, dport: 443 })),
        ).toBe('drop');
      }
    });

    it('lets a unit reach the public internet', () => {
      for (const daddr of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '192.0.1.1']) {
        expect(
          decide(packet({ path: 'forward', iif: ACCOUNT_A, oif: UPLINK, daddr, dport: 443 })),
        ).toBe('accept');
      }
    });

    it('lets DNS go only to the host resolvers, even those in a private range', () => {
      for (const protocol of ['udp', 'tcp'] as const) {
        for (const daddr of RESOLVERS) {
          for (const path of ['forward', 'input'] as const) {
            expect(
              decide(packet({ path, iif: ACCOUNT_A, oif: UPLINK, daddr, protocol, dport: 53 })),
            ).toBe('accept');
          }
        }
        expect(
          decide(
            packet({
              path: 'forward',
              iif: ACCOUNT_A,
              oif: UPLINK,
              daddr: '8.8.8.8',
              protocol,
              dport: 53,
            }),
          ),
        ).toBe('drop');
        expect(
          decide(
            packet({
              path: 'forward',
              iif: ACCOUNT_A,
              oif: UPLINK,
              daddr: '1.1.1.1',
              protocol,
              dport: 853,
            }),
          ),
        ).toBe('drop');
        expect(
          decide(
            packet({
              path: 'forward',
              iif: ACCOUNT_A,
              oif: UPLINK,
              daddr: RESOLVERS[0],
              protocol,
              dport: 853,
            }),
          ),
        ).toBe('drop');
      }
      // A resolver address is reachable for DNS only, not for anything else.
      expect(
        decide(
          packet({ path: 'forward', iif: ACCOUNT_A, oif: UPLINK, daddr: RESOLVERS[0], dport: 443 }),
        ),
      ).toBe('drop');
    });

    it('drops IPv6 on every path of an account bridge', () => {
      for (const path of ['input', 'forward', 'output'] as const) {
        const side = path === 'output' ? { oif: ACCOUNT_A } : { iif: ACCOUNT_A };
        expect(decide(packet({ path, ...side, family: 6, conntrack: 'established' }))).toBe('drop');
      }
    });

    it('allows no DNS at all when the host has no resolver', () => {
      const none = buildGuard({ installId: INSTALL, resolvers: [] });
      expect(
        evaluateGuard(
          none,
          packet({
            path: 'forward',
            iif: ACCOUNT_A,
            oif: UPLINK,
            daddr: '8.8.8.8',
            protocol: 'udp',
            dport: 53,
          }),
        ),
      ).toBe('drop');
      expect(renderGuard(none)).not.toContain('dport 53 ip daddr');
    });
  });

  describe('properties', () => {
    // A small seeded generator keeps the cases the same on every run.
    function random(seed: number): () => number {
      let state = seed;
      return () => {
        state = (state * 1664525 + 1013904223) % 2 ** 32;
        return state / 2 ** 32;
      };
    }

    it('is deterministic and independent of resolver order or repeats', () => {
      const next = random(7);
      for (let i = 0; i < 50; i += 1) {
        const resolvers = Array.from({ length: 1 + Math.floor(next() * 4) }, () =>
          ipFromInt(Math.floor(next() * 2 ** 32)),
        );
        const shuffled = [...resolvers, resolvers[0]].sort(() => next() - 0.5);
        expect(renderGuard(buildGuard({ installId: INSTALL, resolvers }))).toBe(
          renderGuard(buildGuard({ installId: INSTALL, resolvers: shuffled })),
        );
      }
    });

    it('never lets a unit reach a denied range except a resolver on the DNS port', () => {
      const next = random(11);
      for (let i = 0; i < 400; i += 1) {
        const resolvers = [ipFromInt(Math.floor(next() * 2 ** 32))];
        const rules = buildGuard({ installId: INSTALL, resolvers });
        const range = DENIED_RANGES[Math.floor(next() * DENIED_RANGES.length)];
        const [base, bits] = range.split('/');
        const [a, b, c, d] = base.split('.').map(Number);
        const start = ((a * 256 + b) * 256 + c) * 256 + d;
        const daddr = ipFromInt(start + Math.floor(next() * 2 ** (32 - Number(bits))));
        const protocol = next() < 0.5 ? 'tcp' : 'udp';
        const dport = [53, 80, 443, 853, 22, 7360][Math.floor(next() * 6)];
        const verdict = evaluateGuard(
          rules,
          packet({ path: 'forward', iif: ACCOUNT_A, oif: UPLINK, daddr, protocol, dport }),
        );
        const isResolverDns = resolvers.includes(daddr) && dport === 53;
        expect(verdict).toBe(isResolverDns ? 'accept' : 'drop');
      }
    });

    it('accepts only with a condition naming an account bridge or a connection state', () => {
      const lines = renderGuard(ruleset)
        .split('\n')
        .filter((l) => l.endsWith(' accept'));
      for (const line of lines) {
        expect(line).toMatch(/(?:iifname|oifname) "pahabcdef\*"/u);
      }
    });

    it('ends every chain with a drop of the account bridge traffic it does not name, never a bare accept', () => {
      const lines = renderGuard(ruleset).split('\n');
      expect(lines.filter((l) => /^ {4}accept$/u.test(l))).toHaveLength(0);
      for (const chain of ['input', 'output'] as const) {
        const last = ruleset.chains.find((c) => c.name === chain)?.rules.at(-1);
        expect(last?.verdict).toBe('drop');
      }
    });

    it('refuses an install id or resolver that is not what it must be', () => {
      expect(() => buildGuard({ installId: 'not-hex!', resolvers: [] })).toThrow();
      expect(() =>
        buildGuard({ installId: INSTALL, resolvers: ['1.1.1.1; flush ruleset'] }),
      ).toThrow();
      expect(() => buildGuard({ installId: INSTALL, resolvers: ['::1'] })).toThrow();
      expect(() => buildGuard({ installId: INSTALL, resolvers: ['256.1.1.1'] })).toThrow();
    });
  });
});
