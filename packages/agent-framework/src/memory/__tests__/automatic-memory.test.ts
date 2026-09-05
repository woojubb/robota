import { existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import {
  AutomaticMemoryController,
  renderRetrievedMemory,
} from '../automatic-memory-controller.js';
import {
  DEFAULT_MEMORY_EXTRACTOR_POLICY,
  RegexMemoryCandidateExtractor,
} from '../memory-candidate-extractor.js';
import { MemoryPolicyEvaluator } from '../memory-policy-evaluator.js';
import { MemoryRetrievalService } from '../memory-retrieval-service.js';
import { ProjectMemoryStore } from '../project-memory-store.js';
import { createWorkspaceMemoryStore } from '../file-system-memory-store.js';
import { createTrustedProjectStateFixture } from '../../testing/trusted-project-state-fixture.js';

import type { IMemoryCandidate } from '../automatic-memory-types.js';

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'robota-automatic-memory-')));
const NOW = new Date('2026-05-02T00:00:00.000Z');

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function projectStore(cwd: string): Promise<ProjectMemoryStore> {
  return new ProjectMemoryStore(await createTrustedProjectStateFixture(cwd, 'memory'), () => NOW);
}

function makeCandidate(overrides?: Partial<IMemoryCandidate>): IMemoryCandidate {
  return {
    id: 'mem_test',
    type: 'project',
    topic: 'project',
    text: 'Use pnpm for package scripts.',
    sourceMessageIds: ['turn-1:user'],
    confidence: 0.9,
    createdAt: NOW.toISOString(),
    reason: 'explicit-memory-cue',
    ...overrides,
  };
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('automatic memory pipeline', () => {
  it('Given a durable project fact When extraction runs Then a structured candidate is emitted', () => {
    const extractor = new RegexMemoryCandidateExtractor();

    const candidates = extractor.extract({
      sessionId: 'session-1',
      turnId: 'turn-1',
      userMessage: 'remember that this project uses pnpm for package scripts',
      assistantMessage: 'Noted.',
      now: NOW,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      type: 'project',
      topic: 'project',
      text: 'this project uses pnpm for package scripts',
      sourceMessageIds: ['turn-1:user'],
      confidence: 0.9,
      createdAt: NOW.toISOString(),
    });
    expect(candidates[0]?.id).toMatch(/^mem_[a-f0-9]{12}$/);
  });

  it('Given sensitive content When policy evaluates Then it skips the candidate', () => {
    const evaluator = new MemoryPolicyEvaluator();

    const decision = evaluator.evaluate(makeCandidate({ text: 'api key is sk-test-secret' }), {
      policy: 'auto_save',
      retrieval: { maxTopics: 3, maxTopicChars: 3000 },
    });

    expect(decision).toEqual({ action: 'skip', reason: 'sensitive-content' });
  });

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given disabled policy When capture runs Then no pending or saved entries are created',
    async () => {
      const cwd = makeProject();
      const store = await projectStore(cwd);
      const controller = new AutomaticMemoryController({
        now: () => NOW,
        config: { policy: 'disabled', retrieval: { maxTopics: 3, maxTopicChars: 3000 } },
        memoryStore: createWorkspaceMemoryStore(
          await createTrustedProjectStateFixture(cwd, 'memory'),
          () => NOW,
        ),
      });

      const result = await controller.capture({
        sessionId: 'session-1',
        turnId: 'turn-1',
        userMessage: 'remember that this project uses pnpm',
        assistantMessage: 'ok',
      });

      expect(result.saved).toEqual([]);
      expect(result.queued).toEqual([]);
      expect(result.events.map((event) => event.type)).toContain('memory_candidate_skipped');
      expect(store.loadStartupMemory().content).toBe('');
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given approval required policy When capture runs Then candidates are queued instead of saved',
    async () => {
      const cwd = makeProject();
      const store = await projectStore(cwd);
      const controller = new AutomaticMemoryController({
        now: () => NOW,
        config: {
          policy: 'approval_required',
          retrieval: { maxTopics: 3, maxTopicChars: 3000 },
        },
        memoryStore: createWorkspaceMemoryStore(
          await createTrustedProjectStateFixture(cwd, 'memory'),
          () => NOW,
        ),
      });

      const result = await controller.capture({
        sessionId: 'session-1',
        turnId: 'turn-1',
        userMessage: 'remember that this project uses pnpm',
        assistantMessage: 'ok',
      });

      expect(result.saved).toEqual([]);
      expect(result.queued).toHaveLength(1);
      expect(result.queued[0]?.status).toBe('pending');
      expect(store.loadStartupMemory().content).toBe('');
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given auto save policy When a high confidence candidate is captured Then memory is saved',
    async () => {
      const cwd = makeProject();
      const controller = new AutomaticMemoryController({
        now: () => NOW,
        config: { policy: 'auto_save', retrieval: { maxTopics: 3, maxTopicChars: 3000 } },
        memoryStore: createWorkspaceMemoryStore(
          await createTrustedProjectStateFixture(cwd, 'memory'),
          () => NOW,
        ),
      });

      const result = await controller.capture({
        sessionId: 'session-1',
        turnId: 'turn-1',
        userMessage: 'remember that this project uses pnpm',
        assistantMessage: 'ok',
      });

      expect(result.queued).toEqual([]);
      expect(result.saved).toHaveLength(1);
      expect(readFileSync(join(cwd, '.robota', 'memory', 'MEMORY.md'), 'utf8')).toContain(
        '(project/project) this project uses pnpm',
      );
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given a duplicate memory candidate When saving runs Then the topic entry is not repeated',
    async () => {
      const cwd = makeProject();
      const store = await projectStore(cwd);

      const first = store.append({
        type: 'project',
        topic: 'build',
        text: 'Use pnpm for package scripts.',
      });
      const second = store.append({
        type: 'project',
        topic: 'build',
        text: 'Use pnpm for package scripts.',
      });

      const topicFile = readFileSync(join(cwd, first.topicPath), 'utf8');
      expect(first.deduplicated).toBe(false);
      expect(second.deduplicated).toBe(true);
      expect(topicFile.match(/Use pnpm for package scripts\./g)).toHaveLength(1);
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given a topic-related query When retrieval runs Then matching topics and provenance are returned',
    async () => {
      const cwd = makeProject();
      const store = await projectStore(cwd);
      store.append({
        type: 'project',
        topic: 'build',
        text: 'Use pnpm for package scripts.',
      });
      store.append({
        type: 'project',
        topic: 'release',
        text: 'Publish with changesets.',
      });

      const retrieval = new MemoryRetrievalService(store).retrieve(
        'How should I run package scripts?',
        {
          maxTopics: 1,
          maxTopicChars: 1000,
        },
      );

      expect(retrieval.references).toEqual([
        expect.objectContaining({
          topic: 'build',
          path: join('.robota', 'memory', 'topics', 'build.md'),
        }),
      ]);
      expect(retrieval.content).toContain('Use pnpm for package scripts.');
      expect(renderRetrievedMemory(retrieval)).toContain('<project-memory>');
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given no relevant topics When retrieval runs Then no memory is injected',
    async () => {
      const cwd = makeProject();
      const store = await projectStore(cwd);
      store.append({
        type: 'project',
        topic: 'release',
        text: 'Publish with changesets.',
      });

      const retrieval = new MemoryRetrievalService(store).retrieve('unrelated database question', {
        maxTopics: 3,
        maxTopicChars: 1000,
      });

      expect(retrieval.references).toEqual([]);
      expect(renderRetrievedMemory(retrieval)).toBe('');
    },
  );
});

/** NEUT-007 — locale/domain heuristics are an injectable policy, not baked-in library text. */
describe('NEUT-007 injectable extractor policy', () => {
  const baseInput = {
    sessionId: 'session-1',
    turnId: 'turn-1',
    assistantMessage: 'Noted.',
    now: NOW,
  };

  it('a custom policy replaces the default triggers and vocabulary', () => {
    const extractor = new RegexMemoryCandidateExtractor({
      triggers: [{ pattern: /\bnote this[:\s]+(.+)/i, confidence: 0.8 }],
      projectTerms: /\bcodebase\b/i,
      preferenceTerms: /\blikes\b/i,
    });

    const custom = extractor.extract({
      ...baseInput,
      userMessage: 'note this: the codebase uses bazel',
    });
    expect(custom).toHaveLength(1);
    expect(custom[0]).toMatchObject({ type: 'project', confidence: 0.8 });

    const englishDefault = extractor.extract({
      ...baseInput,
      userMessage: 'remember that this project uses pnpm',
    });
    expect(englishDefault).toHaveLength(0);

    const koreanDefault = extractor.extract({
      ...baseInput,
      userMessage: '기억해: 이 프로젝트는 pnpm을 사용한다',
    });
    expect(koreanDefault).toHaveLength(0);
  });

  it('the default policy is an exported, documented value and the default path is unchanged', () => {
    expect(DEFAULT_MEMORY_EXTRACTOR_POLICY.triggers.length).toBeGreaterThan(0);

    const extractor = new RegexMemoryCandidateExtractor();
    const candidates = extractor.extract({
      ...baseInput,
      userMessage: 'remember that this project uses pnpm for package scripts',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ type: 'project', confidence: 0.9 });
  });
});
