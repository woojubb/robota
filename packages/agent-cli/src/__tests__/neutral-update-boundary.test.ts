import * as framework from '@robota-sdk/agent-framework';
import { describe, expect, it } from 'vitest';

describe('neutral framework update-check boundary', () => {
  it('does not expose test-product Agent CLI update policy or cache paths', () => {
    expect(framework).not.toHaveProperty('checkForCliUpdate');
    expect(framework).not.toHaveProperty('getUserUpdateCheckCachePath');
    expect(framework).not.toHaveProperty('resolveCliUpdateNotice');
  });
});
