import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { projectPaths } from '../paths.js';

describe('projectPaths', () => {
  it('places logs and resumable sessions under the project .robota directory', () => {
    const cwd = join('tmp', 'robota-project');

    expect(projectPaths(cwd).logs).toBe(join(cwd, '.robota', 'logs'));
    expect(projectPaths(cwd).sessions).toBe(join(cwd, '.robota', 'sessions'));
  });
});
