import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  parsePort,
  parsePublicOrigin,
  serverAccessCode,
  serverAccessCodePath,
} from '../server-access.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-server-'));
  dirs.push(dir);
  return dir;
}

describe('a published agent', () => {
  it('keeps one random owner-only access code across starts', () => {
    const dir = stateDir();
    const code = serverAccessCode(dir);
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(serverAccessCode(dir)).toBe(code);
    if (process.platform !== 'win32')
      expect(statSync(serverAccessCodePath(dir)).mode & 0o777).toBe(0o600);
    expect(serverAccessCode(stateDir())).not.toBe(code);
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a code file others can read, or one with no code',
    () => {
      const dir = stateDir();
      serverAccessCode(dir);
      chmodSync(serverAccessCodePath(dir), 0o644);
      expect(() => serverAccessCode(dir)).toThrow(/chmod 600/u);
      chmodSync(serverAccessCodePath(dir), 0o600);
      writeFileSync(serverAccessCodePath(dir), 'short\n');
      expect(() => serverAccessCode(dir)).toThrow(/delete it/u);
      expect(readFileSync(serverAccessCodePath(dir), 'utf8')).toBe('short\n');
    },
  );

  it('takes a public URL that is a site only, and a port number', () => {
    expect(parsePublicOrigin('https://Agent.Example.com/')).toBe('https://agent.example.com');
    expect(parsePublicOrigin('http://agent.test:8080')).toBe('http://agent.test:8080');
    for (const bad of ['agent.example.com', 'ftp://a.b', 'https://a.b/path', 'https://u@a.b']) {
      expect(() => parsePublicOrigin(bad)).toThrow();
    }
    expect(parsePort(undefined, 7360, '--gui-port')).toBe(7360);
    expect(parsePort('8080', 7360, '--gui-port')).toBe(8080);
    for (const bad of ['0', '70000', 'x', '1.5']) {
      expect(() => parsePort(bad, 7360, '--gui-port')).toThrow(/--gui-port/u);
    }
  });
});
