import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadContext } from '../context/context-loader.js';

const TMP_BASE = join(tmpdir(), 'robota-context-test-' + process.pid);

function setupDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

describe('loadContext', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = join(TMP_BASE, 'root-' + Math.random().toString(36).slice(2));
    setupDir(rootDir);
  });

  afterEach(() => {
    if (existsSync(TMP_BASE)) {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });

  it('returns empty strings when no context files exist', async () => {
    const result = await loadContext(rootDir);
    expect(result.agentsMd).toBe('');
    expect(result.claudeMd).toBe('');
  });

  it('finds AGENTS.md in cwd', async () => {
    writeFileSync(join(rootDir, 'AGENTS.md'), '# Root AGENTS');
    const result = await loadContext(rootDir);
    expect(result.agentsMd).toContain('# Root AGENTS');
  });

  it('finds CLAUDE.md in cwd', async () => {
    writeFileSync(join(rootDir, 'CLAUDE.md'), '# Root CLAUDE');
    const result = await loadContext(rootDir);
    expect(result.claudeMd).toContain('# Root CLAUDE');
  });

  it('walks up directory tree and concatenates AGENTS.md files root-first', async () => {
    // root/AGENTS.md
    writeFileSync(join(rootDir, 'AGENTS.md'), '# Root');
    // root/sub/AGENTS.md
    const subDir = join(rootDir, 'sub');
    setupDir(subDir);
    writeFileSync(join(subDir, 'AGENTS.md'), '# Sub');
    // root/sub/deep  (no AGENTS.md here)
    const deepDir = join(subDir, 'deep');
    setupDir(deepDir);

    const result = await loadContext(deepDir);
    const lines = result.agentsMd.split('\n').filter((l) => l.trim());
    // root comes before sub in concatenated content
    const rootIdx = lines.findIndex((l) => l.includes('# Root'));
    const subIdx = lines.findIndex((l) => l.includes('# Sub'));
    expect(rootIdx).toBeGreaterThanOrEqual(0);
    expect(subIdx).toBeGreaterThanOrEqual(0);
    expect(rootIdx).toBeLessThan(subIdx);
  });

  it('concatenates AGENTS.md from multiple levels', async () => {
    writeFileSync(join(rootDir, 'AGENTS.md'), '# Level1');
    const sub = join(rootDir, 'a');
    setupDir(sub);
    writeFileSync(join(sub, 'AGENTS.md'), '# Level2');

    const result = await loadContext(sub);
    expect(result.agentsMd).toContain('# Level1');
    expect(result.agentsMd).toContain('# Level2');
  });

  it('deduplicates when same file would be found twice', async () => {
    writeFileSync(join(rootDir, 'AGENTS.md'), '# Unique');
    const result = await loadContext(rootDir);
    const count = (result.agentsMd.match(/# Unique/g) ?? []).length;
    expect(count).toBe(1);
  });
});
