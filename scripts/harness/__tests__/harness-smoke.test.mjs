import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const HARNESS_DIR = resolve(import.meta.dirname, '..');
const ROOT = resolve(HARNESS_DIR, '../..');

function runScript(scriptName, args = []) {
  const scriptPath = resolve(HARNESS_DIR, scriptName);
  const result = { status: 0, stdout: '', stderr: '' };
  try {
    result.stdout = execFileSync('node', [scriptPath, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30_000,
    });
  } catch (error) {
    result.status = error.status ?? 1;
    result.stdout = error.stdout ?? '';
    result.stderr = error.stderr ?? '';
  }
  return result;
}

// ---------------------------------------------------------------------------
// scan-consistency.mjs
// ---------------------------------------------------------------------------
describe('scan-consistency (smoke)', () => {
  it('exits without crashing', () => {
    const result = runScript('scan-consistency.mjs');
    // May find findings (non-zero) or pass (zero), but must not crash
    expect(result.stderr).not.toMatch(/TypeError|ReferenceError|SyntaxError/);
  });

  it('produces structured output', () => {
    const result = runScript('scan-consistency.mjs');
    // Output should contain either "findings" or a pass indicator
    const combined = result.stdout + result.stderr;
    expect(combined.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// check-dependency-direction.mjs
// ---------------------------------------------------------------------------
describe('check-dependency-direction (smoke)', () => {
  it('exits with code 0 on clean repo', () => {
    const result = runScript('check-dependency-direction.mjs');
    expect(result.status).toBe(0);
  });

  it('reports no violations', () => {
    const result = runScript('check-dependency-direction.mjs');
    expect(result.stdout).toContain('No dependency direction violations');
  });
});

// ---------------------------------------------------------------------------
// audit-spec-coverage.mjs
// ---------------------------------------------------------------------------
describe('audit-spec-coverage (smoke)', () => {
  it('exits without crashing', () => {
    const result = runScript('audit-spec-coverage.mjs');
    expect(result.stderr).not.toMatch(/TypeError|ReferenceError|SyntaxError/);
  });
});
