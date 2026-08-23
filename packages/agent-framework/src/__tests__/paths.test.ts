import { describe, expect, it } from 'vitest';

import * as storagePaths from '../paths.js';
import { userPaths } from '../paths.js';

describe('userPaths', () => {
  it('does not expose ambient project storage paths', () => {
    expect('projectPaths' in storagePaths).toBe(false);
  });

  it('keeps user-owned runtime state under the host home', () => {
    expect(userPaths().sessions).toContain('.robota');
  });
});
