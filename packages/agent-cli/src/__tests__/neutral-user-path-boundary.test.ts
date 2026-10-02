import * as framework from '@robota-sdk/agent-framework';
import { describe, expect, it } from 'vitest';

describe('neutral user path boundary', () => {
  it('does not export test-product Agent user-path defaults from the framework', () => {
    expect(framework).not.toHaveProperty('userPaths');
    expect(framework).not.toHaveProperty('getWorkspaceTrustStorePath');
  });
});
