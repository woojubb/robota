import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectProject } from '../context/project-detector.js';

const TMP_BASE = join(tmpdir(), 'robota-detector-test-' + process.pid);

function setupDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

describe('detectProject', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = join(TMP_BASE, 'proj-' + Math.random().toString(36).slice(2));
    setupDir(cwd);
  });

  afterEach(() => {
    if (existsSync(TMP_BASE)) {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });

  it('returns unknown when no recognizable files exist', async () => {
    const result = await detectProject(cwd);
    expect(result.type).toBe('unknown');
    expect(result.name).toBeUndefined();
    expect(result.packageManager).toBeUndefined();
    expect(result.language).toBe('unknown');
  });

  it('detects Node.js project from package.json', async () => {
    writeJson(join(cwd, 'package.json'), { name: 'my-app', version: '1.0.0' });
    const result = await detectProject(cwd);
    expect(result.type).toBe('node');
    expect(result.name).toBe('my-app');
  });

  it('detects TypeScript from tsconfig.json', async () => {
    writeJson(join(cwd, 'package.json'), { name: 'ts-proj' });
    writeJson(join(cwd, 'tsconfig.json'), { compilerOptions: {} });
    const result = await detectProject(cwd);
    expect(result.language).toBe('typescript');
  });

  it('detects pnpm as package manager from pnpm-workspace.yaml', async () => {
    writeJson(join(cwd, 'package.json'), { name: 'mono' });
    writeFileSync(join(cwd, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const result = await detectProject(cwd);
    expect(result.packageManager).toBe('pnpm');
  });

  it('detects npm as package manager from package-lock.json', async () => {
    writeJson(join(cwd, 'package.json'), { name: 'npm-proj' });
    writeFileSync(join(cwd, 'package-lock.json'), '{}');
    const result = await detectProject(cwd);
    expect(result.packageManager).toBe('npm');
  });

  it('detects yarn as package manager from yarn.lock', async () => {
    writeJson(join(cwd, 'package.json'), { name: 'yarn-proj' });
    writeFileSync(join(cwd, 'yarn.lock'), '');
    const result = await detectProject(cwd);
    expect(result.packageManager).toBe('yarn');
  });

  it('extracts project name from package.json', async () => {
    writeJson(join(cwd, 'package.json'), { name: '@scope/pkg-name' });
    const result = await detectProject(cwd);
    expect(result.name).toBe('@scope/pkg-name');
  });

  it('detects python project from pyproject.toml', async () => {
    writeFileSync(join(cwd, 'pyproject.toml'), '[tool.poetry]\nname = "myproject"\n');
    const result = await detectProject(cwd);
    expect(result.type).toBe('python');
    expect(result.language).toBe('python');
  });
});
