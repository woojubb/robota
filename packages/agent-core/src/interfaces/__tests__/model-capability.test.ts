import { describe, expect, it } from 'vitest';

// Through the PACKAGE barrel, not the module path. The resolver exists so a provider package can
// answer a per-model question about its own catalog — `agent-provider-openai-compatible` does
// exactly that — so being reachable from outside is part of what this is, and a re-export nothing
// asserts is one that can be dropped without a single test noticing.
import {
  findModelCatalogEntry,
  modelDeclaresCapability,
  resolveModelCapability,
} from '../../index.js';

import type { IProviderModelCatalog } from '../provider-definition.js';

/**
 * PROV-006 — reading the per-model capability vocabulary that nothing read.
 *
 * The distinction every case here turns on: a catalog that says NOTHING about a model has not said
 * "no". Collapsing the two would strip tools from every model a catalog does not happen to list —
 * turning a dead contract into an actively harmful one on the day it started being consumed.
 */

const CATALOG: IProviderModelCatalog = {
  status: 'fallback',
  entries: [
    {
      id: 'chat-model',
      displayName: 'Chat',
      capabilities: ['tools', 'json_schema', 'streaming'],
    },
    {
      id: 'reasoning-model',
      displayName: 'Reasoner',
      aliases: ['reasoner-alias'],
      // Deliberately no `tools` — this is the deepseek-reasoner shape.
      capabilities: ['reasoning', 'json_schema', 'streaming'],
    },
    {
      id: 'undescribed-model',
      displayName: 'Undescribed',
      // An entry that exists but declares nothing.
    },
    {
      id: 'empty-list-model',
      displayName: 'Empty list',
      // The shape a field-presence check misses: present, and empty.
      capabilities: [],
    },
  ],
};

describe('PROV-006 — finding a model in a catalog', () => {
  it('matches by id', () => {
    expect(findModelCatalogEntry(CATALOG, 'chat-model')?.displayName).toBe('Chat');
  });

  it('matches by alias, because the model in use is often the alias', () => {
    // `deepseek-chat` and `deepseek-reasoner` both alias the provider's default model name; an
    // id-only lookup would miss the model actually being called.
    expect(findModelCatalogEntry(CATALOG, 'reasoner-alias')?.id).toBe('reasoning-model');
  });

  it('finds nothing for a model the catalog does not list', () => {
    expect(findModelCatalogEntry(CATALOG, 'some-other-model')).toBeUndefined();
    expect(findModelCatalogEntry(undefined, 'chat-model')).toBeUndefined();
  });
});

describe('PROV-006 — what a model declares', () => {
  it('answers true for a declared capability', () => {
    expect(modelDeclaresCapability(CATALOG, 'chat-model', 'tools')).toBe(true);
  });

  it('answers FALSE for a capability the entry deliberately omits', () => {
    // The whole point: the entry lists what it can do, so an omission from a populated list is a
    // statement. This is the assertion that makes `deepseek-reasoner` gettable.
    expect(modelDeclaresCapability(CATALOG, 'reasoning-model', 'tools')).toBe(false);
    expect(modelDeclaresCapability(CATALOG, 'reasoning-model', 'reasoning')).toBe(true);
  });

  it('answers UNDEFINED — not false — when the catalog has said nothing', () => {
    // Four ways of saying nothing, all distinct from saying no.
    expect(modelDeclaresCapability(CATALOG, 'unlisted-model', 'tools')).toBeUndefined();
    expect(modelDeclaresCapability(CATALOG, 'undescribed-model', 'tools')).toBeUndefined();
    expect(modelDeclaresCapability(undefined, 'chat-model', 'tools')).toBeUndefined();
    // The one a field-presence check misses: `capabilities: []` is present and says nothing, and
    // `[].includes(x)` answers `false` rather than "unknown". Read as a denial it would strip tools
    // from a model whose author had simply not filled the list in yet.
    expect(modelDeclaresCapability(CATALOG, 'empty-list-model', 'tools')).toBeUndefined();
  });
});

describe('PROV-006 — resolving with a stated assumption', () => {
  it('a declaration wins over the assumption, in both directions', () => {
    expect(resolveModelCapability(CATALOG, 'reasoning-model', 'tools', true)).toBe(false);
    expect(resolveModelCapability(CATALOG, 'chat-model', 'tools', false)).toBe(true);
  });

  it('the assumption is used only when the catalog is silent', () => {
    expect(resolveModelCapability(CATALOG, 'unlisted-model', 'tools', true)).toBe(true);
    expect(resolveModelCapability(CATALOG, 'unlisted-model', 'tools', false)).toBe(false);
    // Including the empty-list form — otherwise the caller's assumption is silently overridden by a
    // model that never said anything.
    expect(resolveModelCapability(CATALOG, 'empty-list-model', 'tools', true)).toBe(true);
  });
});
