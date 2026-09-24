import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { createRobotaKeybindingsOptions } from '../robota-keybindings.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Robota keybindings host selection', () => {
  it('preserves the CLI path and schema under a caller-selected home', async () => {
    const home = await mkdtemp(join(tmpdir(), 'robota-cli-keybindings-'));
    roots.push(home);
    const options = createRobotaKeybindingsOptions(home);
    expect(options.filePath).toBe(join(home, '.robota', 'keybindings.json'));

    expect(options.schemaUrl).toBe('https://docs.robota.io/schemas/keybindings.schema.json');
  });
});
