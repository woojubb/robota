import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectHookDiagnosticInventoryResults } from '../hook-diagnostic-producer.mjs';
import { loadHookDiagnosticMigrationManifest } from '../hook-diagnostic-inventory.mjs';
import { publishHookDiagnosticInventory, SCAN_COMMANDS } from '../run-all-scans.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('hook diagnostic inventory producer', () => {
  it('reports the checked-in inventory cleanly without becoming an exit-bearing scan', () => {
    const [result] = collectHookDiagnosticInventoryResults({
      root: ROOT,
      scanNames: SCAN_COMMANDS.map((scan) => scan.name),
      correlationId: 'hook-migration.full',
    });

    expect(result).toMatchObject({
      state: 'clean',
      correlationId: 'hook-migration.full',
      subject: { kind: 'hook-diagnostic-migration' },
    });
  });

  it('makes a registry mismatch visible as a canonical finding without changing a scan exit code', () => {
    const [result] = collectHookDiagnosticInventoryResults({
      root: ROOT,
      scanNames: SCAN_COMMANDS.slice(1).map((scan) => scan.name),
      correlationId: 'hook-migration.reuse',
    });

    expect(result).toMatchObject({
      state: 'finding',
      correlationId: 'hook-migration.reuse',
      detectorId: 'hook.diagnostic-migration-inventory',
    });
    expect(result.evidence.join('\n')).toContain('scan registrations differ');
  });

  it('does not collapse the duplicate PreTool source registration into a clean inventory', () => {
    const manifest = structuredClone(loadHookDiagnosticMigrationManifest(ROOT));
    manifest.preToolRegistrations.pop();
    const [result] = collectHookDiagnosticInventoryResults({
      root: ROOT,
      scanNames: SCAN_COMMANDS.map((scan) => scan.name),
      correlationId: 'hook-migration.full',
      manifest,
    });

    expect(result).toMatchObject({ state: 'finding' });
    expect(result.evidence.join('\n')).toContain('PreToolUse registrations differ');
  });

  it('publishes a freshly recomputed inventory on both full and receipt-reuse paths', async () => {
    const calls = [];
    const lines = [];
    const produce = ({ correlationId }) => {
      calls.push(correlationId);
      return [
        {
          version: 1,
          id: 'hook.fixture.inventory',
          detectorId: 'hook.fixture.inventory',
          correlationId,
          state: 'finding',
          subject: { kind: 'hook-diagnostic-migration', value: 'fixture' },
          examined: [{ kind: 'hook-diagnostic-migration', value: 'fixture' }],
          severity: 'warning',
          evidence: ['fixture mismatch'],
          recommendation: 'repair fixture',
        },
      ];
    };

    await publishHookDiagnosticInventory({
      root: ROOT,
      scanNames: [],
      correlationId: 'hook-migration.full',
      write: (line) => lines.push(line),
      produce,
    });
    await publishHookDiagnosticInventory({
      root: ROOT,
      scanNames: [],
      correlationId: 'hook-migration.reuse',
      write: (line) => lines.push(line),
      produce,
    });

    expect(calls).toEqual(['hook-migration.full', 'hook-migration.reuse']);
    expect(lines.join('\n')).toContain('hook.fixture.inventory');
  });
});
