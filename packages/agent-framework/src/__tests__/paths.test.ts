import { describe, expect, it } from 'vitest';

import { userPaths } from '../paths.js';

describe('userPaths', () => {
  it('keeps user-owned runtime state under the host home', () => {
    expect(userPaths().sessions).toContain('.robota');
  });
});
