import { createTestProductRuntime } from './helpers/product-runtime.js';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import {
  MCPActivationAdmissionService,
  InMemoryMCPActivationApprovalStore,
} from '@robota-sdk/agent-mcp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IMCPActivationRequest } from '@robota-sdk/agent-mcp';

const startup = vi.hoisted(() => ({ compose: vi.fn() }));
vi.mock('../startup/mcp-startup.js', async (original) => ({
  ...(await original<typeof import('../startup/mcp-startup.js')>()),
  composeMcpClientForStartup: startup.compose,
}));
const { startCliCore } = await import('../cli-core.js');
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const request: IMCPActivationRequest = {
  serverId: 'docs',
  endpoint: 'https://example.test/mcp',
  source: 'user',
  provenance: { kind: 'user', id: 'user-settings' },
  definitionFingerprint: 'v1',
  securityIdentity: 'identity-v1',
};

describe('the CLI MCP composition default', () => {
  it('persists an approval without host options, then admits it on the next start', async () => {
    const home = mkdtempSync(join(tmpdir(), 'test-product-cli-mcp-default-'));
    roots.push(home);
    mkdirSync(join(home, 'project'));
    vi.stubEnv('HOME', home);
    vi.spyOn(process, 'cwd').mockReturnValue(join(home, 'project'));
    const argv = process.argv;
    process.argv = [
      'node',
      'test-product',
      '-p',
      'hello',
      '--restricted-workspace',
      '--disable-update-check',
    ];
    let starts = 0;
    startup.compose.mockImplementation((options) => {
      expect(options.approvalStore).toBeDefined();
      expect(options.approvalStore).not.toBeInstanceOf(InMemoryMCPActivationApprovalStore);
      const service = new MCPActivationAdmissionService(options.approvalStore);
      if (++starts === 1) service.approve(request);
      else expect(service.admit(request).allowed).toBe(true);
      throw new Error('composition inspected');
    });
    try {
      for (let i = 0; i < 2; i++) {
        await expect(
          startCliCore(
            {productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),  projectAccess: createRestrictedWorkspaceProjectAccess('untrusted') },
            () => [],
          ),
        ).rejects.toThrow('composition inspected');
      }
      expect(startup.compose).toHaveBeenCalledTimes(2);
      expect(
        JSON.parse(readFileSync(join(home, '.test-product', 'mcp-approvals.json'), 'utf8')).records,
      ).toHaveLength(1);
    } finally {
      process.argv = argv;
    }
  });
});
