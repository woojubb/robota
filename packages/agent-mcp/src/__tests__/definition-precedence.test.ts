/**
 * TC-01 — whole-entry precedence.
 *
 * Three properties, each of which has a failure mode that looks fine until it does not:
 * the winner is taken whole (a merge would let a plugin contribute a header to a managed entry),
 * every loser is recorded (a hidden definition the operator cannot see is one they cannot fix),
 * and a malformed winner still shadows (falling through would hand a name to a lower-trust source
 * precisely when the higher one is broken).
 */

import { describe, expect, it } from 'vitest';

import { decodeSource } from '../definition/decode.js';
import {
  MCP_SOURCE_PRECEDENCE,
  isBlockedByManagedFailure,
  resolveByPrecedence,
} from '../definition/precedence.js';

import type { IMCPSourceCandidates } from '../definition/precedence.js';
import type {
  IMCPServerDefinition,
  IMCPServerDefinitionResolved,
  TMCPDefinitionSource,
} from '../definition/types.js';

/** The materializer is injected; precedence is about order, so identity keeps the two apart. */
const noTemplates = (definition: IMCPServerDefinition): IMCPServerDefinitionResolved => ({
  ...definition,
  unsetVariables: [],
});

function source(
  name: TMCPDefinitionSource,
  servers: Record<string, unknown>,
  origin: string = `${name}.json`,
): IMCPSourceCandidates {
  const decoded = decodeSource({ mcpServers: servers }, name, origin);
  return { source: name, origin, ...decoded };
}

const http = (url: string, headers?: Record<string, string>): Record<string, unknown> => ({
  type: 'http',
  url,
  ...(headers ? { headers } : {}),
});

describe('resolveByPrecedence', () => {
  it('declares the approved order', () => {
    // The SPEC's precedence decision: plugin last, so a plugin cannot shadow a server the user
    // configured under the same name.
    expect([...MCP_SOURCE_PRECEDENCE]).toEqual(['managed', 'local', 'project', 'user', 'plugin']);
  });

  it('takes the highest-precedence entry whole and records every entry it shadowed', () => {
    const { entries } = resolveByPrecedence(
      [
        source('plugin', { alpha: http('https://plugin.example') }),
        source('user', { alpha: http('https://user.example') }),
        source('project', { alpha: http('https://project.example') }),
        source('local', { alpha: http('https://local.example') }),
        source('managed', { alpha: http('https://managed.example') }),
      ],
      noTemplates,
    );

    expect(entries).toHaveLength(1);
    const alpha = entries[0]!;
    expect(alpha.source).toBe('managed');
    expect(alpha.definition?.url).toBe('https://managed.example');
    expect(alpha.shadowed.map((shadow) => shadow.source)).toEqual([
      'local',
      'project',
      'user',
      'plugin',
    ]);
  });

  it('does not merge fields across sources', () => {
    // The managed entry has no headers. If anything merged, the user entry's header would appear
    // on the winner — which is how a lower-trust source gets to add an Authorization header to a
    // definition the operator believes is managed.
    const { entries } = resolveByPrecedence(
      [
        source('user', { alpha: http('https://user.example', { Authorization: 'Bearer user' }) }),
        source('managed', { alpha: http('https://managed.example') }),
      ],
      noTemplates,
    );

    expect(entries[0]!.definition?.headers).toBeUndefined();
    expect(entries[0]!.definition?.url).toBe('https://managed.example');
  });

  it('keeps a malformed higher-precedence winner unresolved AND still shadowing', () => {
    // The managed entry names no transport, so it cannot be decoded. The lower entry must NOT
    // take over: a broken managed policy replaced by a plugin definition is failing open.
    const { entries } = resolveByPrecedence(
      [
        source('plugin', { beta: http('https://plugin.example') }),
        source('managed', { beta: { url: 'https://managed.example' } }),
      ],
      noTemplates,
    );

    const beta = entries[0]!;
    expect(beta.status).toBe('unresolved');
    expect(beta.source).toBe('managed');
    expect(beta.definition).toBeUndefined();
    expect(beta.problem?.reason).toMatch(/no `type`/);
    expect(beta.shadowed).toEqual([{ name: 'beta', source: 'plugin', origin: 'plugin.json' }]);
  });

  it('resolves each name independently', () => {
    const { entries } = resolveByPrecedence(
      [
        source('plugin', {
          alpha: http('https://plugin.example'),
          gamma: http('https://g.example'),
        }),
        source('managed', { alpha: http('https://managed.example') }),
      ],
      noTemplates,
    );

    expect(entries.map((entry) => [entry.name, entry.source])).toEqual([
      ['alpha', 'managed'],
      ['gamma', 'plugin'],
    ]);
  });

  it('ignores a container-level problem when choosing a winner (but the managed tier still blocks it after)', () => {
    // A whole file that is not an object produces a nameless problem. It must not shadow a real
    // entry from a lower source, because it names no server to shadow — that part of name
    // resolution is unaffected. The managed tier being the broken one then blocks the result anyway
    // (see the dedicated fail-closed tests below); this test is only about winner SELECTION.
    const { entries } = resolveByPrecedence(
      [
        source('user', { alpha: http('https://user.example') }),
        {
          source: 'managed',
          origin: 'managed.json',
          ...decodeSource('not an object', 'managed', 'managed.json'),
        },
      ],
      noTemplates,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]!.source).toBe('user');
    expect(entries[0]!.shadowed).toEqual([]);
    expect(entries[0]!.status).toBe('unresolved');
  });

  // BEHAVIOR-2794 (issue #2794 / #3073): a container-level problem has no name, so it cannot become
  // an `IMCPResolvedEntry` — but it must not simply vanish either. Before this carrier existed,
  // `resolveByPrecedence` returned only `IMCPResolvedEntry[]` and `continue`d past these problems,
  // so an entirely unreadable managed policy reached `statusOf` as `{total: 0, unresolved: 0}` while
  // lower-trust sources resolved normally — the highest-trust source failing open exactly where the
  // operator most needs it to fail closed.
  it('surfaces an unreadable managed source as a source-level problem, never silently', () => {
    const { entries, sourceProblems } = resolveByPrecedence(
      [
        {
          source: 'managed',
          origin: 'policy.json',
          ...decodeSource('not an object', 'managed', 'policy.json'),
        },
      ],
      noTemplates,
    );

    expect(entries).toEqual([]);
    expect(sourceProblems).toHaveLength(1);
    expect(sourceProblems[0]).toMatchObject({
      name: '',
      source: 'managed',
      origin: 'policy.json',
      reason: 'the configuration root is not an object',
    });
  });

  // BEHAVIOR-2794 fail-closed (owner direction, PR #3076 review): a source-level problem in the
  // MANAGED (highest-trust) tier does not stay purely informational — it blocks every name that
  // would otherwise resolve from ANY tier, because an unreadable managed policy might have defined
  // that exact name and there is no way to tell "managed defines nothing" from "managed defines
  // this and we cannot see it." The SPEC already refuses to let a broken managed WINNER fall through
  // to a plugin; this extends the same refusal to a managed source that produced no winner at all.
  it('blocks a lower-trust entry that would otherwise resolve while the managed source is entirely unreadable', () => {
    const { entries, sourceProblems } = resolveByPrecedence(
      [
        source('user', { alpha: http('https://user.example') }),
        {
          source: 'managed',
          origin: 'policy.json',
          ...decodeSource({ mcpServers: 'not an object' }, 'managed', 'policy.json'),
        },
      ],
      noTemplates,
    );

    expect(sourceProblems).toEqual([
      {
        name: '',
        source: 'managed',
        origin: 'policy.json',
        reason: '`mcpServers` is not an object',
      },
    ]);

    expect(entries).toHaveLength(1);
    const alpha = entries[0]!;
    expect(alpha.name).toBe('alpha');
    expect(alpha.source).toBe('user');
    // Blocked, not activated — the user-defined server never becomes usable while managed is broken.
    expect(alpha.status).toBe('unresolved');
    expect(alpha.definition).toBeUndefined();
    // Value-free: names the managed source and its problem, never anything from the blocked entry.
    expect(alpha.problem?.reason).toContain('managed');
    expect(alpha.problem?.reason).toContain('policy.json');
    expect(alpha.problem?.reason).toContain('`mcpServers` is not an object');
  });

  it('leaves a name already resolved from a different, readable managed origin unaffected', () => {
    // Two managed-scope sources: `policy.json` resolves `alpha` cleanly; `policy-2.json` is entirely
    // unreadable. The broken origin contributed zero definitions (it never even reached `alpha`), so
    // there is no ambiguity left for `alpha` specifically to fail closed over.
    const { entries, sourceProblems } = resolveByPrecedence(
      [
        source('managed', { alpha: http('https://managed.example') }, 'policy.json'),
        {
          source: 'managed',
          origin: 'policy-2.json',
          ...decodeSource('not an object', 'managed', 'policy-2.json'),
        },
        source('user', { beta: http('https://user.example') }),
      ],
      noTemplates,
    );

    expect(sourceProblems).toHaveLength(1);
    expect(sourceProblems[0]!.origin).toBe('policy-2.json');

    const alpha = entries.find((entry) => entry.name === 'alpha');
    expect(alpha?.status).toBe('resolved');
    expect(alpha?.source).toBe('managed');
    expect(alpha?.definition?.url).toBe('https://managed.example');

    // `beta`, resolved from `user` (a lower tier than the broken managed origin), IS blocked.
    const beta = entries.find((entry) => entry.name === 'beta');
    expect(beta?.status).toBe('unresolved');
  });

  it('only the managed tier triggers the block — a non-managed source problem stays informational', () => {
    // The BROKEN source here is `project`, not `managed`: a broken lower-trust source can never hide
    // a higher-trust one, so `user` must resolve exactly as if the broken project source were absent.
    const { entries, sourceProblems } = resolveByPrecedence(
      [
        source('user', { alpha: http('https://user.example') }),
        {
          source: 'project',
          origin: '.mcp.json',
          ...decodeSource({ mcpServers: 'not an object' }, 'project', '.mcp.json'),
        },
      ],
      noTemplates,
    );

    expect(sourceProblems).toHaveLength(1);
    expect(sourceProblems[0]!.source).toBe('project');

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('alpha');
    expect(entries[0]!.source).toBe('user');
    expect(entries[0]!.status).toBe('resolved');
    expect(entries[0]!.definition?.url).toBe('https://user.example');
  });

  // PR #3076 re-review: `isBlockedByManagedFailure` is the exported predicate a caller (the CLI
  // startup diagnostic, the `/mcp status` renderer) uses to identify a blocked entry rather than
  // re-deriving the block condition or restating the reason's prefix itself.
  it('isBlockedByManagedFailure identifies exactly the entries the managed tier blocked', () => {
    const { entries } = resolveByPrecedence(
      [
        source('user', { alpha: http('https://user.example') }),
        source('local', { beta: { url: 'https://local.example' } }), // malformed, own problem
        {
          source: 'managed',
          origin: 'policy.json',
          ...decodeSource({ mcpServers: 'not an object' }, 'managed', 'policy.json'),
        },
      ],
      noTemplates,
    );

    const alpha = entries.find((entry) => entry.name === 'alpha')!;
    const beta = entries.find((entry) => entry.name === 'beta')!;
    expect(isBlockedByManagedFailure(alpha)).toBe(true);
    // `beta` is unresolved for its OWN reason (malformed, no `type`) — it was never a `resolved`
    // entry the managed tier had to block, so it must not be misreported as one.
    expect(beta.status).toBe('unresolved');
    expect(isBlockedByManagedFailure(beta)).toBe(false);
  });

  it('collects every source-scoped problem across sources, none shadowing or being shadowed', () => {
    const { sourceProblems } = resolveByPrecedence(
      [
        {
          source: 'managed',
          origin: 'policy.json',
          ...decodeSource('not an object', 'managed', 'policy.json'),
        },
        {
          source: 'project',
          origin: '.mcp.json',
          ...decodeSource({}, 'project', '.mcp.json'),
        },
      ],
      noTemplates,
    );

    expect(sourceProblems.map((problem) => problem.origin)).toEqual(['policy.json', '.mcp.json']);
    expect(sourceProblems.map((problem) => problem.reason)).toEqual([
      'the configuration root is not an object',
      'no `mcpServers` key',
    ]);
  });
});
