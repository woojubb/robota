import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findAdrFindings } from '../check-adr-completeness.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../check-adr-completeness.mjs', import.meta.url));

const GREEN_ADR = `# ADR-001: use a session store

## Status

accepted

## Context

Why the decision came up.

## Alternatives Considered

The options weighed.

## Decision

What was chosen.

## Consequences

What follows.
`;

async function createAdrDir(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-adr-'));
  const adrDir = path.join(root, '.design/decisions');
  mkdirSync(adrDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(adrDir, name), content, 'utf8');
  }
  return adrDir;
}

describe('findAdrFindings', () => {
  it('passes an ADR with all MUST sections and a legal status', async () => {
    const adrDir = await createAdrDir({ 'ADR-001-store.md': GREEN_ADR });
    expect(findAdrFindings(adrDir)).toEqual([]);
  });

  it.each(['Status', 'Context', 'Alternatives Considered', 'Decision', 'Consequences'])(
    'flags an ADR missing the "%s" MUST section (RED)',
    async (label) => {
      const adrDir = await createAdrDir({
        'ADR-002-broken.md': GREEN_ADR.replace(`## ${label}`, '## Renamed'),
      });

      const findings = findAdrFindings(adrDir);
      expect(findings.map((f) => f.detail)).toContain(`missing "## ${label}" section`);
    },
  );

  it('flags an illegal Status value (RED)', async () => {
    const adrDir = await createAdrDir({
      'ADR-003-badstatus.md': GREEN_ADR.replace('accepted', 'probably fine'),
    });

    const findings = findAdrFindings(adrDir);
    expect(findings.map((f) => f.detail)).toContain(
      'Status "probably fine" is not one of proposed / accepted / superseded / rejected / deprecated.',
    );
  });

  it('is vacuously clean when the target dir has no ADRs', async () => {
    const adrDir = await createAdrDir({});
    expect(findAdrFindings(adrDir)).toEqual([]);
  });
});

describe('check-adr-completeness CLI', () => {
  function runScan(args) {
    try {
      const stdout = execFileSync(process.execPath, [SCAN_SCRIPT, ...args], { encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: `${error.stdout ?? ''}` };
    }
  }

  it('exits 0 with a pass message on a green fixture dir', async () => {
    const adrDir = await createAdrDir({ 'ADR-001-store.md': GREEN_ADR });
    const result = runScan([adrDir]);
    expect(result.stdout).toContain('ADR completeness scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists findings on a violating fixture (RED)', async () => {
    const adrDir = await createAdrDir({
      'ADR-002-broken.md': GREEN_ADR.replace('## Consequences', '## Renamed'),
    });

    const result = runScan([adrDir]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('ADR completeness scan failed:');
    expect(result.stdout).toContain('missing "## Consequences" section');
  });
});
