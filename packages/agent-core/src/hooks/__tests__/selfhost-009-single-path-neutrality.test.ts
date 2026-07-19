/**
 * SELFHOST-009 TC-05 (single path, no new tier) + TC-06 (neutrality).
 *
 * TC-05: every catalogued event dispatches through the ONE `runHooks` engine and the ONE
 * `exitCode:2 → blocked` contract — there is no second parallel hook/registry system and no second
 * block-decision point.
 *
 * TC-06: the hook engine + event catalog stay a NEUTRAL mechanism — no product/domain hook policy is
 * baked into `packages/` (policy lives in the consumer, keyed off config-provided groups/matchers).
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

const HOOKS_DIR = path.resolve(import.meta.dirname, '..');
const AGENT_CORE_ROOT = path.resolve(import.meta.dirname, '../../..');

function hooksSourceFiles(): string[] {
  return readdirSync(HOOKS_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => path.join(HOOKS_DIR, name));
}

function readAllHooksSource(): string {
  return hooksSourceFiles()
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

describe('SELFHOST-009 TC-05 — single runHooks path, no second tier', () => {
  it('defines exactly one runHooks dispatch engine', () => {
    const src = readAllHooksSource();
    const matches = src.match(/export\s+(?:async\s+)?function\s+runHooks\b/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('exposes no parallel hook dispatcher/registry/bus/emitter', () => {
    const src = readAllHooksSource();
    // A second, independently-ordered dispatch tier is exactly what the design forbids.
    expect(src).not.toMatch(/class\s+\w*Hook\w*(Registry|Bus|Dispatcher|Emitter)\b/);
    expect(src).not.toMatch(/export\s+(?:async\s+)?function\s+\w*[Dd]ispatchHook\w*/);
  });

  it('has a single block contract: IRunHooksResult.blocked, driven by exitCode 2', () => {
    const runner = readFileSync(path.join(HOOKS_DIR, 'hook-runner.ts'), 'utf8');
    expect(runner).toMatch(/interface\s+IRunHooksResult\b/);
    expect(runner).toMatch(/blocked:\s*boolean/);
    // The one block trigger.
    expect(runner).toMatch(/exitCode\s*===\s*2/);
  });
});

describe('SELFHOST-009 TC-06 — neutrality: no domain hook policy in packages/', () => {
  it('every THookEvent member is a neutral lifecycle name (no product/domain noun)', () => {
    const types = readFileSync(path.join(HOOKS_DIR, 'types.ts'), 'utf8');
    const start = types.indexOf('export type THookEvent');
    const end = types.indexOf(';', start);
    const block = types.slice(start, end);
    const events = [...block.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
    expect(events.length).toBeGreaterThanOrEqual(16);

    // Lifecycle-token vocabulary — any event name must be composed only of these neutral tokens.
    const NEUTRAL_TOKENS =
      /^(Pre|Post|Session|Subagent|Worktree|User|Prompt|Submit|Tool|Use|Compact|Start|End|Stop|Failure|Model|Call|Permission|Decision|Create|Remove)+$/;
    for (const event of events) {
      expect(event, `event "${event}" is not a neutral lifecycle name`).toMatch(NEUTRAL_TOKENS);
    }
  });

  it('the neutral engine embeds no concrete tool policy (no hardcoded tool names)', () => {
    // The engine dispatches purely off config-provided groups + regex matchers. Concrete tool names
    // (a per-tool policy) must NOT appear in the neutral mechanism — they live in consumers/tests.
    const engine = [
      readFileSync(path.join(HOOKS_DIR, 'types.ts'), 'utf8'),
      readFileSync(path.join(HOOKS_DIR, 'hook-runner.ts'), 'utf8'),
    ].join('\n');
    for (const toolName of ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob']) {
      expect(engine, `engine hardcodes tool "${toolName}"`).not.toContain(`'${toolName}'`);
    }
  });

  it('the catalog SSOT documents blocking semantics and stays neutral mechanism', () => {
    const catalog = readFileSync(path.join(AGENT_CORE_ROOT, 'docs/HOOK-CATALOG.md'), 'utf8');
    // The single blocking gate is documented; the informational events are marked non-blocking.
    expect(catalog).toMatch(/PreToolUse/);
    expect(catalog.toLowerCase()).toContain('informational');
    expect(catalog).toMatch(/single source of truth/i);
  });
});
