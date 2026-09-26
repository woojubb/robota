import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  parseExternalEventGrant,
  readExternalEventGrantFiles,
  toExternalEventGrantDocument,
} from '../external-event-grant-file.js';
import {
  takeSupervisedGrantHandoff,
  writeSupervisedGrantHandoff,
} from '../../session-inventory/supervised-session-control.js';

import type { IExternalEventGrant } from '@robota-sdk/agent-interface-transport';

const VARIED: IExternalEventGrant[] = [
  {
    grantId: 'ci',
    verifier: {
      issuer: 'https://issuer.example/tenant',
      resource: 'https://robota.example/base/events/ci',
      algorithms: ['EdDSA'],
      requiredScopes: ['robota.events.submit', 'ci.read'],
      allowedClients: ['ci-bot'],
    },
    kinds: ['message'],
    rate: [
      { windowMs: 1_000, maxTurns: 1 },
      { windowMs: 86_400_000, maxTurns: 40 },
    ],
  },
  {
    grantId: 'chat_bridge-2',
    verifier: {
      issuer: 'https://login.example',
      resource: 'https://robota.example/events/chat_bridge-2',
      algorithms: ['RS256', 'ES256'],
      requiredScopes: ['robota.events.submit'],
      allowedSubjects: ['bridge@example'],
    },
    kinds: ['message'],
  },
];

const VALID = {
  grantId: 'ci',
  issuer: 'https://issuer.example',
  resource: 'https://robota.example/events/ci',
  client: 'ci-bot',
  scopes: ['robota.events.submit'],
};

describe('external event grant files', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rs-grant-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (name: string, body: unknown): string => {
    const path = join(dir, name);
    writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
    return path;
  };

  it('reads a grant that pins exactly one principal', () => {
    expect(readExternalEventGrantFiles([write('ci.json', VALID)])).toEqual([
      {
        grantId: 'ci',
        verifier: {
          issuer: 'https://issuer.example',
          resource: 'https://robota.example/events/ci',
          algorithms: ['RS256', 'ES256', 'EdDSA'],
          requiredScopes: ['robota.events.submit'],
          allowedClients: ['ci-bot'],
        },
        kinds: ['message'],
      },
    ]);
    const bySubject = parseExternalEventGrant(
      {
        ...VALID,
        client: undefined,
        subject: 'alice',
        algorithms: ['ES256'],
        rate: [{ windowMs: 1000, maxTurns: 2 }],
      },
      1,
    );
    expect(bySubject.verifier).toMatchObject({ allowedSubjects: ['alice'], algorithms: ['ES256'] });
    expect(bySubject.verifier).not.toHaveProperty('allowedClients');
    expect(bySubject.rate).toEqual([{ windowMs: 1000, maxTurns: 2 }]);
  });

  it.each([
    ['no principal', { ...VALID, client: undefined }, /grant ci: .*one subject or client/],
    ['two principals', { ...VALID, subject: 'alice' }, /grant ci: .*one subject or client/],
    ['a list of principals', { ...VALID, client: ['a', 'b'] }, /grant ci: .*one subject or client/],
    ['an http issuer', { ...VALID, issuer: 'http://issuer.example' }, /grant ci: invalid issuer/],
    [
      'a resource for another grant',
      { ...VALID, resource: 'https://robota.example/events/other' },
      /grant ci: invalid resource/,
    ],
    ['no scope', { ...VALID, scopes: [] }, /grant ci: invalid scopes/],
    [
      'an unsupported algorithm',
      { ...VALID, algorithms: ['HS256'] },
      /grant ci: invalid algorithms/,
    ],
    ['a bad rate', { ...VALID, rate: [{ windowMs: 0, maxTurns: 1 }] }, /grant ci: invalid rate/],
    ['an unknown field', { ...VALID, secret: 'SECRETVALUE' }, /grant ci: unknown field/],
    ['a bad label', { ...VALID, grantId: 'has space' }, /grant file 1: invalid grantId/],
  ])('refuses %s with a content-free reason', (_case, body, reason) => {
    const path = write('g.json', body);
    let message = '';
    try {
      readExternalEventGrantFiles([path]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(reason);
    for (const value of [
      'issuer.example',
      'ci-bot',
      'alice',
      'robota.events.submit',
      'SECRETVALUE',
      dir,
    ]) {
      expect(message).not.toContain(value);
    }
  });

  it('hands a grant on without losing or widening any field', () => {
    for (const grant of VARIED) {
      expect(parseExternalEventGrant(toExternalEventGrantDocument(grant), 1)).toEqual(grant);
    }
    const root = join(dir, 'supervised');
    const id = '0f6c3a5e-8c1b-4d2a-9f3e-1a2b3c4d5e6f';
    writeSupervisedGrantHandoff(root, id, VARIED);
    expect(takeSupervisedGrantHandoff(root, id)).toEqual(VARIED);
    expect(() => takeSupervisedGrantHandoff(root, id)).toThrow(/could not be read/);
  });

  it('refuses an unreadable, non-JSON, oversize or linked file, and a repeated label', () => {
    expect(() => readExternalEventGrantFiles([join(dir, 'missing.json')])).toThrow(
      /grant file 1: not readable/,
    );
    expect(() => readExternalEventGrantFiles([write('bad.json', '{')])).toThrow(
      /grant file 1: not JSON/,
    );
    expect(() => readExternalEventGrantFiles([write('big.json', ' '.repeat(20_000))])).toThrow(
      /grant file 1: not readable/,
    );
    const target = write('real.json', VALID);
    const link = join(dir, 'link.json');
    symlinkSync(target, link);
    expect(() => readExternalEventGrantFiles([link])).toThrow(/grant file 1: not readable/);
    expect(() => readExternalEventGrantFiles([target, write('again.json', VALID)])).toThrow(
      /grant ci: repeated/,
    );
  });
});
