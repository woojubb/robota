/**
 * HARNESS-098 fixture test for the CORE-046 route-spelling scan.
 *
 * The scan exists because a check with no fixture has never been shown to go red on the condition it
 * names — and the condition here is precisely one that stayed invisible for a long time. So the
 * cases below construct the disagreement rather than only the agreement: a scan that reports the
 * live tree is fine says nothing about whether it CAN say otherwise.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  examinedDeclarationCount,
  findRouteSpellingFindings,
  readStringConstant,
} from '../scan-remote-stream-route-spelling.mjs';

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A tree carrying just the two files the scan reads, with the spellings under test. */
function fixture({ served, suffix, omitServerFile = false }) {
  const root = makeTemp('route-spelling-');
  dirs.push(root);
  mkdirSync(path.join(root, 'apps/agent-server/src/routes'), { recursive: true });
  mkdirSync(path.join(root, 'packages/agent-remote-client/src/client'), { recursive: true });

  if (!omitServerFile) {
    writeFileSync(
      path.join(root, 'apps/agent-server/src/routes/provider-chat-stream.ts'),
      served === undefined
        ? 'export const SOMETHING_ELSE = 1;\n'
        : `export const REMOTE_CHAT_STREAM_PATH = '${served}';\n`,
    );
  }
  writeFileSync(
    path.join(root, 'packages/agent-remote-client/src/client/chat-stream-http.ts'),
    suffix === undefined
      ? 'export const SOMETHING_ELSE = 1;\n'
      : `export const REMOTE_CHAT_STREAM_SUFFIX = '${suffix}';\n`,
  );
  return root;
}

describe('remote-stream-route-spelling (CORE-046)', () => {
  it('passes when the two sides agree', () => {
    const root = fixture({ served: '/api/v1/remote/chat/stream', suffix: '/chat/stream' });
    expect(findRouteSpellingFindings(root)).toEqual([]);
  });

  it('(RED) reports the exact disagreement CORE-046 fixed — client /stream, server /chat/stream', () => {
    // The historical state, reconstructed. Every remote streaming call was a 404, and nothing said so.
    const root = fixture({ served: '/api/v1/remote/chat/stream', suffix: '/stream' });
    const findings = findRouteSpellingFindings(root);

    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('remote-stream-spelling-mismatch');
    expect(findings[0].detail).toMatch(/\/api\/v1\/remote\/stream/);
    expect(findings[0].detail).toMatch(/\/api\/v1\/remote\/chat\/stream/);
  });

  it('(RED) reports a server-side rename too, not only a client-side one', () => {
    // Both directions, because a check that only catches one is half a check.
    const root = fixture({ served: '/api/v2/remote/chat/stream', suffix: '/chat/stream' });
    expect(findRouteSpellingFindings(root)[0]?.type).toBe('remote-stream-spelling-mismatch');
  });

  it('(RED) fails closed when a declaration is gone, rather than reporting nothing to check', () => {
    const root = fixture({ served: undefined, suffix: '/chat/stream' });
    const findings = findRouteSpellingFindings(root);
    expect(findings[0]?.type).toBe('remote-stream-declaration-missing');
  });

  it('(RED) fails closed when the route FILE is gone — a move is when a spelling drifts', () => {
    const root = fixture({ suffix: '/chat/stream', omitServerFile: true });
    const findings = findRouteSpellingFindings(root);
    expect(findings[0]?.type).toBe('remote-stream-file-missing');
  });

  it('the examined count is the number of declarations read, and does not accumulate', () => {
    // measurement-provenance.md: an EXACT value against a fixture of known size, asserted again
    // after a second run so a counter that accumulates is told apart from a subject that grew.
    const root = fixture({ served: '/api/v1/remote/chat/stream', suffix: '/chat/stream' });
    findRouteSpellingFindings(root);
    expect(examinedDeclarationCount()).toBe(2);
    findRouteSpellingFindings(root);
    expect(examinedDeclarationCount()).toBe(2);
  });

  it('reads only a real string-literal declaration', () => {
    expect(readStringConstant("export const A = 'x';", 'A')).toBe('x');
    expect(readStringConstant('// mentions A in a comment', 'A')).toBeUndefined();
  });
});
