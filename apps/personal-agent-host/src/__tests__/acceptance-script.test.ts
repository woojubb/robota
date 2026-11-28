import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildGuard, evaluateGuard } from '../runtime/container/guard-rules.js';
import { bridgeName } from '../runtime/container/names.js';

/**
 * The acceptance script needs a container engine and is run by hand, so CI checks only what needs no
 * engine: its pure helpers, that it is valid, and the decisions that keep it from weakening what it
 * checks (it adds no firewall rule, the model fixture sits on a public-looking address).
 */
const SCRIPT = fileURLToPath(
  new URL('../../../../docker/personal-agent-host/acceptance.mjs', import.meta.url),
);
const source = readFileSync(SCRIPT, 'utf8');

type Outcome = 'connected' | 'refused' | 'blocked' | 'error';
interface ITarget {
  host: string;
  port: number;
}
interface IFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}
interface IScript {
  classifyConnectError(code: string | undefined): Outcome;
  reached(outcome: Outcome): boolean;
  defaultGateways(text: string): string[];
  judgeBlocked(
    targets: ITarget[],
    control: Array<{ outcome: Outcome }>,
    probe: Array<{ outcome: Outcome }>,
  ): { controlled: ITarget[]; leaked: ITarget[]; inconclusive: ITarget[] };
  findSecrets(texts: Record<string, string>, secrets: Record<string, string>): string[];
  sha8(text: string): string;
  tamperArchive(archive: Buffer, needle: string): Buffer;
  encodeClientFrame(opcode: number, payload: string | Buffer, maskKey?: Buffer): Buffer;
  decodeFrames(buffer: Buffer): { frames: IFrame[]; rest: Buffer };
}

// Importing the script runs nothing: it acts only when started as the program or as a probe.
const script = (await import(pathToFileURL(SCRIPT).href)) as IScript;

describe('how a connection attempt is judged', () => {
  it('tells a refusal (something answered) from silence (blocked) and from other errors', () => {
    expect(script.classifyConnectError('ECONNREFUSED')).toBe('refused');
    expect(script.classifyConnectError('ECONNRESET')).toBe('refused');
    for (const code of ['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']) {
      expect(script.classifyConnectError(code)).toBe('blocked');
    }
    for (const code of ['EACCES', 'EPERM', 'EAI_AGAIN', undefined]) {
      expect(script.classifyConnectError(code)).toBe('error');
    }
    expect(script.reached('connected')).toBe(true);
    expect(script.reached('refused')).toBe(true);
    expect(script.reached('blocked')).toBe(false);
    expect(script.reached('error')).toBe(false);
  });

  it('counts only targets the control reached as evidence, and reports leaks and doubts', () => {
    const targets = [1, 2, 3, 4].map((port) => ({ host: '10.0.0.1', port }));
    const control = (['connected', 'refused', 'blocked', 'connected'] as Outcome[]).map(
      (outcome) => ({ outcome }),
    );
    // Targets 1, 2 and 4 were reached by the control; the probe reached 2 and could not tell on 4.
    const probe = (['blocked', 'refused', 'error'] as Outcome[]).map((outcome) => ({ outcome }));
    const verdict = script.judgeBlocked(targets, control, probe);
    expect(verdict.controlled.map((t) => t.port)).toEqual([1, 2, 4]);
    expect(verdict.leaked.map((t) => t.port)).toEqual([2]);
    expect(verdict.inconclusive.map((t) => t.port)).toEqual([4]);
  });
});

describe('reading the host', () => {
  it('finds the next hop of every default route and nothing else', () => {
    const table = [
      'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
      'eth0\t00000000\t0205A8C0\t0003\t0\t0\t202\t00000000\t0\t0\t0',
      'vznat\t00000000\t0140A8C0\t0003\t0\t0\t203\t00000000\t0\t0\t0',
      'eth0\t0005A8C0\t00000000\t0001\t0\t0\t202\t00FFFFFF\t0\t0\t0',
      'dummy\t00000000\t0100000A\t0001\t0\t0\t10\t00000000\t0\t0\t0',
    ].join('\n');
    expect(script.defaultGateways(table)).toEqual(['192.168.5.2', '192.168.64.1']);
    expect(script.defaultGateways('')).toEqual([]);
  });
});

describe('searching for secrets', () => {
  it('names where a key was found and never repeats the key', () => {
    const found = script.findSecrets(
      { 'the audit log': 'x acceptance-fake-key-a y', 'a clean output': 'nothing here' },
      { alice: 'acceptance-fake-key-a', bob: 'acceptance-fake-key-b' },
    );
    expect(found).toEqual(['the audit log holds the key of alice']);
    expect(found.join()).not.toContain('acceptance-fake-key-a');
    expect(script.findSecrets({ text: 'anything' }, { nobody: '' })).toEqual([]);
  });

  it('shortens a hash for the fixture marker', () => {
    expect(script.sha8('Bearer abc')).toMatch(/^[0-9a-f]{8}$/u);
    expect(script.sha8('Bearer abc')).not.toBe(script.sha8('Bearer abd'));
  });
});

describe('the WebSocket frames of the probe client', () => {
  it('encodes the masked text frame of the protocol specification', () => {
    const frame = script.encodeClientFrame(1, 'Hello', Buffer.from([0x37, 0xfa, 0x21, 0x3d]));
    expect(frame.toString('hex')).toBe('818537fa213d7f9f4d5158');
  });

  it('decodes masked and unmasked frames, every length form, and keeps a partial frame', () => {
    const unmasked = Buffer.from('810548656c6c6f', 'hex');
    const masked = Buffer.from('818537fa213d7f9f4d5158', 'hex');
    const both = script.decodeFrames(Buffer.concat([unmasked, masked]));
    expect(both.frames.map((f) => f.payload.toString())).toEqual(['Hello', 'Hello']);
    expect(both.rest.length).toBe(0);

    const medium = Buffer.alloc(300, 0x61);
    const encoded = script.encodeClientFrame(1, medium);
    const decoded = script.decodeFrames(encoded);
    expect(decoded.frames[0].payload.equals(medium)).toBe(true);
    const large = Buffer.alloc(70_000, 0x62);
    expect(script.decodeFrames(script.encodeClientFrame(1, large)).frames[0].payload.length).toBe(
      70_000,
    );

    const partial = script.decodeFrames(Buffer.concat([unmasked, masked.subarray(0, 5)]));
    expect(partial.frames.length).toBe(1);
    expect(partial.rest.length).toBe(5);
  });
});

describe('tampering with an archive', () => {
  it('changes exactly one byte inside the named text and leaves the rest as it was', () => {
    const archive = Buffer.concat([
      Buffer.alloc(512, 0x20),
      Buffer.from('before-ab12cd'),
      Buffer.alloc(512),
    ]);
    const tampered = script.tamperArchive(archive, 'before-ab12cd');
    expect(tampered.length).toBe(archive.length);
    const differing = [...archive.keys()].filter((i) => archive[i] !== tampered[i]);
    expect(differing).toEqual([512 + 'before-ab12cd'.length - 1]);
    // The input is not modified.
    expect(archive.includes('before-ab12cd')).toBe(true);
    expect(tampered.includes('before-ab12cd')).toBe(false);
  });

  it('refuses to guess when the text is not there', () => {
    expect(() => script.tamperArchive(Buffer.alloc(1024), 'before-ab12cd')).toThrow();
  });
});

describe('the script', () => {
  it('is valid JavaScript', () => {
    expect(spawnSync('node', ['--check', SCRIPT]).status).toBe(0);
  });

  it('uses only Node built-ins', () => {
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gmu)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(5);
    for (const specifier of imports) expect(specifier.startsWith('node:')).toBe(true);
  });

  it('adds no firewall rule: it only lists tables and removes the one of its own install', () => {
    expect(source).not.toMatch(/iptables/u);
    const uses = [...source.matchAll(/NFT\(([^)]*)\)/gu)];
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const use of uses) {
      expect(use[1]).toMatch(/^'list'|^'delete', 'table'|^\.\.\.w\('list chain/u);
    }
    expect(source).not.toMatch(/\bnft\s+(add|insert|create|flush)\b/u);
  });

  it('serves the model fixture from a documentation-range address on an engine network that routes', () => {
    expect(source).toContain("fixtureAddress: '203.0.113.9'");
    expect(source).toContain('com.docker.network.bridge.gateway_mode_ipv4=nat-unprotected');
  });

  it('keeps every operations check paired with a positive control and puts the unit image tag back', () => {
    // The refusal of a tampered archive is followed by the restore of the untampered one.
    expect(source).toMatch(/the control for the refusal above/u);
    // Whatever the run built on the unit image tag is undone at teardown, also on failure.
    expect(source).toMatch(/docker\(\['tag', state\.originalUnitImage, UNIT_TAG\]\)/u);
  });

  it('puts no key on a command line and reads no environment file', () => {
    expect(source).not.toMatch(/--api-?key|--key[ =]/u);
    expect(source).not.toMatch(/readFile(Sync)?\([^)]*\.env/u);
    expect(source).not.toMatch(/\bsk-[A-Za-z0-9]|AKIA[0-9A-Z]{8}/u);
  });
});

describe('the shipped guard and the fixture address', () => {
  const guard = buildGuard({ installId: 'abcdef12', resolvers: ['192.168.5.2'] });
  const fromUnit = bridgeName('abcdef12', 0);
  const toward = (daddr: string) =>
    evaluateGuard(guard, {
      path: 'forward',
      iif: fromUnit,
      oif: 'eth0',
      family: 4,
      protocol: 'tcp',
      daddr,
      dport: 80,
      conntrack: 'new',
    });

  it('lets a unit reach the fixture as an ordinary public address, and nothing private', () => {
    expect(toward('203.0.113.9')).toBe('accept');
    // The real path leaves through an engine bridge that is not one of the install's.
    expect(
      evaluateGuard(guard, {
        path: 'forward',
        iif: fromUnit,
        oif: 'accfx0',
        family: 4,
        protocol: 'tcp',
        daddr: '203.0.113.9',
        dport: 80,
        conntrack: 'new',
      }),
    ).toBe('accept');
    for (const daddr of [
      '10.0.0.5',
      '172.20.0.1',
      '192.168.5.2',
      '169.254.169.254',
      '100.64.1.1',
    ]) {
      expect(toward(daddr)).toBe('drop');
    }
  });
});
