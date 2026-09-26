import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addressCachePath, createFileMeshAddressCache } from '../address-cache.js';

const A = 'a'.repeat(43);
const B = 'b'.repeat(43);
const DAY = 24 * 60 * 60 * 1000;

let home: string;
let directory: string;
let clock: number;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'robota-address-cache-'));
  directory = join(home, '.robota', 'devices');
  clock = Date.now();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function open() {
  return createFileMeshAddressCache(directory, {
    withinRoot: join(home, '.robota'),
    now: () => clock,
  });
}

describe('the address cache on disk', () => {
  it('keeps the last candidates per device, most recent first, across runs', () => {
    const cache = open();
    cache.remember(A, { host: '192.168.1.20', port: 4000 });
    cache.remember(A, { host: '192.168.1.21', port: 4001 });
    cache.remember(A, { host: '192.168.1.20', port: 4000 });
    cache.rememberListenPort(5000);

    const again = open();
    expect(again.recall(A)).toEqual([
      { host: '192.168.1.20', port: 4000 },
      { host: '192.168.1.21', port: 4001 },
    ]);
    expect(again.lastListenPort()).toBe(5000);
    expect(again.recall(B)).toEqual([]);
  });

  it('is owner-only and holds nothing but device ids, addresses and times', () => {
    const cache = open();
    cache.remember(A, { host: '192.168.1.20', port: 4000 });
    const path = addressCachePath(directory);
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['peers', 'version']);
    const peers = stored.peers as Record<string, { host: string; port: number; at: number }[]>;
    expect(Object.keys(peers)).toEqual([A]);
    expect(Object.keys(peers[A]![0]!).sort()).toEqual(['at', 'host', 'port']);
  });

  it('forgets devices that left the lists, and entries too old to be worth trying', () => {
    const cache = open();
    cache.remember(A, { host: '192.168.1.20', port: 4000 });
    cache.remember(B, { host: '192.168.1.30', port: 4000 });
    cache.retain([B]);
    expect(open().recall(A)).toEqual([]);
    clock += 31 * DAY;
    expect(open().recall(B)).toEqual([]);
  });

  it('starts empty from a file it cannot read, and refuses entries that are not addresses', () => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(addressCachePath(directory), 'not json');
    expect(open().recall(A)).toEqual([]);
    writeFileSync(
      addressCachePath(directory),
      JSON.stringify({
        version: 1,
        listenPort: 99999,
        peers: {
          [A]: [
            { host: '192.168.1.20', port: 4000, at: clock },
            { host: 'x'.repeat(300), port: 4000, at: clock },
            { host: '192.168.1.21', port: 0, at: clock },
            { host: '192.168.1.22', port: 4000, at: clock + 10 * DAY },
          ],
          __proto__: [{ host: '1.1.1.1', port: 1, at: clock }],
          short: [{ host: '1.1.1.1', port: 1, at: clock }],
        },
      }),
    );
    const cache = open();
    expect(cache.recall(A)).toEqual([{ host: '192.168.1.20', port: 4000 }]);
    expect(cache.recall('short')).toEqual([]);
    expect(cache.lastListenPort()).toBeUndefined();
  });
});
