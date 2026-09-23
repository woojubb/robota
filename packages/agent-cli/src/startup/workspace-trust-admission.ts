import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

const HEADLESS_BLOCKING_STATES = new Set([
  'untrusted',
  'revoked',
  'stale/replaced',
  'store-unavailable',
]);

export function requiresHeadlessWorkspaceTrust(access: TWorkspaceProjectAccess): boolean {
  return access.status === 'restricted' && HEADLESS_BLOCKING_STATES.has(access.trustState);
}

export function formatHeadlessWorkspaceTrustError(
  access: TWorkspaceProjectAccess,
  cwd: string,
): string {
  const state = access.status === 'trusted' ? 'trusted' : access.trustState;
  const workspace = access.status === 'trusted' ? access.identity.displayPath : access.displayPath;
  const location = workspace ?? cwd;
  return [
    `Workspace trust is required before headless startup (state: ${state}).`,
    `Workspace: ${location}`,
    'Project settings, hooks, plugins, skills, and provider overrides were not loaded.',
    'Grant access with: robota trust --yes',
  ].join('\n');
}
