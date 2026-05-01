import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ProjectMemoryStore,
  MEMORY_INDEX_MAX_LINES,
  MEMORY_INDEX_MAX_BYTES,
} from '../project-memory-store.js';

const TMP_BASE = join(tmpdir(), `robota-memory-store-${process.pid}`);

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('ProjectMemoryStore', () => {
  it('Given no memory files When loading startup memory Then returns empty content', () => {
    const store = new ProjectMemoryStore(makeProject());

    const memory = store.loadStartupMemory();

    expect(memory.content).toBe('');
    expect(memory.lineCount).toBe(0);
    expect(memory.truncated).toBe(false);
  });

  it('Given a MEMORY.md longer than the line cap When loading startup memory Then only first 200 lines are returned', () => {
    const cwd = makeProject();
    const memoryDir = join(cwd, '.robota', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    const lines = Array.from({ length: MEMORY_INDEX_MAX_LINES + 3 }, (_, index) => `line-${index}`);
    writeFileSync(join(memoryDir, 'MEMORY.md'), lines.join('\n'), 'utf8');
    const store = new ProjectMemoryStore(cwd);

    const memory = store.loadStartupMemory();

    expect(memory.lineCount).toBe(MEMORY_INDEX_MAX_LINES);
    expect(memory.content).toContain('line-0');
    expect(memory.content).toContain(`line-${MEMORY_INDEX_MAX_LINES - 1}`);
    expect(memory.content).not.toContain(`line-${MEMORY_INDEX_MAX_LINES}`);
    expect(memory.truncated).toBe(true);
  });

  it('Given a MEMORY.md larger than the byte cap When loading startup memory Then it is truncated without exceeding cap', () => {
    const cwd = makeProject();
    const memoryDir = join(cwd, '.robota', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'MEMORY.md'), 'x'.repeat(MEMORY_INDEX_MAX_BYTES + 20), 'utf8');
    const store = new ProjectMemoryStore(cwd);

    const memory = store.loadStartupMemory();

    expect(Buffer.byteLength(memory.content, 'utf8')).toBeLessThanOrEqual(MEMORY_INDEX_MAX_BYTES);
    expect(memory.truncated).toBe(true);
  });

  it('Given a memory item When appending Then index and topic files are created', () => {
    const cwd = makeProject();
    const store = new ProjectMemoryStore(cwd, () => new Date('2026-05-02T00:00:00.000Z'));

    const result = store.append({
      type: 'project',
      topic: 'Build Commands',
      text: 'Use pnpm for package scripts.',
    });

    expect(result.topic).toBe('build-commands');
    expect(readFileSync(join(cwd, '.robota', 'memory', 'MEMORY.md'), 'utf8')).toContain(
      '[2026-05-02] (project/build-commands) Use pnpm for package scripts.',
    );
    expect(readFileSync(result.topicPath, 'utf8')).toContain('Use pnpm for package scripts.');
  });

  it('Given topic files When listing memory Then returns topic names and paths', () => {
    const cwd = makeProject();
    const topicsDir = join(cwd, '.robota', 'memory', 'topics');
    mkdirSync(topicsDir, { recursive: true });
    writeFileSync(join(topicsDir, 'build.md'), '# Build\n', 'utf8');

    const summary = new ProjectMemoryStore(cwd).list();

    expect(summary.topics).toEqual([{ name: 'build', path: join(topicsDir, 'build.md') }]);
  });
});
