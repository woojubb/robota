import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectNamedMechanismFindings, MATCHERS } from '../scan-named-mechanism-resolves.mjs';

/**
 * ACCEPTANCE CRITERION (written before the scan).
 *
 * A rule saying "use X" where X is absent is worse than a rule with no mechanism at all. The
 * unmechanized rule is honestly prose and a reader treats it as judgement; the phantom one reads as
 * satisfiable, so a reader either believes the obligation was met or drops it silently, and nothing
 * afterwards distinguishes either from compliance.
 *
 * The scan FAILS when a rule or routing document names, by identity, a harness script, a hook, a
 * package script, or an MCP server that does not resolve in this repository or its declared
 * environment.
 */

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

describe('the matcher table is well-formed', () => {
  // Issue #2042. `MATCHERS` is looked up with `.find((m) => m.kind === kind)`, which returns the
  // first and never looks again, so a duplicate `kind` leaves a matcher — pattern, resolver and
  // hint — that no input can ever reach. The check asks EXISTENCE; the property is UNIQUENESS.
  //
  // Same shape as `CI_STAGES`'s `stage names are unique` and `SCAN_COMMANDS`'s
  // `registers every scan exactly once`; this repository already answers this question twice.
  it('declares every kind exactly once — a second matcher is unreachable', () => {
    const kinds = MATCHERS.map((matcher) => matcher.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

describe('scan-named-mechanism-resolves', () => {
  it('is registered in run-all-scans.mjs', () => {
    const runner = readFileSync(
      path.join(WORKSPACE_ROOT, 'scripts/harness/run-all-scans.mjs'),
      'utf8',
    );
    expect(runner).toContain('scan-named-mechanism-resolves.mjs');
  });

  it('passes on the live repository', () => {
    expect(collectNamedMechanismFindings()).toEqual([]);
  });

  it('asserts presence, never behaviour — resolution reads existence, not content', () => {
    // Correctness of a named mechanism is owned by guards-pass-silently and
    // hooks-have-execution-coverage; this floor sits beneath them. Asserted on the resolver
    // itself: an existing hook resolves whatever its body does, and a phantom one does not —
    // the earlier version of this case just repeated the live-repository assertion.
    const hooks = MATCHERS.find((m) => m.kind === 'hook');
    expect(hooks.resolves('.claude/hooks/branch-guard.sh')).toBe(true);
    expect(hooks.resolves('.claude/hooks/does-not-exist.sh')).toBe(false);
  });

  it('reads the shorthand in both homes — inline backticks and bare at line start', () => {
    // AGENTS.md's Harness Entrypoints carry no `run` AND no backticks (a fenced block); the
    // matcher must see both, or the most-load-bearing command list goes unchecked.
    const scripts = MATCHERS.find((m) => m.kind === 'package script');
    const name = (text) => {
      scripts.pattern.lastIndex = 0;
      const hit = scripts.pattern.exec(text);
      return hit ? (hit[1] ?? hit[2]) : null;
    };
    expect(name('Run `pnpm harness:scan` before pushing.')).toBe('harness:scan');
    expect(name('pnpm harness:scan')).toBe('harness:scan');
    expect(name('  pnpm harness:record -- --scope x')).toBe('harness:record');
    // Bare mid-sentence is prose, not a command.
    expect(name('this pnpm monorepo uses workspaces')).toBeNull();
  });

  it('does not read a package-manager builtin as a script name', () => {
    const scripts = MATCHERS.find((m) => m.kind === 'package script');
    for (const text of [
      'Run `pnpm install` first.',
      'Use `pnpm run` to list them.',
      'pnpm install --frozen-lockfile',
    ]) {
      scripts.pattern.lastIndex = 0;
      expect(scripts.pattern.exec(text), `${text} was read as a script`).toBeNull();
    }
  });

  it('does not read a determiner in front of MCP as a server name', () => {
    const mcp = MATCHERS.find((m) => m.kind === 'MCP server');
    for (const text of ['This MCP server does X.', 'Every MCP server is declared.']) {
      mcp.pattern.lastIndex = 0;
      expect(mcp.pattern.exec(text), `${text} was read as a name`).toBeNull();
    }
    mcp.pattern.lastIndex = 0;
    expect(mcp.pattern.exec('Use the Playwright MCP server.')?.[1]).toBe('Playwright');
  });
});
