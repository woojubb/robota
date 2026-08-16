import { describe, expect, it } from 'vitest';

// Through the PACKAGE barrel, not the module path. These exist so a provider package can declare
// what its own models do — `agent-provider-openai-compatible` does exactly that — so being reachable
// from outside is part of what they are, and a re-export nothing asserts is one that can be dropped
// without a single test noticing.
import {
  modelDeclaresCapability,
  resolveModelCapabilities,
  resolveModelCapability,
} from '../../index.js';

import type { IProviderCapabilityTable } from '../model-capability.js';

/**
 * PROV-006 / PROV-008 — what a model can do, and what "nothing has been said" means.
 *
 * Two rules, and every case below is one of them:
 *
 * 1. A table states the VENDOR DEFAULT plus verified deviations, and a model absent from the
 *    deviation list is an ORDINARY model — never a crippled one. That is what makes a short table
 *    safe; an enumeration of every model is a matrix nobody maintains.
 * 2. Nothing declared is `undefined`, not `false`. Collapsing them would strip tools from every
 *    model no package happens to describe — turning a dead contract into an actively harmful one on
 *    the day it started being read.
 */

const TABLE: IProviderCapabilityTable = {
  vendorDefault: ['tools', 'json_schema', 'streaming'],
  deviations: {
    // The deepseek-reasoner shape: a real model that verifiably lacks the vendor's tool support.
    'reasoning-model': {
      capabilities: ['reasoning', 'json_schema', 'streaming'],
      verifiedAt: '2026-08-16',
    },
  },
  verifiedAt: '2026-08-16',
};

describe('PROV-008 — the vendor default applies to everything that does not deviate', () => {
  it('a model with no deviation gets the vendor default', () => {
    // The rule that makes a deviation list safe: absence from it means "ordinary", not "unknown"
    // and not "incapable". Without it every table would have to enumerate every model.
    expect(resolveModelCapabilities(TABLE, 'some-ordinary-model')).toEqual([
      'tools',
      'json_schema',
      'streaming',
    ]);
    expect(modelDeclaresCapability(TABLE, 'some-ordinary-model', 'tools')).toBe(true);
  });

  it('a deviation REPLACES the default rather than adding to it', () => {
    // A delta would be ambiguous about removal — and removal is the case that matters here: a model
    // that LOSES a capability its vendor otherwise has cannot be expressed by adding.
    expect(resolveModelCapabilities(TABLE, 'reasoning-model')).toEqual([
      'reasoning',
      'json_schema',
      'streaming',
    ]);
    expect(modelDeclaresCapability(TABLE, 'reasoning-model', 'tools')).toBe(false);
    expect(modelDeclaresCapability(TABLE, 'reasoning-model', 'reasoning')).toBe(true);
  });
});

describe('PROV-006 — nothing declared is not a denial', () => {
  it('answers UNDEFINED when no table exists at all', () => {
    expect(resolveModelCapabilities(undefined, 'any-model')).toBeUndefined();
    expect(modelDeclaresCapability(undefined, 'any-model', 'tools')).toBeUndefined();
  });

  it('answers UNDEFINED for an empty capability list, which a presence check misses', () => {
    // `[].includes(x)` answers `false` rather than "unknown", so an author who has not filled the
    // list in yet would otherwise have declared a model that can do nothing.
    const empty: IProviderCapabilityTable = { vendorDefault: [], verifiedAt: '2026-08-16' };
    expect(modelDeclaresCapability(empty, 'any-model', 'tools')).toBeUndefined();

    const emptyDeviation: IProviderCapabilityTable = {
      vendorDefault: ['tools'],
      deviations: { 'blank-model': { capabilities: [], verifiedAt: '2026-08-16' } },
      verifiedAt: '2026-08-16',
    };
    expect(modelDeclaresCapability(emptyDeviation, 'blank-model', 'tools')).toBeUndefined();
  });
});

describe('PROV-006 — resolving with a stated assumption', () => {
  it('a declaration wins over the assumption, in both directions', () => {
    expect(resolveModelCapability(TABLE, 'reasoning-model', 'tools', true)).toBe(false);
    expect(resolveModelCapability(TABLE, 'ordinary-model', 'tools', false)).toBe(true);
  });

  it('the assumption is used only when nothing has been declared', () => {
    expect(resolveModelCapability(undefined, 'any-model', 'tools', true)).toBe(true);
    expect(resolveModelCapability(undefined, 'any-model', 'tools', false)).toBe(false);

    // Including the empty-list form — otherwise a table that says nothing silently overrides the
    // caller's assumption.
    const empty: IProviderCapabilityTable = { vendorDefault: [], verifiedAt: '2026-08-16' };
    expect(resolveModelCapability(empty, 'any-model', 'tools', true)).toBe(true);
  });
});
