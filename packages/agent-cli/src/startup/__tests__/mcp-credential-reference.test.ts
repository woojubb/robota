import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { commandEnvironment, withholdProviderCredentials } from '../../product/command-environment.js';
import { createProductUserSettingsSources } from '../../product/user-settings.js';
import { headersHelperEnvironment } from '../mcp-headers-helper-runner.js';
import { resolveMcpDefinitions } from '../mcp-definition-sources.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * Issue #3429 — a credential the user deliberately references in a user-level MCP definition still
 * resolves while a provider profile uses it too; only what MCP children inherit is filtered.
 */
describe('a user MCP definition referencing a provider credential', () => {
  it('still resolves the reference, while a helper does not inherit the variable', () => {
    const home = mkdtempSync(join(tmpdir(), 'test-product-mcp-credential-'));
    roots.push(home);
    mkdirSync(join(home, '.test-product'), { recursive: true });
    writeFileSync(
      join(home, '.test-product', 'settings.json'),
      JSON.stringify({
        currentProvider: 'openai',
        providers: { openai: { type: 'openai', model: 'm', apiKey: '$ENV:OPENAI_API_KEY' } },
        mcpServers: {
          vendor: { type: 'http', url: 'https://mcp.example/', headers: { Authorization: 'Bearer ${OPENAI_API_KEY}' } },
        },
      }),
    );
    const sources = createProductUserSettingsSources(createTestProductRuntime('test-product', { HOME: home }));
    const snapshot = { OPENAI_API_KEY: 'sk-user', PATH: '/bin' };
    withholdProviderCredentials(sources, [], { ...snapshot });

    const { entries, problems } = resolveMcpDefinitions(sources, snapshot);
    expect(problems).toEqual([]);
    expect(JSON.stringify(entries.find((entry) => entry.name === 'vendor')?.definition)).toContain('Bearer sk-user');

    const helperEnv = headersHelperEnvironment(commandEnvironment(snapshot), 'user', 'vendor', 'https://mcp.example/');
    expect(helperEnv.OPENAI_API_KEY).toBeUndefined();
    expect(helperEnv.PATH).toBe('/bin');
  });
});
