/** An embedding host that supplies an approval made through Robota's own MCP control plane. */
import { homedir } from 'node:os';

import {
  createDefaultUserSettingsSources,
  createRestrictedWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import { InMemoryMCPActivationApprovalStore } from '@robota-sdk/agent-mcp';

import { startCli } from '../../../cli.js';
import { composeMcpClientForStartup } from '../../../startup/mcp-startup.js';

const approvalStore = new InMemoryMCPActivationApprovalStore();
const preflight = await composeMcpClientForStartup({
  settingsSources: createDefaultUserSettingsSources(homedir()),
  projectAccess: createRestrictedWorkspaceProjectAccess('identity-unavailable', process.cwd()),
  cwd: process.cwd(),
  env: process.env,
  mode: 'serve',
  approvalStore,
  reportDiagnostic: (message) => process.stderr.write(`${message}\n`),
});
try {
  const approved = await preflight.activationAdapter.approve('probe');
  if (approved.status !== 'approved')
    throw new Error(`MCP probe approval failed: ${approved.status}`);
} finally {
  await preflight.shutdown();
}

await startCli({
  mcpApprovalStore: approvalStore,
  mcpHttpTransportDeps: { policy: { allowedHosts: ['127.0.0.1'] } },
});
