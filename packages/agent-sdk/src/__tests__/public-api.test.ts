import { describe, expect, it } from 'vitest';
import * as sdk from '../index.js';

describe('agent-sdk public API', () => {
  it('exposes SDK-owned prompt file-reference helpers', () => {
    expect(typeof sdk.parsePromptFileReferences).toBe('function');
    expect(typeof sdk.resolvePromptFileReferences).toBe('function');
    expect(typeof sdk.resolvePromptFileReferencePaths).toBe('function');
    expect(typeof sdk.buildPromptWithFileReferences).toBe('function');
    expect(typeof sdk.listCommandContextReferences).toBe('function');
    expect(typeof sdk.addCommandContextReference).toBe('function');
    expect(typeof sdk.createContextReferenceItem).toBe('function');
    expect(typeof sdk.formatModelCommandUsageMessageAsync).toBe('function');
    expect(typeof sdk.resolveActiveProviderModelCatalogState).toBe('function');
  });

  it('does not expose automatic memory orchestration from the top-level package', () => {
    expect('AutomaticMemoryController' in sdk).toBe(false);
    expect('DEFAULT_AUTOMATIC_MEMORY_CONFIG' in sdk).toBe(false);
    expect('normalizeAutomaticMemoryConfig' in sdk).toBe(false);
  });

  it('does not pass through lower-level package utilities as top-level SDK runtime exports', () => {
    expect('evaluatePermission' in sdk).toBe(false);
    expect('runHooks' in sdk).toBe(false);
    expect('TRUST_TO_MODE' in sdk).toBe(false);
    expect('messageToHistoryEntry' in sdk).toBe(false);
    expect('getMessagesForAPI' in sdk).toBe(false);
  });
});
