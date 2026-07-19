import { describe, expect, it } from 'vitest';

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
  it('enumerates exactly {tui, ws, webrtc, http, mcp} from code', () => {
    expect([...findTransportNames()].sort()).toEqual(['http', 'mcp', 'tui', 'webrtc', 'ws']);
  });
});
