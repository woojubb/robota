import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { organizationCanonical, organizationSigningBytes } from '../index.js';

describe('organization signing bytes', () => {
  it.each([
    ['workload', '["robota/organization-workload/v1",{"tenant":"acme"}]'],
    ['request', '["robota/organization-request/v1",{"tenant":"acme"}]'],
    ['approval', '["robota/organization-approval/v1",{"tenant":"acme"}]'],
  ] as const)('uses the Robota v1 %s contract for independent signers', (domain, expected) => {
    expect(organizationSigningBytes(domain, { tenant: 'acme' })).toEqual(
      Buffer.from(expected, 'utf8'),
    );
  });

  it('matches independent Python UTF-16 ordering and JSON escaping for Korean, emoji and controls', () => {
    const value = {
      '😀': '회사\n\u0000\b\t',
      '\uE000': ['이름', 9007199254740991],
      a: true,
      '𝄞': null,
    };
    const script = [
      'import json,sys',
      'def order(x):',
      ' if isinstance(x,dict): return {k:order(x[k]) for k in sorted(x,key=lambda k:k.encode("utf-16-be"))}',
      ' if isinstance(x,list): return [order(v) for v in x]',
      ' return x',
      'print(json.dumps(order(json.loads(sys.stdin.read())),ensure_ascii=False,separators=(",",":")))',
    ].join('\n');
    const python = spawnSync('python3', ['-c', script], {
      input: JSON.stringify(value),
      encoding: 'utf8',
    });
    expect(python.status).toBe(0);
    expect(organizationCanonical(value)).toBe(python.stdout.trimEnd());
    expect(organizationSigningBytes('request', value)).not.toEqual(
      organizationSigningBytes('approval', value),
    );
  });

  it.each([
    NaN,
    Infinity,
    0.5,
    -0,
    9007199254740992,
    undefined,
    1n,
    () => 1,
    new Date(),
    new Map(),
    '\uD800',
    { value: undefined },
    Object.assign([1], { extra: 1 }),
    Array(1),
    {
      get value() {
        throw new Error('must not invoke');
      },
    },
  ])('rejects unsupported or ambiguous values (%#)', (value) => {
    expect(() => organizationCanonical(value)).toThrow('invalid-schema');
  });

  it('rejects cycles, custom prototypes, symbols, non-enumerable keys and oversized payloads', () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    for (const value of [
      cyclic,
      Object.create({ inherited: 1 }),
      { [Symbol('a')]: 1 },
      Object.defineProperty({}, 'a', { value: 1 }),
      'x'.repeat(65_536),
    ]) {
      expect(() => organizationCanonical(value)).toThrow('invalid-schema');
    }
  });
});
