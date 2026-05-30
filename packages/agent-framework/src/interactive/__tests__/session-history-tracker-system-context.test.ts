/**
 * Tests for SessionHistoryTracker system context file tracking.
 *
 * Verifies that AGENTS.md / CLAUDE.md files loaded at session startup
 * appear in listContextReferences() with loadType='system', and that
 * clearContextReferences() does not remove them.
 */

import { describe, it, expect, vi } from 'vitest';

import { SessionHistoryTracker } from '../interactive-session-history-tracker.js';

import type { IContextFileEntry } from '../../context/context-file-tracker.js';

function createTracker(): SessionHistoryTracker {
  return new SessionHistoryTracker(
    '/workspace',
    () => 'test-session',
    () => false,
    vi.fn(),
    vi.fn(),
  );
}

function makeEntry(filePath: string, content: string): IContextFileEntry {
  return { filePath, content, contentHash: 'abc123' };
}

describe('SessionHistoryTracker — system context files', () => {
  it('recordSystemContextFiles populates listContextReferences with system loadType', () => {
    const tracker = createTracker();
    tracker.recordSystemContextFiles([
      makeEntry('/workspace/AGENTS.md', 'agent rules'),
      makeEntry('/workspace/CLAUDE.md', 'claude rules'),
    ]);

    const refs = tracker.listContextReferences();
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual(
      expect.objectContaining({
        relativePath: 'AGENTS.md',
        sourcePath: '/workspace/AGENTS.md',
        loadType: 'system',
        status: 'active',
        byteLength: Buffer.byteLength('agent rules', 'utf-8'),
      }),
    );
    expect(refs[1]).toEqual(
      expect.objectContaining({
        relativePath: 'CLAUDE.md',
        loadType: 'system',
        status: 'active',
      }),
    );
  });

  it('listContextReferences returns system refs before user-added refs', () => {
    const tracker = createTracker();
    tracker.recordSystemContextFiles([makeEntry('/workspace/AGENTS.md', 'rules')]);
    tracker.recordContextReferenceUsage([
      {
        originalReference: '@notes.md',
        sourcePath: '/workspace/notes.md',
        relativePath: 'notes.md',
        reason: 'manual',
        depth: 0,
        byteLength: 42,
      },
    ]);

    const refs = tracker.listContextReferences();
    expect(refs[0]?.loadType).toBe('system');
    expect(refs[0]?.relativePath).toBe('AGENTS.md');
    expect(refs[1]?.loadType).toBe('manual');
    expect(refs[1]?.relativePath).toBe('notes.md');
  });

  it('clearContextReferences does not remove system refs', () => {
    const tracker = createTracker();
    tracker.recordSystemContextFiles([makeEntry('/workspace/AGENTS.md', 'rules')]);

    tracker.clearContextReferences();

    const refs = tracker.listContextReferences();
    expect(refs).toHaveLength(1);
    expect(refs[0]?.loadType).toBe('system');
  });

  it('listInjectionContextReferences excludes system refs to prevent duplicate injection', () => {
    const tracker = createTracker();
    tracker.recordSystemContextFiles([makeEntry('/workspace/AGENTS.md', 'rules')]);
    tracker.recordContextReferenceUsage([
      {
        originalReference: '@notes.md',
        sourcePath: '/workspace/notes.md',
        relativePath: 'notes.md',
        reason: 'manual',
        depth: 0,
        byteLength: 42,
      },
    ]);

    const injectionRefs = tracker.listInjectionContextReferences();
    expect(injectionRefs).toHaveLength(1);
    expect(injectionRefs[0]?.loadType).toBe('manual');
    expect(injectionRefs[0]?.relativePath).toBe('notes.md');

    const allRefs = tracker.listContextReferences();
    expect(allRefs).toHaveLength(2);
  });

  it('regression: system refs cannot be duplicated as manual by simulated prompt execution', () => {
    // This is the exact regression scenario:
    // Before the fix, getContextReferences() returned listContextReferences() which included
    // system refs. preparePromptInput resolved them as 'manual', and recordContextReferenceUsage
    // added AGENTS.md again with loadType='manual', causing double display.
    //
    // After the fix, getContextReferences() calls listInjectionContextReferences() (no system
    // refs), so the manual conversion never happens.
    const tracker = createTracker();

    tracker.recordSystemContextFiles([
      makeEntry('/workspace/AGENTS.md', 'agent rules'),
      makeEntry('/workspace/CLAUDE.md', 'claude rules'),
    ]);

    // Simulate execution controller: get injection refs (what preparePromptInput receives)
    const injectionRefs = tracker.listInjectionContextReferences();

    // Convert to records as preparePromptInput would (manual reason)
    const resolvedAsManual = injectionRefs.map((r) => ({
      originalReference: r.originalReference,
      sourcePath: r.sourcePath,
      relativePath: r.relativePath,
      reason: 'manual' as const,
      depth: 0,
      byteLength: r.byteLength,
    }));

    // Simulate recordContextReferenceUsage after prompt execution
    tracker.recordContextReferenceUsage(resolvedAsManual);

    // Verify: injection refs are empty for system-only sessions,
    // so no manual entries were created
    const allRefs = tracker.listContextReferences();
    expect(allRefs).toHaveLength(2);
    expect(allRefs.every((r) => r.loadType === 'system')).toBe(true);
    expect(allRefs.filter((r) => r.relativePath === 'AGENTS.md')).toHaveLength(1);
    expect(allRefs.filter((r) => r.relativePath === 'CLAUDE.md')).toHaveLength(1);
  });

  it('recordSystemContextFiles with empty array clears previous system refs', () => {
    const tracker = createTracker();
    tracker.recordSystemContextFiles([makeEntry('/workspace/AGENTS.md', 'rules')]);
    tracker.recordSystemContextFiles([]);

    expect(tracker.listContextReferences()).toHaveLength(0);
  });

  it('recordSystemContextFiles replaces previous system refs on reload', () => {
    const tracker = createTracker();
    tracker.recordSystemContextFiles([makeEntry('/workspace/AGENTS.md', 'v1')]);
    tracker.recordSystemContextFiles([
      makeEntry('/workspace/AGENTS.md', 'v2'),
      makeEntry('/workspace/CLAUDE.md', 'new'),
    ]);

    const refs = tracker.listContextReferences();
    expect(refs).toHaveLength(2);
    expect(refs[0]?.byteLength).toBe(Buffer.byteLength('v2', 'utf-8'));
  });
});
