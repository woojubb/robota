import { describe, expect, it } from 'vitest';
import * as sdk from '../index.js';

describe('agent-sdk public API', () => {
  it('does not expose automatic memory orchestration from the top-level package', () => {
    expect('AutomaticMemoryController' in sdk).toBe(false);
    expect('DEFAULT_AUTOMATIC_MEMORY_CONFIG' in sdk).toBe(false);
    expect('normalizeAutomaticMemoryConfig' in sdk).toBe(false);
  });
});
