import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { createProductKeybindingsOptions } from '../keybindings.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('test-product Agent keybindings host selection', () => {
  it('preserves the CLI path and schema under a caller-selected home', async () => {
    const home = await mkdtemp(join(tmpdir(), 'test-product-cli-keybindings-'));
    roots.push(home);
    const options = createProductKeybindingsOptions(createTestProductRuntime('test-product', { HOME: home, PROJECT_DOCS_URL: 'https://docs.example.test' }));
    expect(options.filePath).toBe(join(home, '.test-product', 'keybindings.json'));

    expect(options.schemaUrl).toBe('https://docs.example.test/schemas/keybindings.schema.json');
  });
});
