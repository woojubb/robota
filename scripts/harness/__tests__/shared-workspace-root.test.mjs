import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT_MARKER, resolveWorkspaceRoot } from '../shared.mjs';

const HARNESS_DIR = path.resolve(import.meta.dirname, '..');
const OWN_CHECKOUT = path.resolve(HARNESS_DIR, '../..');
const SCRIPT = path.join(HARNESS_DIR, 'scan-example.mjs');

function resolve({ argv = ['node', SCRIPT], env = {}, cwd = '/elsewhere/cwd', fromCwd } = {}) {
  let printed = '';
  const root = resolveWorkspaceRoot(
    { filename: SCRIPT },
    { argv, env, cwd, fromCwd, out: { write: (text) => (printed += text) } },
  );
  return { root, printed };
}

describe('resolveWorkspaceRoot (issue #2413)', () => {
  it('reads the checkout the script lives in, not process.cwd(), and names it as the entry', () => {
    const { root, printed } = resolve();
    expect(root).toBe(OWN_CHECKOUT);
    expect(printed).toBe(`${ROOT_MARKER} ${OWN_CHECKOUT}\n`);
  });

  it('stays silent when the root it resolved IS the directory the caller stands in', () => {
    const { root, printed } = resolve({ cwd: OWN_CHECKOUT });
    expect(root).toBe(OWN_CHECKOUT);
    expect(printed).toBe('');
  });

  it('reads the directory it is run in for a fixture-driven script, and the override still wins', () => {
    const fixture = path.resolve('/elsewhere/fixture');
    const { root, printed } = resolve({ cwd: fixture, fromCwd: true });
    expect(root).toBe(fixture);
    expect(printed).toBe('');

    const overridden = resolve({
      cwd: fixture,
      fromCwd: true,
      env: { HARNESS_ROOT: '/elsewhere/env' },
    });
    expect(overridden.root).toBe(path.resolve('/elsewhere/env'));
    expect(overridden.printed).toContain('(override: HARNESS_ROOT)');
  });

  it('honours HARNESS_ROOT and --root overrides and says which one applied, even from that root', () => {
    const viaEnv = resolve({ env: { HARNESS_ROOT: '/elsewhere/env' }, cwd: '/elsewhere/env' });
    expect(viaEnv.root).toBe(path.resolve('/elsewhere/env'));
    expect(viaEnv.printed).toContain('(override: HARNESS_ROOT)');

    const viaFlag = resolve({ argv: ['node', SCRIPT, '--root', '/elsewhere/flag'] });
    expect(viaFlag.root).toBe(path.resolve('/elsewhere/flag'));
    expect(viaFlag.printed).toContain('(override: --root)');

    const viaEquals = resolve({
      argv: ['node', SCRIPT, '--root=/elsewhere/eq'],
      env: { HARNESS_ROOT: '/elsewhere/env' },
    });
    expect(viaEquals.root).toBe(path.resolve('/elsewhere/eq'));
  });

  it('announces nothing when the module is only imported', () => {
    const { printed } = resolve({ argv: ['node', path.join(HARNESS_DIR, 'other.mjs')] });
    expect(printed).toBe('');
  });

  it('is the only root resolver left in scripts/harness', () => {
    const offenders = readdirSync(HARNESS_DIR)
      .filter((name) => name.endsWith('.mjs'))
      .filter((name) => {
        const text = readFileSync(path.join(HARNESS_DIR, name), 'utf8');
        return (
          /WORKSPACE_ROOT\s*=\s*path\.resolve\(import\.meta\.dirname,\s*'\.\.\/\.\.'\)/.test(
            text,
          ) || /WORKSPACE_ROOT\s*=\s*process\.cwd\(\)/.test(text)
        );
      });
    expect(offenders).toEqual([]);
  });
});
