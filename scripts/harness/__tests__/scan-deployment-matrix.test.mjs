import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTemp } from './make-temp.mjs';

import {
  diffDeploymentMatrix,
  findMatrixNames,
  findTransportNames,
} from '../scan-deployment-matrix.mjs';

/**
 * SELFHOST-013 TC-02 — the deployment-matrix drift floor: code-enumerated transport `name`s ↔ matrix rows.
 */

describe('findMatrixNames — parses the Transport-`name` column, skipping header/separator', () => {
  const matrix = [
    '| Surface | Runtime | Transport `name` | Client / presentation | Prior art |',
    '| ------- | ------- | ---------------- | --------------------- | --------- |',
    '| CLI | local | `tui` | `agent-transport` print | — |',
    '| Desktop | serve | `ws` (nonce auth) | `agent-transport-gui` | GUI-002 |',
    '| HTTP | serve | `http` / `ws` | — | RUNTIME-001 |',
    '| MCP | any | `mcp` | — | — |',
  ].join('\n');

  it('extracts exactly the transport names (not the header `name`, not client packages)', () => {
    expect([...findMatrixNames(matrix)].sort()).toEqual(['http', 'mcp', 'tui', 'ws']);
  });

  it('locates the Transport column by header, robust to a reordered/inserted column', () => {
    const reordered = [
      '| Surface | Transport `name` | Runtime | Client |',
      '| ------- | ---------------- | ------- | ------ |',
      '| CLI | `tui` | local | `agent-transport` print |',
      '| Web | `ws` | serve | `agent-transport-webrtc-web` |',
    ].join('\n');
    expect([...findMatrixNames(reordered)].sort()).toEqual(['tui', 'ws']);
  });
});

describe('diffDeploymentMatrix — undocumented + phantom', () => {
  it('flags a code transport missing from the matrix (undocumented)', () => {
    const { undocumented, phantom } = diffDeploymentMatrix(
      new Set(['tui', 'ws', 'grpc']),
      new Set(['tui', 'ws']),
    );
    expect(undocumented).toEqual(['grpc']);
    expect(phantom).toEqual([]);
  });

  it('flags a matrix row naming a nonexistent transport (phantom)', () => {
    const { undocumented, phantom } = diffDeploymentMatrix(
      new Set(['tui', 'ws']),
      new Set(['tui', 'ws', 'carrierpigeon']),
    );
    expect(undocumented).toEqual([]);
    expect(phantom).toEqual(['carrierpigeon']);
  });

  it('is clean when the sets agree', () => {
    const { undocumented, phantom } = diffDeploymentMatrix(
      new Set(['tui', 'ws']),
      new Set(['ws', 'tui']),
    );
    expect(undocumented).toEqual([]);
    expect(phantom).toEqual([]);
  });
});

describe('findTransportNames — the live transport packages', () => {
  it('walks framework transport-host without including unrelated framework transports', () => {
    const root = makeTemp('robota-deployment-host-');
    const files = {
      'packages/agent-framework/src/transport-host/headless/headless-transport.ts':
        "export const value = { name: 'headless' };",
      'packages/agent-framework/src/other-transport.ts':
        "export const value = { name: 'unrelated' };",
      'packages/agent-transport/src/retained-transport.ts':
        "export const value = { name: 'retained' };",
      'packages/agent-transport-http/src/http-transport.ts':
        "export const value = { name: 'http' };",
    };
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), source);
    }
    expect([...findTransportNames(root)].sort()).toEqual(['headless', 'http', 'retained']);
  });
  /**
   * HARNESS-052. `headless` joined this set without a transport being written: the enumerator
   * filtered on the directory prefix `agent-transport-`, so `packages/agent-transport` — the base
   * package, where `createHeadlessTransport` declares `name: 'headless'` in exactly the factory form
   * this scan parses — could never contribute. This assertion, and the matrix line it mirrors,
   * asserted a complete set that the code contradicted.
   */
  it('enumerates exactly {headless, ws, webrtc, http, mcp} adapter names from code', () => {
    expect([...findTransportNames()].sort()).toEqual(['headless', 'http', 'mcp', 'webrtc', 'ws']);
  });

  it('retains headless after its implementation moves to the framework host owner', () => {
    expect([...findTransportNames()]).toContain('headless');
  });

  /**
   * The other half of the repair, kept honest: the `*transport*.ts` filename filter stays. Dropping
   * it also matches `name: 'robota-agent'` and `name: 'submit'` in `mcp-server.ts` — unrelated
   * object literals. Widening a rule until it fires on correct data is how a floor gets suppressed.
   */
  it('does not pick up unrelated `name:` literals from non-transport modules', () => {
    const names = findTransportNames();
    expect(names.has('submit')).toBe(false);
    expect(names.has('robota-agent')).toBe(false);
  });
});
