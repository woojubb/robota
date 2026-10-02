import { createTestProductRuntime } from '../../helpers/product-runtime.js';
/** An embedding host that supplies an approval made through The product's own MCP control plane. */
import { homedir } from 'node:os';
import type { IToolCallScheduling } from '@robota-sdk/agent-core';

import {
  createNodeWorkspaceTrustService,
  createRestrictedWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import { InMemoryMCPActivationApprovalStore } from '@robota-sdk/agent-mcp';

import { startCli } from '../../../cli.js';
import { composeMcpClientForStartup } from '../../../startup/mcp-startup.js';
import { createProductUserSettingsSources } from '../../../product/user-settings.js';

const approvalStore = new InMemoryMCPActivationApprovalStore();
const productRuntime = createTestProductRuntime('test-product', {
  HOME: homedir(),
  PRODUCT_WS_TOKEN: process.env.PRODUCT_WS_TOKEN,
  PRODUCT_WS_PORT: process.env.PRODUCT_WS_PORT,
  ...(process.env.PRODUCT_FIXTURE_MEASURE_TIMING === '1' ? {
    PRODUCT_TELEMETRY_ENABLED: '1',
    PRODUCT_TELEMETRY_TRACES: 'console',
    PRODUCT_TELEMETRY_LOGS: 'console',
  } : {}),
});
const serverId = process.env.PRODUCT_FIXTURE_MCP_SERVER_ID ?? 'probe';
if (!['probe', 'fixture:probe'].includes(serverId)) throw new Error('Unknown fixture MCP source');
const secondSource = process.env.PRODUCT_FIXTURE_MCP_SECOND_SOURCE === '1';
if (secondSource && serverId !== 'fixture:probe') throw new Error('Second source requires the packaged graph fixture');
const sourceIds = secondSource ? [serverId, 'fixture-two:probe'] : [serverId];
const projectAccess =
  serverId === 'probe'
    ? createRestrictedWorkspaceProjectAccess('identity-unavailable', process.cwd())
    : await createNodeWorkspaceTrustService(
        productRuntime.layout.userPaths.workspaceTrust,
        productRuntime.layout.projectStateDirectories,
      ).inspect(process.cwd());
if (serverId !== 'probe' && projectAccess.status !== 'trusted')
  throw new Error('Packaged fixture requires the owner-created disposable workspace grant');
const preflight = await composeMcpClientForStartup({
  productRuntime,
  settingsSources: createProductUserSettingsSources(productRuntime),
  projectAccess,
  cwd: process.cwd(),
  env: process.env,
  mode: 'serve',
  approvalStore,
  reportDiagnostic: (message) => process.stderr.write(`${message}\n`),
});
try {
  for (const sourceId of sourceIds) {
    const absent = !preflight.activationAdapter.list().some((entry) => entry.serverId === sourceId);
    if (!absent || process.env.PRODUCT_FIXTURE_MCP_ALLOW_ABSENT !== '1') {
      const approved = await preflight.activationAdapter.approve(sourceId);
      if (approved.status !== 'approved')
        throw new Error(`MCP probe approval failed: ${approved.status}`);
    }
  }
} finally {
  await preflight.shutdown();
}

// Only the disposable embedding host supplies this policy; model and plugin wire data cannot.
const policy: { maxConcurrency: number; scheduling: Record<string, IToolCallScheduling> } | undefined =
  process.env.PRODUCT_FIXTURE_TOOL_POLICY ? JSON.parse(process.env.PRODUCT_FIXTURE_TOOL_POLICY) : undefined;

await startCli({
  productRuntime,
  ...(serverId === 'probe' ? {} : { projectAccess }),
  mcpApprovalStore: approvalStore,
  mcpHttpTransportDeps: { policy: { allowedHosts: ['127.0.0.1'] } },
  ...(policy ? { toolExecutionPolicy: (calls) => ({
    maxConcurrency: policy.maxConcurrency, continueOnError: true,
    scheduling: new Map(calls.map((call) => [call.id, policy.scheduling[call.id] ?? { resources: [] }])),
  }) } : {}),
});
