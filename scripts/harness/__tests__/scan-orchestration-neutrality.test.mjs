import { describe, expect, it } from 'vitest';

import {
  findNeutralityViolationsInSource,
  findOrchestrationNeutralityFindings,
} from '../scan-orchestration-neutrality.mjs';

/** Convenience: does this source produce at least one neutrality violation? */
function fails(src) {
  return findNeutralityViolationsInSource(src, 'fixture.ts').length > 0;
}

describe('scan-orchestration-neutrality (SELFHOST-001 TC-05) — FAIL cases', () => {
  it('flags the bare app-domain words', () => {
    expect(fails('export interface X { room: string; }')).toBe(true);
    expect(fails('export interface X { persona: string; }')).toBe(true);
    expect(fails('export interface X { topic: string; }')).toBe(true);
  });

  // The realistic smuggling vector is a camelCase identifier, NOT the bare word —
  // whole-word matching would let these pass. This is the guarantee P2/P3 rely on.
  it('flags the camelCase identifier vector (roomId / chatRoom / personaName / topicTitle)', () => {
    expect(fails('export interface X { roomId: string; }')).toBe(true);
    expect(fails('export interface X { chatRoom: string; }')).toBe(true);
    expect(fails('export interface X { personaName: string; }')).toBe(true);
    expect(fails('export interface X { topicTitle: string; }')).toBe(true);
    expect(fails('export interface X { conversationTopic: string; }')).toBe(true);
  });

  it('reports the line number of the violation', () => {
    const findings = findNeutralityViolationsInSource('const a = 1;\nconst roomId = 2;\n');
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(2);
  });
});

describe('scan-orchestration-neutrality — PASS cases', () => {
  it('does not flag the neutral orchestration vocabulary', () => {
    expect(fails('export type TOrchestrationPrimitive = "sequential" | "parallel";')).toBe(false);
    expect(
      fails('export interface IOrchestrationStep { id: string; label: string; prompt: string; }'),
    ).toBe(false);
    expect(
      fails('  primitive: TOrchestrationPrimitive; stepId?: string; stepIndex?: number;'),
    ).toBe(false);
  });

  it('the live orchestration source is currently clean', () => {
    expect(findOrchestrationNeutralityFindings()).toEqual([]);
  });
});
