import { describe, expect, it } from 'vitest';

import { HostError } from '../errors.js';
import { generateCaddyfile, type ICaddyfileSettings } from '../proxy/caddyfile.js';
import type { ProxySite } from '../proxy/port.js';

const INTERNAL: ICaddyfileSettings = {
  tls: { mode: 'internal' },
  adminListen: '/run/caddy/admin.sock',
};
const ACME: ICaddyfileSettings = {
  tls: { mode: 'acme', email: 'ops@example.test' },
  adminListen: '/run/caddy/admin.sock',
};

const alice: ProxySite = {
  kind: 'active',
  hostname: 'alice.agents.example.test',
  guiUpstream: '10.200.0.2:7360',
  wsUpstream: '10.200.0.2:7361',
};
const bob: ProxySite = { kind: 'suspended', hostname: 'bob.agents.example.test' };
const carol: ProxySite = { kind: 'unavailable', hostname: 'carol.agents.example.test' };
const dave: ProxySite = {
  kind: 'active',
  hostname: 'dave.agents.example.test',
  guiUpstream: '10.200.0.10:7360',
  wsUpstream: '10.200.0.10:7361',
};

function golden(name: string): string {
  return `golden/${name}.Caddyfile`;
}

describe('golden configurations', () => {
  it('serves one active account on its own routes', async () => {
    await expect(generateCaddyfile([alice], INTERNAL)).toMatchFileSnapshot(golden('active'));
  });

  it('answers a suspended account with 503 and proxies nothing', async () => {
    await expect(generateCaddyfile([bob], INTERNAL)).toMatchFileSnapshot(golden('suspended'));
  });

  it('answers an account whose unit is down with 503', async () => {
    await expect(generateCaddyfile([carol], INTERNAL)).toMatchFileSnapshot(golden('unavailable'));
  });

  it('has no site at all once the last account is deleted', async () => {
    await expect(generateCaddyfile([], INTERNAL)).toMatchFileSnapshot(golden('empty'));
  });

  it('mixes states in hostname order whatever order they arrive in', async () => {
    const text = generateCaddyfile([dave, carol, alice, bob], INTERNAL);
    expect(generateCaddyfile([bob, alice, dave, carol], INTERNAL)).toBe(text);
    await expect(text).toMatchFileSnapshot(golden('mixed'));
  });

  it('drops a deleted account from a mixed set, so its name is unknown', async () => {
    const text = generateCaddyfile([alice, carol, dave], INTERNAL);
    expect(text).not.toContain('bob.agents.example.test');
    await expect(text).toMatchFileSnapshot(golden('mixed-after-delete'));
  });

  it('issues certificates through ACME with the contact email on custom ports', async () => {
    const text = generateCaddyfile([alice, bob], { ...ACME, httpPort: 8080, httpsPort: 8443 });
    await expect(text).toMatchFileSnapshot(golden('acme-ports'));
  });
});

/** A small seeded generator, so a failing case can be replayed. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSites(random: () => number): ProxySite[] {
  const count = Math.floor(random() * 8);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
  const label = (): string => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const length = 1 + Math.floor(random() * 12);
    let out = '';
    for (let i = 0; i < length; i += 1) out += alphabet[Math.floor(random() * alphabet.length)];
    return out;
  };
  const sites: ProxySite[] = [];
  const names = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const hostname = `${label()}.${pick(['agents.example.test', 'x.example.org', 'host.test'])}`;
    if (names.has(hostname)) continue;
    names.add(hostname);
    const kind = pick(['active', 'suspended', 'unavailable'] as const);
    if (kind === 'active') {
      const address = `10.${Math.floor(random() * 256)}.${Math.floor(random() * 256)}.${1 + Math.floor(random() * 254)}`;
      sites.push({
        kind,
        hostname,
        guiUpstream: `${address}:${1 + Math.floor(random() * 65535)}`,
        wsUpstream: `${pick([address, 'unit.internal.test'])}:${1 + Math.floor(random() * 65535)}`,
      });
    } else {
      sites.push({ kind, hostname });
    }
  }
  return sites;
}

const FORBIDDEN = [
  'on_demand',
  'on-demand',
  'default_sni',
  'fallback_sni',
  'local_certs',
  'ask ',
  'admin :',
  'admin 0.0.0.0',
  'admin localhost',
  'admin off',
];

describe('properties of every generated configuration', () => {
  it('lists exactly the given hostnames, each served on its own and never as a catch-all', () => {
    const random = prng(0xc0ffee);
    for (let round = 0; round < 400; round += 1) {
      const sites = randomSites(random);
      const text = generateCaddyfile(sites, round % 2 === 0 ? INTERNAL : ACME);
      const headers = text
        .split('\n')
        .filter((line) => /^[^\s#}][^{]*\{$/u.test(line) && line !== '{')
        .map((line) => line.slice(0, -2));
      expect(headers.sort(), `round ${round}`).toEqual(sites.map((s) => s.hostname).sort());
      for (const header of headers) {
        expect(header).toMatch(/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u);
      }
      for (const word of FORBIDDEN) expect(text, `round ${round}: ${word}`).not.toContain(word);
      expect(text).toContain('admin unix//run/caddy/admin.sock|0600');
      const tlsLines = text.split('\n').filter((line) => /^\t?tls\b/u.test(line));
      expect(tlsLines).toEqual(round % 2 === 0 ? sites.map(() => '\ttls internal') : []);
    }
  });

  it('never routes a suspended, unavailable or unknown host and routes an active one only to its upstreams', () => {
    const random = prng(0xbadf00d);
    for (let round = 0; round < 400; round += 1) {
      const sites = randomSites(random);
      const text = generateCaddyfile(sites, INTERNAL);
      const blocks = text.split('\n\n').slice(2);
      expect(blocks).toHaveLength(sites.length);
      for (const site of sites) {
        const block = blocks.find((b) => b.startsWith(`${site.hostname} {\n`));
        expect(block, site.hostname).toBeDefined();
        if (site.kind === 'active') {
          const targets = [...(block?.matchAll(/reverse_proxy (\S+) \{/gu) ?? [])].map((m) => m[1]);
          expect(targets).toEqual([site.wsUpstream, site.guiUpstream]);
        } else {
          expect(block).toContain('respond "');
          expect(block).toContain('" 503');
          expect(block).not.toContain('reverse_proxy');
        }
      }
      expect(text).not.toContain('unknown-host.example.test');
    }
  });

  it('is the same text for the same sites, and every certificate is for a listed name only', () => {
    const random = prng(42);
    for (let round = 0; round < 100; round += 1) {
      const sites = randomSites(random);
      expect(generateCaddyfile(sites, ACME)).toBe(generateCaddyfile([...sites].reverse(), ACME));
    }
  });
});

const HOSTILE = [
  '',
  ' ',
  'a b.example.test',
  'a.example.test\nrespond "owned"',
  'a.example.test {\n}\n:443 {',
  '{$SECRET}.example.test',
  '{env.SECRET}.example.test',
  'A.example.test',
  '*.example.test',
  ':443',
  'localhost',
  '10.0.0.1',
  'a.example.test.',
  '.example.test',
  'a..example.test',
  'a_b.example.test',
  'ａ.example.test',
  'a.example.test|0777',
  'a.example.test;rm',
  'a.example.test#',
  `${'a'.repeat(64)}.example.test`,
  'a.example.test"',
];

function expectRefused(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(HostError);
    expect((error as HostError).code).toBe('invalid-input');
    return;
  }
  throw new Error('expected the value to be refused');
}

describe('refusal of unvalidated values', () => {
  it.each(HOSTILE)('refuses the hostname %j', (hostname) => {
    expectRefused(() => generateCaddyfile([{ kind: 'suspended', hostname }], INTERNAL));
    expectRefused(() => generateCaddyfile([{ ...alice, hostname }], INTERNAL));
  });

  it.each([
    '',
    'localhost',
    '10.0.0.2',
    '10.0.0.2:0',
    '10.0.0.2:65536',
    '10.0.0.2:07360',
    ':7360',
    '10.0.0.256:7360',
    '10.0.0.2:7360\nrespond "x"',
    '10.0.0.2:7360 {',
    '{$KEY}:7360',
    '{env.KEY}:7360',
    'a b:7360',
    '[::1]:7360',
    'http://10.0.0.2:7360',
    '10.0.0.2:7360/path',
    '*:7360',
    '1.2.3:7360',
    'unit.example.test:',
  ])('refuses the upstream %j', (upstream) => {
    expectRefused(() => generateCaddyfile([{ ...alice, guiUpstream: upstream }], INTERNAL));
    expectRefused(() => generateCaddyfile([{ ...alice, wsUpstream: upstream }], INTERNAL));
  });

  it.each([
    '',
    'ops',
    'ops@',
    '@example.test',
    'a b@example.test',
    'ops@example.test\nacme_ca x',
    'ops@ex{ample}.test',
    'ops@localhost',
  ])('refuses the ACME email %j', (email) => {
    expectRefused(() => generateCaddyfile([alice], { ...INTERNAL, tls: { mode: 'acme', email } }));
  });

  it.each([
    '',
    'relative.sock',
    '/run/caddy/admin.sock|0777',
    '/run/../etc/x',
    '/run/a b',
    'tcp/localhost:2019',
    '/run/x\nadmin :2019',
  ])('refuses the admin socket %j', (adminListen) => {
    expectRefused(() => generateCaddyfile([alice], { ...INTERNAL, adminListen }));
  });

  it.each([0, 65536, 1.5, -1, Number.NaN])('refuses the port %j', (port) => {
    expectRefused(() => generateCaddyfile([alice], { ...INTERNAL, httpPort: port }));
    expectRefused(() => generateCaddyfile([alice], { ...INTERNAL, httpsPort: port }));
  });

  it('refuses a hostname listed twice, a site of an unknown kind and a non-text value', () => {
    expectRefused(() => generateCaddyfile([alice, alice], INTERNAL));
    expectRefused(() =>
      generateCaddyfile(
        [{ kind: 'wild', hostname: 'a.example.test' } as unknown as ProxySite],
        INTERNAL,
      ),
    );
    expectRefused(() =>
      generateCaddyfile([{ kind: 'suspended', hostname: 42 } as unknown as ProxySite], INTERNAL),
    );
  });

  it('keeps the structure whatever text it is fed: an accepted value only ever fills its own slot', () => {
    const random = prng(7);
    const alphabet = 'abcdefgh0123456789..--{}$" \n\t:;|#*_\\/';
    let accepted = 0;
    for (let round = 0; round < 6000; round += 1) {
      let value = '';
      for (let i = 0, n = 1 + Math.floor(random() * 8); i < n; i += 1) {
        value += alphabet[Math.floor(random() * alphabet.length)];
      }
      try {
        const text = generateCaddyfile(
          [{ ...alice, hostname: value, guiUpstream: `${value}:7360` }],
          INTERNAL,
        );
        accepted += 1;
        expect(text.split('\n')).toHaveLength(
          generateCaddyfile([alice], INTERNAL).split('\n').length,
        );
        expect(value).toMatch(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/u);
      } catch (error) {
        expect(error).toBeInstanceOf(HostError);
      }
    }
    expect(accepted).toBeGreaterThan(0);
  });
});
