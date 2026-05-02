import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AutomaticMemoryController,
  renderRetrievedMemory,
} from '../automatic-memory-controller.js';
import { RegexMemoryCandidateExtractor } from '../memory-candidate-extractor.js';
import { MemoryPolicyEvaluator } from '../memory-policy-evaluator.js';
import { MemoryRetrievalService } from '../memory-retrieval-service.js';
import { ProjectMemoryStore } from '../project-memory-store.js';
import type { IMemoryCandidate } from '../automatic-memory-types.js';

const TMP_BASE = join(tmpdir(), `robota-automatic-memory-${process.pid}`);
const NOW = new Date('2026-05-02T00:00:00.000Z');

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
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

  it('Given disabled policy When capture runs Then no pending or saved entries are created', () => {
    const cwd = makeProject();
    const controller = new AutomaticMemoryController({
      cwd,
      now: () => NOW,
      config: { policy: 'disabled', retrieval: { maxTopics: 3, maxTopicChars: 3000 } },
    });

    const result = controller.capture({
      sessionId: 'session-1',
      turnId: 'turn-1',
      userMessage: 'remember that this project uses pnpm',
      assistantMessage: 'ok',
    });

    expect(result.saved).toEqual([]);
    expect(result.queued).toEqual([]);
    expect(result.events.map((event) => event.type)).toContain('memory_candidate_skipped');
    expect(new ProjectMemoryStore(cwd).loadStartupMemory().content).toBe('');
  });

  it('Given approval required policy When capture runs Then candidates are queued instead of saved', () => {
    const cwd = makeProject();
    const controller = new AutomaticMemoryController({
      cwd,
      now: () => NOW,
      config: {
        policy: 'approval_required',
        retrieval: { maxTopics: 3, maxTopicChars: 3000 },
      },
    });

    const result = controller.capture({
      sessionId: 'session-1',
      turnId: 'turn-1',
      userMessage: 'remember that this project uses pnpm',
      assistantMessage: 'ok',
    });

    expect(result.saved).toEqual([]);
    expect(result.queued).toHaveLength(1);
    expect(result.queued[0]?.status).toBe('pending');
    expect(new ProjectMemoryStore(cwd).loadStartupMemory().content).toBe('');
  });

  it('Given auto save policy When a high confidence candidate is captured Then memory is saved', () => {
    const cwd = makeProject();
    const controller = new AutomaticMemoryController({
      cwd,
      now: () => NOW,
      config: { policy: 'auto_save', retrieval: { maxTopics: 3, maxTopicChars: 3000 } },
    });

    const result = controller.capture({
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
  });

  it('Given a duplicate memory candidate When saving runs Then the topic entry is not repeated', () => {
    const cwd = makeProject();
    const store = new ProjectMemoryStore(cwd, () => NOW);

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

    const topicFile = readFileSync(first.topicPath, 'utf8');
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(topicFile.match(/Use pnpm for package scripts\./g)).toHaveLength(1);
  });

  it('Given a topic-related query When retrieval runs Then matching topics and provenance are returned', () => {
    const cwd = makeProject();
    const store = new ProjectMemoryStore(cwd, () => NOW);
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

    const retrieval = new MemoryRetrievalService(cwd).retrieve(
      'How should I run package scripts?',
      {
        policy: 'approval_required',
        retrieval: { maxTopics: 1, maxTopicChars: 1000 },
      },
    );

    expect(retrieval.references).toEqual([
      expect.objectContaining({
        topic: 'build',
        path: join(cwd, '.robota', 'memory', 'topics', 'build.md'),
      }),
    ]);
    expect(retrieval.content).toContain('Use pnpm for package scripts.');
    expect(renderRetrievedMemory(retrieval)).toContain('<project-memory>');
  });

  it('Given no relevant topics When retrieval runs Then no memory is injected', () => {
    const cwd = makeProject();
    new ProjectMemoryStore(cwd, () => NOW).append({
      type: 'project',
      topic: 'release',
      text: 'Publish with changesets.',
    });

    const retrieval = new MemoryRetrievalService(cwd).retrieve('unrelated database question', {
      policy: 'approval_required',
      retrieval: { maxTopics: 3, maxTopicChars: 1000 },
    });

    expect(retrieval.references).toEqual([]);
    expect(renderRetrievedMemory(retrieval)).toBe('');
  });
});
