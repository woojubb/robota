import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  buildPromptWithFileReferences,
  formatPromptFileReferenceDiagnostics,
  hasBlockingPromptFileReferenceDiagnostics,
  parsePromptFileReferences,
  resolvePromptFileReferences,
} from '../prompt-file-references.js';

async function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'robota-file-ref-'));
}

describe('prompt file references', () => {
  it('parses only path-like @ references and leaves command/user mentions alone', () => {
    const references = parsePromptFileReferences(
      'Read @AGENTS.md, ignore @agent and user@example.com, include @src/index.ts.',
    );

    expect(references.map((reference) => reference.path)).toEqual(['AGENTS.md', 'src/index.ts']);
  });

  it('resolves workspace files into structured records and model prompt blocks', async () => {
    const cwd = await createWorkspace();
    try {
      await mkdir(join(cwd, 'docs'));
      await writeFile(join(cwd, 'docs', 'guide.md'), '# Guide\nUse this file.\n');

      const result = await resolvePromptFileReferences('Explain @docs/guide.md', { cwd });

      expect(result.diagnostics).toEqual([]);
      expect(result.references).toEqual([
        expect.objectContaining({
          originalReference: '@docs/guide.md',
          relativePath: 'docs/guide.md',
          reason: 'prompt-reference',
          depth: 0,
        }),
      ]);
      expect(buildPromptWithFileReferences('Explain @docs/guide.md', result.references)).toContain(
        '<file path="docs/guide.md"',
      );
      expect(buildPromptWithFileReferences('Explain @docs/guide.md', result.references)).toContain(
        'Use this file.',
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('reports missing files as blocking diagnostics', async () => {
    const cwd = await createWorkspace();
    try {
      const result = await resolvePromptFileReferences('Read @missing.md', { cwd });

      expect(hasBlockingPromptFileReferenceDiagnostics(result.diagnostics)).toBe(true);
      expect(result.diagnostics[0]).toEqual(
        expect.objectContaining({
          code: 'not-found',
          reference: '@missing.md',
        }),
      );
      expect(formatPromptFileReferenceDiagnostics(result.diagnostics)).toContain('missing.md');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects references outside the workspace root', async () => {
    const parent = await createWorkspace();
    const cwd = join(parent, 'workspace');
    try {
      await mkdir(cwd);
      await writeFile(join(parent, 'secret.md'), 'secret');

      const result = await resolvePromptFileReferences('Read @../secret.md', { cwd });

      expect(result.diagnostics[0]).toEqual(
        expect.objectContaining({
          code: 'outside-root',
          reference: '@../secret.md',
        }),
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('rejects files above the configured size limits before adding content', async () => {
    const cwd = await createWorkspace();
    try {
      await writeFile(join(cwd, 'large.md'), '0123456789');

      const result = await resolvePromptFileReferences('Read @large.md', {
        cwd,
        limits: { maxFileBytes: 5 },
      });

      expect(result.references).toEqual([]);
      expect(result.diagnostics[0]).toEqual(
        expect.objectContaining({
          code: 'file-too-large',
          reference: '@large.md',
        }),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('detects circular nested references', async () => {
    const cwd = await createWorkspace();
    try {
      await writeFile(join(cwd, 'a.md'), 'A imports @b.md');
      await writeFile(join(cwd, 'b.md'), 'B imports @a.md');

      const result = await resolvePromptFileReferences('Read @a.md', { cwd });

      expect(result.references.map((reference) => reference.relativePath)).toEqual([
        'a.md',
        'b.md',
      ]);
      expect(result.diagnostics[0]).toEqual(
        expect.objectContaining({
          code: 'circular-reference',
          reference: '@a.md',
        }),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('reports max-depth diagnostics for excessive nested references', async () => {
    const cwd = await createWorkspace();
    try {
      await writeFile(join(cwd, 'a.md'), 'A imports @b.md');
      await writeFile(join(cwd, 'b.md'), 'B imports @c.md');
      await writeFile(join(cwd, 'c.md'), 'C content');

      const result = await resolvePromptFileReferences('Read @a.md', {
        cwd,
        limits: { maxDepth: 1 },
      });

      expect(result.references.map((reference) => reference.relativePath)).toEqual([
        'a.md',
        'b.md',
      ]);
      expect(result.diagnostics[0]).toEqual(
        expect.objectContaining({
          code: 'max-depth',
          reference: '@c.md',
        }),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
