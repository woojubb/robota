import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readDagFileArg } from '../commands/read-dag-file-arg.js';

/**
 * DAG-002 — the CLI half of the import adapter.
 *
 * `runs submit` read the file and asserted the workflow-file shape with a bare cast, so a definition
 * file (or anything else) reached the provider mislabelled and failed later, somewhere else, as
 * something else. The three ways this can go wrong all used to surface as an unhandled stack trace
 * from the CLI entry point; each is now a message and a usage exit code.
 */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fileWith(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'read-dag-arg-'));
  dirs.push(dir);
  const file = path.join(dir, 'w.json');
  writeFileSync(file, contents);
  return file;
}

describe('readDagFileArg', () => {
  it('reads a definition file as the domain model', async () => {
    const file = fileWith(
      JSON.stringify({ dagId: 'd', version: 1, status: 'draft', nodes: [], edges: [] }),
    );
    const result = await readDagFileArg(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dagId).toBe('d');
  });

  it('reads a workflow file, converting it', async () => {
    const file = fileWith(
      JSON.stringify({ nodes: [], links: [], version: 0.4, last_node_id: 0, last_link_id: 0 }),
    );
    const result = await readDagFileArg(file);
    expect(result.ok).toBe(true);
  });

  it('reports a file that is neither format instead of passing it on', async () => {
    const result = await readDagFileArg(fileWith(JSON.stringify({ something: 'else' })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Not a DAG file/);
  });

  it('reports unparseable JSON', async () => {
    const result = await readDagFileArg(fileWith('{ not json'));
    expect(result.ok).toBe(false);
  });

  it('reports a missing file rather than throwing', async () => {
    // Inside a mkdtemp dir, not joined onto `tmpdir()` directly — a predictable temp path is what
    // the SEC-003 floor exists to stop, and it caught the first draft of this very case.
    const dir = mkdtempSync(path.join(tmpdir(), 'read-dag-arg-'));
    dirs.push(dir);
    const result = await readDagFileArg(path.join(dir, 'absent.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('absent.json');
  });
});
