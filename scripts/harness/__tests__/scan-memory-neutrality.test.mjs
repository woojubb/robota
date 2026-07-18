import { describe, expect, it } from 'vitest';

import {
  findMemoryNeutralityFindings,
  findMemoryNeutralityFindingsInSource,
  isSeededMemoryContent,
} from '../scan-memory-neutrality.mjs';

/**
 * HARNESS-029 — the memory-neutrality mechanical floor.
 *
 * TC-02: flag a library capture-prompt (prompt/persona/instruction identifier + >=40-char string); suppress
 *        with `allow-memory-content: <reason>`.
 * TC-03: no false positives (short token / reference constants / comment).
 * TC-04: anti-rot (v1 = reason-less-only).
 * TC-05: the live packages/<pkg>/src tree is GREEN.
 * (TC-01 seeded-content is a file-path class exercised by the live-tree scan; asserted green here.)
 */

function kinds(src) {
  return findMemoryNeutralityFindingsInSource(src).map((f) => f.kind);
}

describe('HARNESS-029 TC-01 — seeded-memory-content file-path class', () => {
  it('flags a MEMORY.md or memory/topics/*.md corpus file under a package src', () => {
    expect(isSeededMemoryContent('packages/agent-framework/src/memory/MEMORY.md')).toBe(true);
    expect(isSeededMemoryContent('packages/agent-framework/src/memory/topics/build.md')).toBe(true);
  });

  it('does NOT flag ordinary source or non-corpus files', () => {
    expect(isSeededMemoryContent('packages/agent-framework/src/memory/types.ts')).toBe(false);
    expect(isSeededMemoryContent('packages/agent-framework/docs/SPEC.md')).toBe(false); // not under src corpus
    expect(isSeededMemoryContent('packages/agent-framework/src/memory/README.md')).toBe(false);
  });
});

describe('HARNESS-029 TC-02 — flags a library capture-prompt', () => {
  it('flags a prompt/persona/instruction identifier assigned a >=40-char string literal', () => {
    expect(
      kinds(
        `const CAPTURE_PROMPT = 'You are a memory curator. Extract durable facts from the turn.';`,
      ),
    ).toContain('library-capture-prompt');
    expect(
      kinds(
        'const capturePersona = "Remember durable project conventions and user preferences here.";',
      ),
    ).toContain('library-capture-prompt');
    expect(
      kinds(
        '  instructionText: `Summarize what is worth remembering across sessions for this repo.`,',
      ),
    ).toContain('library-capture-prompt');
  });

  it('reports the line number', () => {
    const findings = findMemoryNeutralityFindingsInSource(
      `const a = 1;\nconst promptTemplate = 'You are the curator; save the durable facts you observe now.';\n`,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
  });
});

describe('HARNESS-029 TC-02 — suppression by allow-memory-content: <reason>', () => {
  it('suppresses when a reasoned annotation is on the same line', () => {
    const src = `const PROMPT = 'You are a curator; extract durable facts.'; // allow-memory-content: neutral test-only fixture reused across surfaces`;
    expect(kinds(src)).not.toContain('library-capture-prompt');
  });

  it('suppresses when a reasoned annotation is on the line above', () => {
    const src = `// allow-memory-content: sanctioned neutral default reference prompt, surface-overridable\nconst PROMPT = 'You are a curator; extract the durable facts from this turn please.';`;
    expect(kinds(src)).not.toContain('library-capture-prompt');
  });
});

describe('HARNESS-029 TC-03 — no false positives', () => {
  it('does NOT flag a short prompt-named token', () => {
    expect(kinds(`const promptId = 'p1';`)).not.toContain('library-capture-prompt');
  });

  it('does NOT flag the neutral reference-policy constants (regex / numbers)', () => {
    expect(kinds('const AUTO_SAVE_CONFIDENCE_THRESHOLD = 0.85;')).not.toContain(
      'library-capture-prompt',
    );
    expect(kinds('const REMEMBER_PATTERNS = [/\\bremember\\s+(?:that\\s+)?(.+)/i];')).not.toContain(
      'library-capture-prompt',
    );
  });

  it('does NOT flag a `prompt` mention inside a comment or a non-prompt identifier', () => {
    expect(
      kinds(' * injected into the system prompt for the durable memory index and topics.'),
    ).not.toContain('library-capture-prompt');
    // a long string NOT assigned to a prompt/persona/instruction identifier is out of scope
    expect(
      kinds(
        `const errorMessage = 'a very long non-prompt message that exceeds forty characters ok';`,
      ),
    ).not.toContain('library-capture-prompt');
  });
});

describe('HARNESS-029 TC-04 — anti-rot (v1 = reason-less-only)', () => {
  it('flags a reason-less allow-memory-content comment', () => {
    expect(kinds('// allow-memory-content\nconst x = 1;')).toContain('reasonless-annotation');
    expect(kinds('// allow-memory-content:\nconst x = 1;')).toContain('reasonless-annotation');
  });

  it('does NOT flag a well-formed allow-memory-content: <reason>', () => {
    expect(
      kinds('// allow-memory-content: sanctioned neutral default, surface-overridable'),
    ).not.toContain('reasonless-annotation');
  });

  it('a reason-less allow-memory-content does NOT suppress a real capture-prompt (still flagged)', () => {
    const src = `// allow-memory-content\nconst PROMPT = 'You are a curator; extract the durable facts from this turn please.';`;
    const ks = kinds(src);
    expect(ks).toContain('library-capture-prompt');
    expect(ks).toContain('reasonless-annotation');
  });
});

describe('HARNESS-029 TC-05 — the live packages/*/src tree is green', () => {
  it('has zero memory-neutrality findings (no seeded corpus, no library capture prompt)', () => {
    expect(findMemoryNeutralityFindings()).toEqual([]);
  });
});
