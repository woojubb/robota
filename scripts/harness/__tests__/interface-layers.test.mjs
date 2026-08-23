import { describe, expect, it } from 'vitest';

import {
  bareName,
  explainEdge,
  isInterfacePackage,
  judgeEdge,
  parseLayerDeclaration,
  readInterfaceLayers,
} from '../interface-layers.mjs';

function docOf(rows) {
  return [
    'prose that must be ignored',
    '<!-- arch-101:layer-map -->',
    '| Layer | Package |',
    '| --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

describe('parseLayerDeclaration (ARCH-101)', () => {
  it('reads a layer per package', () => {
    const { layers } = parseLayerDeclaration(
      docOf(['| 0 | `agent-interface-execution` |', '| 1 | `agent-interface-session` |']),
    );
    expect(layers.get('agent-interface-execution')).toBe(0);
    expect(layers.get('agent-interface-session')).toBe(1);
  });

  it('signals a missing marker instead of returning an empty map that would read as a pass', () => {
    expect(parseLayerDeclaration('# no marker here').missingMarker).toBe(true);
  });

  it('stops at the end of the table, so a later example row is not absorbed', () => {
    const doc = [
      '<!-- arch-101:layer-map -->',
      '| Layer | Package |',
      '| --- | --- |',
      '| 0 | `agent-interface-execution` |',
      '',
      'An EXAMPLE of the form, not a declaration:',
      '',
      '| 9 | `agent-interface-invented` |',
      '',
    ].join('\n');
    const { layers } = parseLayerDeclaration(doc);
    expect(layers.has('agent-interface-execution')).toBe(true);
    expect(layers.has('agent-interface-invented')).toBe(false);
  });
});

describe('judgeEdge — the ruling, encoded', () => {
  const layers = new Map([
    ['agent-interface-transport', 0],
    ['agent-interface-command', 0],
    ['agent-interface-execution', 0],
    ['agent-interface-session', 1],
    ['agent-interface-session-mobility', 2],
  ]);

  it('permits a downward edge', () => {
    expect(judgeEdge('agent-interface-session', 'agent-interface-execution', layers)).toMatchObject(
      {
        legal: true,
        reason: 'downward',
      },
    );
  });

  it('permits a downward edge spanning more than one layer', () => {
    expect(
      judgeEdge('agent-interface-session-mobility', 'agent-interface-execution', layers).legal,
    ).toBe(true);
  });

  it('REFUSES a same-layer edge — the case the ruling exists to forbid', () => {
    expect(judgeEdge('agent-interface-command', 'agent-interface-execution', layers)).toMatchObject(
      {
        legal: false,
        reason: 'same-layer',
      },
    );
  });

  it('REFUSES an upward edge, because composition is one-directional', () => {
    expect(judgeEdge('agent-interface-execution', 'agent-interface-session', layers)).toMatchObject(
      {
        legal: false,
        reason: 'upward',
      },
    );
  });

  it('REFUSES an undeclared package rather than treating it as legal by default', () => {
    const v = judgeEdge('agent-interface-session', 'agent-interface-nowhere', layers);
    expect(v.legal).toBe(false);
    expect(v.reason).toBe('undeclared');
    expect(v.missing).toEqual(['agent-interface-nowhere']);
  });

  it('normalises an npm scope, so a manifest specifier and a bare name compare equal', () => {
    expect(
      judgeEdge(
        '@robota-sdk/agent-interface-session',
        '@robota-sdk/agent-interface-execution',
        layers,
      ).legal,
    ).toBe(true);
  });
});

describe('helpers', () => {
  it('bareName strips a scope', () => {
    expect(bareName('@robota-sdk/agent-interface-session')).toBe('agent-interface-session');
    expect(bareName('agent-interface-session')).toBe('agent-interface-session');
  });

  it('isInterfacePackage recognises the prefix through a scope', () => {
    expect(isInterfacePackage('@robota-sdk/agent-interface-session')).toBe(true);
    expect(isInterfacePackage('@robota-sdk/agent-framework')).toBe(false);
  });

  it('explainEdge names both layers on a refusal, so the reader can act', () => {
    const layers = new Map([
      ['a-x', 0],
      ['b-y', 0],
    ]);
    const msg = explainEdge('a-x', 'b-y', judgeEdge('a-x', 'b-y', layers));
    expect(msg).toContain('SAME-LAYER');
    expect(msg).toContain('layer 0');
  });
});

describe('the real declaration', () => {
  const layers = readInterfaceLayers();

  it('declares every owner in the merged map', () => {
    for (const pkg of [
      'agent-interface-transport',
      'agent-interface-command',
      'agent-interface-execution',
      'agent-interface-analytics',
      'agent-interface-session',
      'agent-interface-session-mobility',
    ]) {
      expect(layers.has(pkg), `${pkg} has no declared layer`).toBe(true);
    }
  });

  it('makes every edge of the merged target graph legal', () => {
    for (const [from, to] of [
      ['agent-interface-session', 'agent-interface-command'],
      ['agent-interface-session', 'agent-interface-execution'],
      ['agent-interface-session', 'agent-interface-analytics'],
      ['agent-interface-session-mobility', 'agent-interface-session'],
    ]) {
      expect(judgeEdge(from, to, layers).legal, `${from} → ${to}`).toBe(true);
    }
  });

  it('keeps the layer-0 owners mutually forbidden, which is what makes them independent', () => {
    // `agent-interface-transport` is NOT asserted here: ARCH-103 declared it at layer 1, because it
    // still holds `session-contracts` until issue #2110 and composes downward exactly as the session
    // owner will. Asserting it as layer-0 was this test's own staleness, caught by the harness suite.
    expect(judgeEdge('agent-interface-command', 'agent-interface-execution', layers).legal).toBe(
      false,
    );
    expect(judgeEdge('agent-interface-execution', 'agent-interface-analytics', layers).legal).toBe(
      false,
    );
  });

  it('places agent-interface-transport at the HIGHEST layer of what it still holds', () => {
    // 1 under ARCH-104, when it held the session family. 2 under ARCH-106, when session LEFT and the
    // three mobility modules it still holds became the highest thing in it. A package's layer is the
    // HIGHEST of its contents, not the lowest — ARCH-106 predicted 0 by reasoning from what would
    // stop being held, and missed what still was. It reaches 0 when issue #2111 moves mobility out.
    expect(layers.get('agent-interface-transport')).toBe(2);
    expect(judgeEdge('agent-interface-transport', 'agent-interface-session', layers).legal).toBe(
      true,
    );
    expect(judgeEdge('agent-interface-transport', 'agent-interface-execution', layers).legal).toBe(
      true,
    );
  });
});
